# Transformation Roadmap — Off Grid → Necessity Labs

## Legend
- [ ] Not started
- [~] In progress  ← [ CURRENT PHASE ] marker lives next to the active phase
- [x] Complete

---

## Phase 0 — Fork & Bootstrap [ COMPLETE ]
- [x] Fork `alichherawalla/off-grid-mobile`
- [x] Run bootstrap script (creates this file and all agent guidance)
- [x] Add GitHub Actions debug APK workflow
- [x] Verify first Actions build passes on upstream code

---

## Phase 1 — Native Layer Audit [x] [ COMPLETE ]

Goal: Fully understand the existing native inference modules before touching anything.
An agent should read each file and produce a summary in docs/NATIVE_LAYER.md.

Tasks:
- [x] Audit `android/app/src/main/cpp/` — **finding:** directory absent in this fork; LLM JNI lives in autolinked `llama.rn` (see `docs/NATIVE_LAYER.md`)
- [x] Audit `LlamaModule.kt` — **finding:** file absent; LLM exposed via `llama.rn` JS API / future Kotlin wrapper
- [x] Audit `StableDiffusionModule.kt` — **finding:** replaced by `LocalDreamModule.kt` (subprocess + QNN/MNN); documented in `docs/NATIVE_LAYER.md`
- [x] Audit `WhisperModule.kt` — **finding:** file absent; Whisper via autolinked `whisper.rn`; documented in `docs/NATIVE_LAYER.md`
- [x] Audit `DownloadManagerModule.kt` — document state machine, race condition fix (`completedEventSent`, `moveCompleted`, `shouldRemoveDownload`)
- [x] Audit `ModelManagerModule.kt` — **finding:** not present in-repo; model lifecycle in TS + `llama.rn` contexts
- [x] Document all findings in `docs/NATIVE_LAYER.md`
- [x] Identify exact RN bridge wiring in `MainApplication.kt` / `MainActivity.kt`
- [x] Map every JS-to-native call in `src/` that we need to replicate in Compose (incl. `startMultiFileDownload` Android gap, legacy `ImageGeneratorModule`)

Commit convention: `audit(phase-1): description`

---

## Phase 2 — Compose Shell Scaffold [x] [ COMPLETE ]

Goal: Replace React Native entry point with a Kotlin/Compose app that calls
the existing native modules directly (no JS bridge).

Tasks:
- [x] Add Jetpack Compose + Hilt + Room + DataStore dependencies to `android/app/build.gradle`
- [x] Remove React Native bridge registration from `MainApplication.kt`
- [x] Remove React Native renderer from `MainActivity.kt`; replace with `setContent { OffGridApp() }`
- [x] Create `OffGridApp.kt` — root Compose entry point with NavHost
- [x] Create `AppTheme.kt` — OLED black (#000000) + teal (#00BCD4) Material3 theme
- [x] Create `HomeScreen.kt` — conversation list
- [x] Create `ChatScreen.kt` — chat UI with streaming token display
- [x] Create `ModelsScreen.kt` — model browser + download manager UI
- [x] Create `SettingsScreen.kt` — app settings
- [x] Wire `DownloadManagerModule.kt` logic from `ModelsViewModel.kt` via `ModelRepository`
- [x] LlamaRepository stub wired to `ChatViewModel.kt` (full JNI wiring deferred to Phase 2+, see LlamaRepository.kt TODO)
- [ ] Verify full debug build passes in GitHub Actions
- [ ] Verify basic chat works on device via sideload

Commit convention: `feat(phase-2): description`

---

## Phase 3 — S Pen + Vulkan + AETHER [x] [ COMPLETE ]

Goal: Add the first Necessity Labs differentiators.

Tasks:
- [x] Create `SpenInputModule.kt` — Samsung S Pen → text via HandwritingGesture API + Samsung SpenRemote SDK (Air Actions via reflection; graceful fallback on non-Samsung devices)
- [x] Wire S Pen input into `ChatScreen.kt` — hover overlay, teal pen icon in input bar, populate TextField on `SpenInputState.Committed`
- [x] Enable Vulkan backend in llama.rn CMakeLists (`-DGGML_VULKAN=ON`) via `scripts/patch-llama-vulkan.js` (idempotent postinstall patch)
- [x] Add Vulkan device selection — `VulkanConfig.kt` + `InferenceBackend` sealed class; backend selector (Auto/CPU/Vulkan/QNN-stub) in `SettingsScreen.kt` backed by DataStore
- [ ] Benchmark: measure tok/s delta CPU vs Vulkan on Adreno 740 ← deferred to after first Vulkan build
- [x] Create `AetherContextBridge.kt` — ContentProvider IPC reading AETHER RF environment snapshot; graceful empty fallback when AETHER not installed; 30-second polling `Flow<AetherSnapshot>`
- [x] Add AETHER as a tool in the tool calling system — `Tool` interface, `AetherTool`, `ToolDispatcher`, wired into `ChatViewModel`
- [x] Update `ChatScreen.kt` to show active context sources indicator (teal RF row below top bar) + AETHER `ModalBottomSheet` with live snapshot

Commit convention: `feat(phase-3): description`

---

## Phase 4 — CODEX + OODA Integration [~] [ CURRENT PHASE ]

Goal: Make the inference layer aware of your personal knowledge graph and
physical environment.

Tasks:
- [x] Create `CodexTool.kt` — queries CODEX Supabase backend (LAN or API)
- [x] Create `OodaContextTool.kt` — pulls structured snapshot from OODA Loop app
- [x] Integrate both tools into tool calling dispatch (`ToolDispatcher.kt`)
- [x] Add `ContextSourceManager.kt` — manages which context sources are active (AETHER + CODEX + OODA), persists enable flags + CODEX config to DataStore
- [x] Create `ContextDashboard.kt` composable — unified multi-source indicator bar + collapsible bottom sheet (replaces Phase 3 AETHER-only indicator)
- [x] Add conversation export to CODEX (ChatViewModel `exportToCodex()` + overflow menu in ChatScreen)
- [ ] Wire Context Sources toggle UI into SettingsScreen (enable/disable per source, CODEX URL + key fields)

Commit convention: `feat(phase-4): description`

---

## Phase 5 — QNN NPU Text Offload

Goal: Push tok/s past the CPU/Vulkan ceiling using the Hexagon 780 NPU.

Tasks:
- [ ] Research llama.cpp QNN backend build requirements for Android
- [ ] Add QNN SDK dependency to CMakeLists
- [ ] Add `-DGGML_QNN=ON` build variant
- [ ] Test QNN offload on Q4_K_M quantized models
- [ ] Benchmark: CPU vs Vulkan vs QNN on 3B, 7B, 13B models
- [ ] Add backend selector in Settings (Auto / CPU / Vulkan / QNN)

Commit convention: `feat(phase-5): description`

---

## Phase 6 — Polish + Necessity Labs Branding

Goal: Prepare for potential Necessity Labs public release.

Tasks:
- [ ] Update `applicationId` to `com.necessitylabs.offgrid` (or chosen name)
- [ ] Update app name, icons, splash screen
- [ ] Add S23 Ultra large-screen split-pane layout (landscape mode)
- [ ] Add Veil of Echoes writing mode (system prompt preset manager)
- [ ] Add character memory sidebar for long-form fiction
- [ ] Performance profiling pass (startup time, memory under load)
- [ ] Release signing config + GitHub Actions release workflow
- [ ] Google Play internal test track

Commit convention: `feat(phase-6): description`

---

## Deferred / Future
- RTL-SDR companion input (AETHER hardware tier)
- DeX desktop mode layout
- Gemma 3n E2B/E4B optimized model profile
- Remote CODEX sync (not just LAN)
