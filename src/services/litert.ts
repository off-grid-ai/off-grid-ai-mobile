/**
 * LiteRTService — JS bridge to the native LiteRTModule (Android).
 *
 * Architecture notes:
 * - The native Conversation object holds turn history internally.
 *   JS sends only the current user message via sendMessage().
 * - Call resetConversation() before each generation (MVP approach).
 *   This is safe and correct for all flows including retry/edit/switch.
 * - onComplete receives fully accumulated content, not an empty string.
 */

import { NativeModules, NativeEventEmitter, Platform, EmitterSubscription } from 'react-native';
import logger from '../utils/logger';

const TAG = '[LiteRTService]';

const { LiteRTModule } = NativeModules;

// Events emitted by the native module
const EVENT_TOKEN    = 'litert_token';
const EVENT_THINKING = 'litert_thinking';
const EVENT_COMPLETE = 'litert_complete';
const EVENT_ERROR    = 'litert_error';

export type LiteRTBackend = 'cpu' | 'gpu' | 'npu';

export interface LiteRTBenchmarkStats {
  ttft: number;
  decodeTokensPerSecond: number;
  prefillTokensPerSecond: number;
  prefillTokenCount: number;
  initTimeSeconds: number;
}

export interface LiteRTMemoryInfo {
  totalRamMb: number;
  usedRamMb: number;
  availRamMb: number;
  gpuPrivateMb: number;
  lowMemory: boolean;
}

export interface LiteRTGenerationCallbacks {
  onToken: (token: string) => void;
  onReasoning: (token: string) => void;
  onComplete: (fullContent: string, fullReasoning: string, stats?: LiteRTBenchmarkStats) => void;
  onError: (error: Error) => void;
}

class LiteRTService {
  private loaded = false;
  private activeBackend: LiteRTBackend | null = null;
  private emitter: NativeEventEmitter | null = null;
  private subscriptions: EmitterSubscription[] = [];

  // Accumulated content for current generation
  private currentContent = '';
  private currentReasoning = '';
  private currentCallbacks: LiteRTGenerationCallbacks | null = null;

  // Multi-turn tracking — reset conversation only when context changes
  private activeConversationId: string | null = null;
  private activeSystemPrompt: string | null = null;

  constructor() {
    if (Platform.OS === 'android' && LiteRTModule) {
      this.emitter = new NativeEventEmitter(LiteRTModule);
      logger.log(TAG, 'initialized — native module available');
    } else {
      logger.log(TAG, 'native module not available on this platform');
    }
  }

  // ---------------------------------------------------------------------------
  // loadModel
  // ---------------------------------------------------------------------------

  async loadModel(modelPath: string, preferredBackend: LiteRTBackend, supportsVision = false): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('LiteRT is not available on this platform');
    }

    logger.log(TAG, `loadModel — path=${modelPath} backend=${preferredBackend} supportsVision=${supportsVision}`);

    try {
      const actualBackend: string = await LiteRTModule.loadModel(modelPath, preferredBackend, supportsVision);
      this.activeBackend = actualBackend as LiteRTBackend;
      this.loaded = true;
      logger.log(TAG, `loadModel — loaded on ${this.activeBackend}`);
    } catch (e) {
      this.loaded = false;
      this.activeBackend = null;
      logger.log(TAG, `loadModel — failed: ${String(e)}`);
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // resetConversation — cheap: closes + recreates Conversation, Engine stays
  // ---------------------------------------------------------------------------

  async resetConversation(
    systemPrompt: string,
    samplerConfig?: { temperature?: number; topK?: number; topP?: number },
  ): Promise<void> {
    if (!this.isAvailable() || !this.loaded) {
      throw new Error('No LiteRT model loaded');
    }
    const temperature = samplerConfig?.temperature ?? 0.8;
    const topK = samplerConfig?.topK ?? 40;
    const topP = samplerConfig?.topP ?? 0.95;
    logger.log(TAG, `resetConversation — systemPrompt length=${systemPrompt.length} temperature=${temperature} topK=${topK} topP=${topP}`);
    await LiteRTModule.resetConversation(systemPrompt, temperature, topK, topP);
    this.activeSystemPrompt = systemPrompt;
    logger.log(TAG, 'resetConversation — done');
  }

  /**
   * Ensure conversation is ready for the given context.
   * Resets only when conversationId or systemPrompt has changed — preserves
   * native turn history for follow-up messages in the same conversation.
   */
  async prepareConversation(
    conversationId: string,
    systemPrompt: string,
    samplerConfig?: { temperature?: number; topK?: number; topP?: number },
  ): Promise<void> {
    const needsReset =
      this.activeConversationId !== conversationId ||
      this.activeSystemPrompt !== systemPrompt;
    if (needsReset) {
      logger.log(TAG, `prepareConversation — reset (convId changed=${this.activeConversationId !== conversationId}, sysPrompt changed=${this.activeSystemPrompt !== systemPrompt})`);
      await this.resetConversation(systemPrompt, samplerConfig);
      this.activeConversationId = conversationId;
    } else {
      logger.log(TAG, 'prepareConversation — reusing existing conversation (multi-turn)');
    }
  }

  // ---------------------------------------------------------------------------
  // sendMessage — sends current turn only, library holds history
  // ---------------------------------------------------------------------------

  async sendMessage(
    text: string,
    callbacks: LiteRTGenerationCallbacks,
    imageUri?: string,
  ): Promise<void> {
    if (!this.isAvailable() || !this.loaded) {
      callbacks.onError(new Error('No LiteRT model loaded'));
      return;
    }

    logger.log(TAG, `sendMessage — text length=${text.length}`);

    // Reset accumulators
    this.currentContent = '';
    this.currentReasoning = '';
    this.currentCallbacks = callbacks;

    // Register event listeners for this generation
    this.clearSubscriptions();
    this.subscriptions = [
      this.emitter!.addListener(EVENT_TOKEN, (token: string) => {
        this.currentContent += token;
        callbacks.onToken(token);
      }),
      this.emitter!.addListener(EVENT_THINKING, (token: string) => {
        this.currentReasoning += token;
        callbacks.onReasoning(token);
      }),
      this.emitter!.addListener(EVENT_COMPLETE, (benchmarkJson: string) => {
        logger.log(TAG, `sendMessage — complete, content=${this.currentContent.length} chars`);
        this.clearSubscriptions();
        this.currentCallbacks = null;
        let stats: LiteRTBenchmarkStats | undefined;
        if (benchmarkJson) {
          try { stats = JSON.parse(benchmarkJson); } catch { /* ignore parse errors */ }
        }
        callbacks.onComplete(this.currentContent, this.currentReasoning, stats);
      }),
      this.emitter!.addListener(EVENT_ERROR, (message: string) => {
        logger.log(TAG, `sendMessage — error: ${message}`);
        this.clearSubscriptions();
        this.currentCallbacks = null;
        callbacks.onError(new Error(message));
      }),
    ];

    try {
      await LiteRTModule.sendMessage(text, imageUri ?? null);
    } catch (e) {
      this.clearSubscriptions();
      this.currentCallbacks = null;
      const err = e instanceof Error ? e : new Error(String(e));
      logger.log(TAG, `sendMessage — native error: ${err.message}`);
      callbacks.onError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // stopGeneration
  // ---------------------------------------------------------------------------

  async stopGeneration(): Promise<void> {
    if (!this.isAvailable()) return;
    logger.log(TAG, 'stopGeneration');
    this.clearSubscriptions();
    this.currentCallbacks = null;
    // After a stop the native conversation state is indeterminate — force reset on next turn
    this.activeConversationId = null;
    try {
      await LiteRTModule.stopGeneration();
    } catch (e) {
      logger.log(TAG, `stopGeneration — error (ignored): ${String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // unloadModel — expensive: closes Conversation + Engine
  // ---------------------------------------------------------------------------

  async unloadModel(): Promise<void> {
    if (!this.isAvailable()) return;
    logger.log(TAG, 'unloadModel');
    this.clearSubscriptions();
    this.currentCallbacks = null;
    this.activeConversationId = null;
    this.activeSystemPrompt = null;
    try {
      await LiteRTModule.unloadModel();
    } catch (e) {
      logger.log(TAG, `unloadModel — error (ignored): ${String(e)}`);
    } finally {
      this.loaded = false;
      this.activeBackend = null;
    }
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  isModelLoaded(): boolean {
    return this.loaded;
  }

  isNPU(): boolean {
    return this.activeBackend === 'npu';
  }

  getActiveBackend(): LiteRTBackend | null {
    return this.activeBackend;
  }

  isAvailable(): boolean {
    return Platform.OS === 'android' && !!LiteRTModule;
  }

  async getMemoryInfo(): Promise<LiteRTMemoryInfo | null> {
    if (!this.isAvailable()) return null;
    try {
      return await LiteRTModule.getMemoryInfo();
    } catch (e) {
      logger.log(TAG, `getMemoryInfo — error: ${String(e)}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private clearSubscriptions(): void {
    this.subscriptions.forEach(s => s.remove());
    this.subscriptions = [];
  }
}

export const liteRTService = new LiteRTService();
