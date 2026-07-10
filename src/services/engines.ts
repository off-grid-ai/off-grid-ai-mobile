import { useAppStore } from '../stores';
import { llmService } from './llm';
import { liteRTService } from './litert';
import logger from '../utils/logger';

/** Every text-generation engine, defined ONCE here so callers never hardcode the concrete set. */
const TEXT_ENGINES = [liteRTService, llmService];

/** What the active text model can do, resolved once so callers never branch on the concrete engine. */
export interface EngineCapabilities {
  vision: boolean;
  audio: boolean;
  tools: boolean;
  thinking: boolean;
}

/** Runtime inputs for deriveEngineCapabilities — passed explicitly so the rule is pure/testable. */
export interface CapabilityInputs {
  /** A remote (gateway) model is active — its declared capabilities win. */
  isRemote: boolean;
  remoteCaps?: { supportsVision?: boolean; supportsToolCalling?: boolean; supportsThinking?: boolean } | null;
  /** The active LOCAL model's engine ('litert' | 'llama' | ...) and LiteRT capability flags. */
  engine?: string;
  liteRTVision?: boolean;
  liteRTAudio?: boolean;
  /** Whether the LiteRT engine currently has a model resident (its tools/thinking need it loaded). */
  liteRTLoaded: boolean;
  /** The llama engine's live capabilities (only meaningful when loaded). */
  llama: { loaded: boolean; vision: boolean; audio: boolean; tools: boolean; thinking: boolean };
}

/**
 * THE single source for "what can the active text model do" — the exact rule previously
 * re-derived in useChatModelStateSync / useChatModelActions / useChatGenerationActions et al.
 * Precedence: remote (declared caps) → LiteRT (vision/audio from the model FLAG, no load needed;
 * tools/thinking only once the engine is loaded) → llama (all from the loaded engine) → none.
 * Pure and zero-IO so callers keep their own reactive inputs; adding an engine is a branch here (OCP).
 */
export function deriveEngineCapabilities(i: CapabilityInputs): EngineCapabilities {
  if (i.isRemote) {
    return {
      vision: i.remoteCaps?.supportsVision ?? false,
      tools: i.remoteCaps?.supportsToolCalling ?? false,
      thinking: i.remoteCaps?.supportsThinking ?? false,
      audio: false, // remote audio capability is not tracked today
    };
  }
  if (i.engine === 'litert') {
    return {
      vision: !!i.liteRTVision, // from the model flag — shown before load (matches state-sync)
      audio: !!i.liteRTAudio,
      tools: i.liteRTLoaded, // native tool calling, but only once the engine is resident
      thinking: i.liteRTLoaded,
    };
  }
  // llama (and any future engine): capabilities come from the loaded engine, false when not loaded.
  return {
    vision: i.llama.loaded ? i.llama.vision : false,
    audio: i.llama.loaded ? i.llama.audio : false,
    tools: i.llama.loaded ? i.llama.tools : false,
    thinking: i.llama.loaded ? i.llama.thinking : false,
  };
}

/**
 * Unload every text engine (an idle engine is a safe no-op). Used on a model switch so a
 * cross-engine swap (LiteRT <-> llama) can't leave the previous model resident, without the
 * caller branching on which concrete engine held it. Adding an engine is one entry above (OCP).
 */
export async function unloadAllTextEngines(): Promise<void> {
  for (const engine of TEXT_ENGINES) {
    try {
      await engine.unloadModel();
    } catch (e) {
      logger.warn('[engines] text engine unload during switch failed, continuing:', e);
    }
  }
}

/**
 * Invalidate the active engine's cached conversation state before a history rewind (regenerate/
 * edit). LiteRT keeps a native per-conversation KV cache that must be reset; llama has none.
 * Dispatched via the registry so callers don't branch on engine === 'litert'.
 */
export function invalidateActiveConversation(): void {
  const engine = getActiveEngineService();
  (engine as { invalidateConversation?: () => void } | null)?.invalidateConversation?.();
}

/**
 * Returns the service for the currently active text engine, or null if no
 * model is loaded. Use this for operations that both engines support
 * (stopGeneration, isModelLoaded, unloadModel). For engine-specific
 * operations keep the explicit branch — it should be visible at the call site.
 */
export function getActiveEngineService(): typeof llmService | typeof liteRTService | null {
  const { downloadedModels, activeModelId } = useAppStore.getState();
  const model = downloadedModels.find(m => m.id === activeModelId);
  if (!model) return null;
  return model.engine === 'litert' ? liteRTService : llmService;
}
