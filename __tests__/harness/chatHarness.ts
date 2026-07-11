/**
 * chatHarness — heavy-entry-point setup for UI-level chat integration tests.
 *
 * Mounts the REAL ChatScreen and drives it via REAL user actions (type into the real input, press the real
 * send button), with ONLY the native leaves faked (via nativeBoundary). Everything we own — the screen,
 * useChatScreen, generationService, the tool loop, the engine services, the stores, residency — runs for
 * real. This is the "integration test, heavy entry point" contract.
 *
 * Usage (the jest.mock for navigation MUST be top-level in the test file — it is hoisted — and points its
 * route at this module's shared `routeHolder`):
 *
 *   jest.mock('@react-navigation/native', () => ({
 *     useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
 *     useRoute: () => require('../../harness/chatHarness').routeHolder,
 *     useFocusEffect: () => {}, useIsFocused: () => true,
 *   }));
 *
 *   const h = await setupChatScreen({ engine: 'llama' });   // installs boundary + loads a real engine
 *   h.render();                                             // mounts the real ChatScreen
 *   await h.send('what is the capital of France', { text: 'Paris.' });  // types, presses send, awaits reply
 *   expect(h.view.queryByText(/Paris\./)).not.toBeNull();
 */
import { installNativeBoundary, requireRTL, GB, type RamProfile } from './nativeBoundary';
import { createDownloadedModel } from '../utils/factories';

/** Shared route params the test's navigation mock reads (set by setupChatScreen). */
export const routeHolder: { params: Record<string, unknown> } = { params: {} };

export interface ChatHarnessOptions {
  engine: 'llama' | 'litert';
  /** 'ios' surfaces the Metal accelerator path for llama; default 'android'. */
  platform?: 'ios' | 'android';
  ram?: RamProfile;
}

const LLAMA_PATH = '/models/small.gguf';
const LITERT_PATH = '/models/gemma.litertlm';

export async function setupChatScreen(opts: ChatHarnessOptions) {
  const platform = opts.platform ?? 'android';
  const ram = opts.ram ?? { platform, totalBytes: 12 * GB, availBytes: 8 * GB };
  const boundary = installNativeBoundary({ llama: opts.engine === 'llama', fs: true, ram });

  // Global boundary polyfill: React 19's error reporter calls window.dispatchEvent; in the node test
  // env there is no window, so an unrelated crash would mask real errors. This is a jsdom/global shim,
  // NOT app logic.
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) g.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };

  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react');
  const rtl = requireRTL();
  const { hardwareService } = require('../../src/services/hardware');
  const { useAppStore, useChatStore } = require('../../src/stores');
  /* eslint-enable @typescript-eslint/no-var-requires */

  // BOUNDARY (not a gesture): a downloaded model = a persisted record (@local_llm/downloaded_models) + the
  // file on disk — exactly what a real download leaves. Downloading is native and can't be gestured in jest,
  // so we pre-place ONLY this. Everything above it (hydration, the picker, selection, load) runs for real.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const AsyncStorage = require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage');
  const { activeModelService } = require('../../src/services/activeModelService');
  const { HomeScreen } = require('../../src/screens/HomeScreen');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const docs = boundary.fs!.DocumentDirectoryPath;
  const fileName = opts.engine === 'llama' ? 'ggml-small.gguf' : 'gemma.litertlm';
  const modelPath = `${docs}/models/${fileName}`;
  boundary.fs!.seedFile(modelPath, 500 * 1024 * 1024);
  const model = createDownloadedModel({ id: 'm', name: 'Test Model', engine: opts.engine, filePath: modelPath, fileName });
  await AsyncStorage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
  await hardwareService.refreshMemoryInfo();

  // GESTURE: mount the real Home screen — its REAL hydration loads the record — then open the picker and TAP
  // the model row. The real handleSelectTextModel sets it active (no setState activeModelId shortcut).
  const home = rtl.render(React.createElement(HomeScreen, { navigation: { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} } }));
  await rtl.waitFor(() => { expect(useAppStore.getState().downloadedModels.length).toBeGreaterThan(0); }, { timeout: 4000 });
  rtl.fireEvent.press(await rtl.waitFor(() => home.getByTestId('browse-models-button')));
  const rows = await rtl.waitFor(() => { const r = home.queryAllByTestId('model-item'); expect(r.length).toBeGreaterThan(0); return r; }, { timeout: 4000 });
  rtl.fireEvent.press(rows[0]);
  await rtl.waitFor(() => { expect(useAppStore.getState().activeModelId).toBe('m'); }, { timeout: 4000 });
  home.unmount();

  // Load via the REAL load path (the app loads lazily on the first send; we trigger the same path so the
  // readiness gate passes deterministically). This is the real native-faked load, not a state shortcut.
  await activeModelService.loadTextModel('m');

  const conversationId = useChatStore.getState().createConversation('m');
  useChatStore.getState().setActiveConversation(conversationId);
  routeHolder.params = { conversationId };

  const harness = {
    boundary, React, rtl, useAppStore, useChatStore, conversationId,
    view: null as ReturnType<typeof rtl.render> | null,

    /**
     * Arrive-via-UI: enable a built-in tool the way the user does — navigate to the Tools tab (a real
     * separate screen) and flip its switch. Shares the same store as ChatScreen, so the enablement is
     * live when we return to chat. NOT settings.updateSettings seeding.
     */
    enableToolViaUI(toolId: string) {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const { ToolsScreen } = require('../../src/screens/ToolsScreen');
      const { Switch } = require('react-native');
      /* eslint-enable @typescript-eslint/no-var-requires */
      const tools = rtl.render(React.createElement(ToolsScreen, {}));
      const row = tools.getByTestId(`tool-picker-row-${toolId}`);
      // The RN Switch toggles via onValueChange (not press) — locate it in the row and flip it.
      rtl.fireEvent(rtl.within(row).UNSAFE_getByType(Switch), 'valueChange', true);
      tools.unmount();
    },

    /**
     * Arrive-via-UI: set a text-generation SliderSetting (e.g. liteRTTemperature, liteRTTopP) by tapping its
     * value into the real numeric input on the real TextGenerationSection — NOT updateSettings seeding.
     */
    setTextSettingViaUI(key: string, value: number) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { TextGenerationSection } = require('../../src/components/GenerationSettingsModal/TextGenerationSection');
      const s = rtl.render(React.createElement(TextGenerationSection, {}));
      rtl.fireEvent.press(s.getByTestId(`setting-${key}-value-button`));
      const input = s.getByTestId(`setting-${key}-input`);
      rtl.fireEvent.changeText(input, String(value));
      rtl.fireEvent(input, 'submitEditing');
      s.unmount();
    },

    /** Let async work (tool loop → tool-result bubble render) settle before asserting. */
    async settle(ms = 300) {
      await new Promise((r) => setTimeout(r, ms));
    },

    /**
     * Tap the real quick-image-mode toggle once (opens the quick-settings popover, taps the image-mode row).
     * Cycles auto → ON(force) → OFF(disabled) → auto. Requires an image model (the toggle refuses without
     * one, alerting "No Image Model").
     */
    async cycleImageMode() {
      const view = this.view!;
      rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('quick-settings-button')));
      rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('quick-image-mode')));
    },

    /**
     * Place a downloaded image model that SURVIVES the ChatScreen's async disk-hydration (which otherwise
     * resets downloadedImageModels to the empty disk). Settles first so hydration has run, then sets +
     * re-asserts. A downloaded model is a native/disk boundary, so seeding it directly is legitimate.
     */
    async placeImageModel(id = 'sd', modelPath = '/models/sd') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createONNXImageModel } = require('../utils/factories');
      const model = createONNXImageModel({ id, name: 'SD', modelPath, backend: 'coreml' });
      await this.settle(50); // let the mount's hydration finish clearing the (empty) disk list
      this.useAppStore.setState({ downloadedImageModels: [model], activeImageModelId: id });
      this.useAppStore.getState().updateSettings({ enhanceImagePrompts: false, imageThreads: 4, imageUseOpenCL: false, imageSteps: 8 });
      boundary.diffusion.module.getLoadedModelPath.mockResolvedValue(modelPath);
      return model;
    },

    /**
     * Gesture-only send: type into the real input + press the real send button, WITHOUT scripting a turn.
     * Use when the test scripts multi-turn native output itself (e.g. boundary.litert.scriptTurns([...]) for
     * a two-pass router). The gesture is identical to send() — only the scripting differs.
     */
    async tapSend(text: string) {
      const view = this.view!;
      const input = await rtl.waitFor(() => view.getByTestId('chat-input'));
      rtl.fireEvent.changeText(input, text);
      rtl.fireEvent.press(view.getByTestId('send-button'));
    },

    /**
     * Arrive-via-UI: turn on "Show Generation Details" by tapping its real segmented control (the same
     * control the settings screen renders). Needed to see the per-message details (model, tok/s, tools
     * sent). NOT settings.updateSettings seeding.
     */
    enableGenerationDetailsViaUI() {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ShowGenerationDetailsToggle } = require('../../src/components/settings/textGenAdvancedSections');
      const s = rtl.render(React.createElement(ShowGenerationDetailsToggle, {}));
      rtl.fireEvent.press(s.getByTestId('show-gen-details-on-button'));
      s.unmount();
    },

    /** Mount the real ChatScreen. */
    render() {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ChatScreen } = require('../../src/screens/ChatScreen');
      this.view = rtl.render(React.createElement(ChatScreen, {}));
      return this.view;
    },

    /**
     * Script the next engine turn, then drive the real user send: type into the real input, press the real
     * send button, and await the assistant reply rendering. `scripted` is what the (faked) native engine
     * returns — the real generation pipeline turns it into the rendered bubble.
     */
    async send(text: string, scripted: { text?: string; content?: string; reasoning?: string; toolCalls?: unknown[] }) {
      if (opts.engine === 'llama') boundary.llama!.scriptCompletion(scripted as { text?: string });
      else boundary.litert.scriptTurn(scripted as { content?: string; toolCalls?: { name: string; arguments: Record<string, unknown> }[] });

      const view = this.view!;
      const input = await rtl.waitFor(() => view.getByTestId('chat-input'));
      rtl.fireEvent.changeText(input, text);
      rtl.fireEvent.press(view.getByTestId('send-button'));
    },

    /**
     * Open the REAL action menu for the last message of `role`, via the requested affordance:
     *  - 'longpress' → long-press the message bubble
     *  - 'dots'      → tap the 3-dots '•••' button in the message meta row
     * BOTH are real user entry points and must both be exercised (they wire the same setShowActionMenu).
     */
    async openActionMenu(role: 'user' | 'assistant', via: 'longpress' | 'dots') {
      const view = this.view!;
      const testId = role === 'user' ? 'user-message' : 'assistant-message';
      const bubbles = await rtl.waitFor(() => { const b = view.queryAllByTestId(testId); expect(b.length).toBeGreaterThan(0); return b; });
      const target = bubbles[bubbles.length - 1];
      if (via === 'longpress') {
        rtl.fireEvent(target, 'longPress');
      } else {
        // The 3-dots '•••' lives inside THIS message's element — scope to it (not the global-last dots,
        // which would be a different message's button).
        const dots = await rtl.waitFor(() => rtl.within(target).getByText('•••'));
        rtl.fireEvent.press(dots);
      }
      await rtl.waitFor(() => { expect(view.getByTestId('action-menu')).toBeTruthy(); });
    },

    /**
     * REAL regenerate gesture: open the action menu (via long-press OR 3-dots) and press "Retry".
     */
    async regenerateLast(scripted: { text?: string; content?: string; reasoning?: string; toolCalls?: unknown[] }, via: 'longpress' | 'dots' = 'longpress') {
      if (opts.engine === 'llama') boundary.llama!.scriptCompletion(scripted as { text?: string });
      else boundary.litert.scriptTurn(scripted as { content?: string });
      await this.openActionMenu('assistant', via);
      rtl.fireEvent.press(this.view!.getByTestId('action-retry'));
    },

    /**
     * REAL edit gesture: open the action menu (via long-press OR 3-dots) → "Edit" → change text →
     * "SAVE & RESEND". The real edit handler rewrites history and re-runs generation.
     */
    async editLastUserMessage(newText: string, scripted: { text?: string; content?: string }, via: 'longpress' | 'dots' = 'longpress') {
      if (opts.engine === 'llama') boundary.llama!.scriptCompletion(scripted as { text?: string });
      else boundary.litert.scriptTurn(scripted as { content?: string });
      await this.openActionMenu('user', via);
      const view = this.view!;
      rtl.fireEvent.press(view.getByTestId('action-edit'));
      const input = await rtl.waitFor(() => view.getByPlaceholderText('Enter message...'));
      rtl.fireEvent.changeText(input, newText);
      rtl.fireEvent.press(view.getByText('SAVE & RESEND'));
    },
  };
  return harness;
}
