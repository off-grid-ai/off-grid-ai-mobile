# Gaps backlog

Honest register of gaps, regressions, dead code, and "not fully done" items. Each
entry has a verdict and evidence. The standing gap agent picks these up, closes
them, and marks them resolved with evidence. Gaps are surfaced, never hidden.

Verdict legend:
- **delete-safe** - unreferenced / unreachable and provably unused; remove it.
- **fix-the-guard** - the branch is SUPPOSED to fire but a condition prevents it; fix the condition (this is a latent bug, not litter).
- **instrument-and-revisit** - uncertain trigger; add a `[*-SM]` trace + a Provit journey to observe it live before deciding.

---

## Dependency-cruiser architecture baseline - 2026-07-10 (PR #510)

Added dependency-cruiser as the STANDING GATE for the architectural boundaries we kept
re-establishing by hand (`.dependency-cruiser.js`; `npm run depcruise`; CI `architecture`
job + pre-push). AGGRESSIVE ruleset, all at `error`; existing debt captured in
`.dependency-cruiser-known-violations.json` (66 violations) so the gate PASSES on current
debt but FAILS on anything NEW. This is the honest register of that baselined debt - burn it
down, never regenerate the baseline to hide a new violation.

**RESOLVED — baseline is now ZERO.** All 61 import cycles were eliminated too (in this release,
per the "break it once, rebuild properly" call). The `.dependency-cruiser-known-violations.json`
baseline file was DELETED — every architecture rule is now fully enforced with no exceptions.
How the 61 collapsed:
- The amplifier: `whisperStore` imported the whole `services` BARREL (which re-exports everything,
  each importing the stores barrel back). Pointing it at the concrete `services/whisperService`
  dropped 61 → 10 in one edit.
- `llm` + `documentService` imported the `stores` barrel → concrete `stores/appStore`.
- Barrel-defines-a-symbol cycles: `theme/index` defined `useTheme` that `useThemedStyles` imported
  back → moved to `theme/useTheme`; barrel only re-exports.
- Type-only back-edges (extracted the shared type to a neutral module both sides import):
  `StreamToken` → `llmStreamTypes`; SSE stream types → `httpClientTypes`; `ImageDownloadDeps` →
  ModelsScreen `types`; the 3 HomeScreen hook cycles → `HomeScreen/hooks/types`.
- The remoteServer value trio: the PURE detectors (detectVision/detectToolCalling) moved out of the
  store-touching `remoteServerManagerUtils` into `utils/remoteCapabilityDetect`, so `remoteServerHelpers`
  imports them from the pure util instead of the service.
Test fixes from the whisperStore import change: 3 suites mocked the `services` barrel; retargeted to
the concrete `services/whisperService` the store now reads (mock the direct module). Full suite 7741 green.

--- historical (the 66→61 step) ---
Baseline was 61 (was 66). The 5 non-cycle violations were FIXED (not baselined):
- utils-stay-pure (3): RESOLVED. `utils/downloadAggregate` → `utils/downloadStatus` (extracted the pure
  status classification + DownloadEntry out of the store; store re-exports for back-compat).
  `utils/imageModelIntegrity` → `utils/modelLoadErrors` (moved the pure Error classes to utils; service
  re-exports). `utils/proPrompt` → `services/proPrompt` (it reads the store + does pub/sub + setTimeout —
  a service, not a pure util; relocated + 3 importers updated).
- no-backward-layering-core (1): RESOLVED. `services/loadModelWithOverride` no longer imports the
  CustomAlert component — the pure AlertState + showAlert/hideAlert factories moved to
  `utils/alertState` (CustomAlert re-exports them); the service builds alert state from the util.
- components-are-leaf-ui (1): RESOLVED. `VoiceModelsUpsell` moved from `screens/ModelsScreen/` into
  `components/models/` (it's presentational); both the sheet and the screen import it from components.

| Rule | Count | Verdict | Note |
|---|---|---|---|
| no-circular | 61 | fix-the-guard (own PR) | Cycles routed through barrel `index.ts` files (`services/index`, `stores/index`) + intra-screen hook cycles (HomeScreen hooks ⇄ useHomeScreen). Break by importing the concrete module, not the barrel, and extracting shared hook state down a layer. A broad import refactor — deliberately its own PR AFTER this release (fixing 61 cycles in a release PR is the destabilizing big-bang we avoid); the baseline guards against NEW cycles meanwhile. |

Resolved by the gate on day one (NOT baselined):
- Engine-DIP: screens importing concrete `litert` → routed through services/engines (see Engine DIP section).
- Dead code: `screens/ChatScreen/toolUsage.ts` (shouldUseToolsForMessage, zero prod callers) deleted with its test.
- Phantom-dep false positives excluded (not debt): `whisper.rn` (declared; `.rn` defeats the resolver),
  `@offgrid/pro` (private open-core submodule wired via metro haste through the one bootstrap loader).

Aggressive rules also active with ZERO current violations (pure forward-guards): not-to-test-from-prod,
not-to-dev-dep, no-phantom-deps, no-deprecated-core (warn).

NOTE: the gate catches the IMPORT-edge half of the DIP rule. The VALUE-branch half
(`model.engine === 'litert'` comparing a store value) is not an edge - guard it with an
ESLint `no-restricted-syntax` rule (follow-up).

## SonarJS in ESLint - burn-down - 2026-07-10 (PR #510)

Added `eslint-plugin-sonarjs` (recommended-legacy) so Sonar-grade bug/smell rules run in normal
lint - FREE, LOCAL, and it covers PRO too (pro has no cloud Sonar project; a private cloud project
is paid-by-LOC). Most rules are at the recommended `error` (forward guard on new code). Six rules
already tripped on legacy core are relaxed to `warn` - ratchet each back to `error` as its count
hits zero. ESLint v8 has no native suppression baseline, hence warn-then-ratchet rather than a
baseline file.

Real bugs SonarJS caught immediately and we FIXED (not warned):
- `openAICompatibleProvider.test.ts`: `expect(... .length >= 0).toBe(true)` - a tautology assertion
  (always true, could never fail). Rewrote to assert the terminal outcome (onComplete fired, no abort).
- `streamingStateMachine.test.ts`: `releasers` - a collection declared + reset but never pushed/read
  (dead). Removed.
- `pro/ui/McpServerModal.tsx`: `borderRadius: open ? 8 : 8` - redundant ternary (same value both
  branches). Fixed to `borderRadius: 8`. (Fixed in the pro submodule - the "SonarJS catches pro" win.)

`no-duplicate-string` is OFF (not warn): it fights RN styling — style literals ('space-between',
'center', color values) repeat by design across StyleSheet objects; a constant per value is noise.
Also unblocks pro's `--max-warnings=0` pre-commit hook.

Warn-level burn-down (core src, ratchet to error as each hits zero):
| Rule | Count |
|---|---|
| sonarjs/prefer-single-boolean-return | 9 |
| sonarjs/no-nested-template-literals | 6 |
| sonarjs/no-collapsible-if | 2 |
| sonarjs/prefer-immediate-return | 1 |
| sonarjs/no-duplicated-branches | 1 |

Test override: `no-identical-functions` + `cognitive-complexity` are OFF for test files (duplicate
arrange/act across cases is clearer than over-DRYed tests); the real-bug rules stay ON for tests.

SonarCloud: CORE uses Automatic Analysis (public project, free) + Codecov for coverage - NO CI
scan job (it would only duplicate Codecov's coverage). PRO is covered by the SonarJS ESLint rules
above, locally - never sent to any cloud project.

## REMAINING tooling to make gates fully BLOCK (fresh session — exact recipe) - 2026-07-10

Decision from the owner: FIX everything, make the gates ERROR/blocking, "once and for all" (no
baseline shortcuts). Two items remain. Both are LOW runtime risk but MESS-PRONE via naive tooling —
this recipe is the clean path (each mistake below was hit and reverted this session):

### 1. knip: remove the 126 unused exported TYPES, then make `npm run knip` a hard CI + pre-push gate
knip config is already correct + committed (single workspace, pro/** entry, jest plugin covers
jest.setup, infra deps ignored, @offgrid/pro haste ignored). Current state: knip is CLEAN except the
126 unused exported types (report-only).
DO:
- Do NOT run `knip --fix --fix-type types` and then `prettier --write` on the touched files — prettier
  EXPANDS pre-existing-unformatted big files past `max-lines`/`max-lines-per-function` (llm.ts,
  TextModelsTab.tsx, useChatScreen.ts, etc. tripped). That's the hygiene anti-pattern. NO prettier.
- knip --fix removes only the `export` keyword, leaving a dead LOCAL type → eslint no-unused-vars.
  So after removing the export, DELETE the whole dead type declaration when eslint flags it unused.
- 2 types break tsc because they're used via `import('...').T` NAMESPACE imports (knip can't see
  those): `ModelEngine` (used in services/modelManager/scan.ts) + `RagSearchResult` (used in
  services/tools/handlers.ts). Fix = re-export them + convert those namespace imports to normal
  `import type { X } from '...'`. (7 namespace-import sites total across the repo — grep
  `import\(['\"][^'\"]+['\"]\)\.[A-Z]` — convert all so knip stays accurate.)
- getDebugLogPath (debugLogFile.ts) is test-only → mark `@public` JSDoc (knip honors it), do NOT delete.
- Gate after: tsc + full `jest --coverage` (7741) + eslint 0 + `npm run depcruise`. Then add
  `npm run knip` to .github/workflows/ci.yml (its own job) + the pre-push hook.

### 2. ESLint typed `@typescript-eslint/no-unnecessary-condition` (the AI dead-branch killer)
Needs typed linting: add `parserOptions.project: ['./tsconfig.json']` (SLOWS eslint a lot) + the
`@typescript-eslint` typed config. The rule floods on AI code (always-truthy/falsy per types).
CAUTION: many "unnecessary" conditions are DEFENSIVE against untyped runtime data (native bridge,
JSON) — blindly deleting them can crash at runtime (hurts customer experience). So: enable, MEASURE
the count, then fix each by hand verifying it's not a real runtime guard (keep + `// eslint-disable`
with a reason where the type lies about runtime). Owner wants it at ERROR eventually; the honest
path to "blocking" without a reckless mass-delete is fix-in-waves. Companion tsconfig flags:
`allowUnreachableCode:false`, `noUnusedLocals/Parameters:true` (measure impact first).

Everything else in the tooling spine is DONE + committed on PR #510: depcruise (0 violations, hard
gate), sonarjs (wired, burn-down), knip (config correct + dead deps/files/value-exports removed,
verified on android assembleDebug + ios pod install), the untyped dead-branch ESLint rules
(no-unreachable/no-constant-condition/no-constant-binary-expression, 0 hits).

---

## Dead-code recon - 2026-07-06

Recon sweep (4 parallel agents over disjoint subsystems) for unreferenced exports,
unreachable branches, duplicated logic, and threaded-but-unread params. All findings
grep-verified. Nothing deleted yet - this is the register; deletions land as their own
small PRs after each is confirmed.

### Model-load / generation

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| ML1 | activeModelService/index.ts:~469 | `getCurrentlyLoadedMemoryGB()` (private wrapper) | instrument-and-revisit | CORRECTION: recon said "zero call sites" but tests DO exercise it (integration + memory unit). Test-only API - deleting needs the tests reworked, not a blind delete. |
| ML2 | activeModelService/index.ts:~475 | `checkMemoryForDualModel()` (public wrapper) | instrument-and-revisit | CORRECTION: exercised by integration tests + mocked in HomeScreen test. Prod never calls it - decide keep-vs-remove in the dead-code PR, with tests. |
| ML3 | activeModelService/utils.ts:16-17 vs types.ts:48-50 | overhead multipliers (1.2/1.3 hardcoded vs 1.5/1.8 constants) | fix-the-guard | HomeScreen memory display disagrees with the load-path math; import the shared constants |
| ML5 | activeModelService/index.ts:~338 + loaders.ts | `cpuOnly: false` (always false) | delete-safe | native CPU-only branch unreachable from TS |

> Note: the recon confirmed the "Load Anyway" flow is NOT dead once the residency gate
> throws a typed `OverridableMemoryError` (shipped in this PR). Before that, the raised
> pre-check budget made `canLoad` almost always true, so the pre-check's Load-Anyway was
> effectively unreachable - the root cause of "Load Anyway stopped happening".

### Download / model-manager

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| DL1 | downloadHydration.ts:33 | `case 'retrying'` in mapNativeStatus | delete-safe | native (iOS+Android) never emits 'retrying' |
| DL2 | DownloadManagerScreen/items.tsx:51,60,81,91 (+ downloadStatusIcon.ts, downloadErrors.ts, useDownloads.ts) | branches on `status === 'retrying'` | fix-the-guard | unreachable given DL1; remove or document the contract |
| DL3 | modelManager/types.ts:13 | `BackgroundDownloadMetadataCallback` (@deprecated, no-op) | delete-safe | author-confirmed no-op, still threaded through 3 sites |
| DL4 | downloadHydration.ts:25 | `export isMmProjFileName` | delete-safe | only used internally; drop the export |
| DL5 | modelManager/download.ts:454-462 | `isFinalizing` reset only on error | instrument-and-revisit | verify re-entrancy window on success path |

### Audio / TTS / STT

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| AU1 | whisperStore.ts:172-189 | `deleteModel()` (vs used `deleteModelById`) | delete-safe | zero call sites |
| AU2 | audioSessionManager.ts:51-57 | `ensurePlayback()` | delete-safe | only referenced in comments |
| AU4 | ChatInput/Voice.ts:136-143 | stopRecording early-return guard | fix-the-guard | inverted condition; can't be true when recording |
| AU5 | whisperService.ts:338-400 | `transcriptionFullyStopped` promise overwrite | fix-the-guard | new start replaces a promise unloadModel may await |
| AU6 | audioRecorderService.ts:12-14 | `supportsDirectAudioInput()` stub `return true` | instrument-and-revisit | placeholder; add real capability detection |

### Image-gen / tools / remote

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| IM2 | localDreamGenerator.ts:67 (+ loaders.ts:296) | `backend` param always `'auto'` | delete-safe | 'mnn'/'qnn' branches never reached from TS |
| IM3 | imageGenerationHelpers.ts:42-44 | iOS short-circuit ignores `backend` | fix-the-guard | 'coreml'/default 'mnn' unreachable on iOS; make explicit |
| IM4 | localDreamGenerator.ts:236-238 | `hasKernelCache()` wraps `hasOpenCLCache` (name mismatch) | fix-the-guard | rename to match native call |
| IM5 | localDreamGenerator.ts:231-239 | `clearOpenCLCache`/`hasKernelCache` silent iOS no-op | instrument-and-revisit | throw or gate at call site on iOS |

### Verification pass - 2026-07-06 (before acting)

Every "delete-safe" candidate was re-grepped across `src`, `__tests__`, and `pro/`.
The recon **over-reported**: most flagged symbols are actually referenced (largely by tests).
Still-open decisions:

- **FALSE POSITIVE - verified USED, keep (drop from register):** AU1 `whisperStore.deleteModel`,
  AU2 `audioSessionManager.ensurePlayback`, DL4 `isMmProjFileName`, ML1/ML2 (test-exercised).
- **DEFERRED (not "dead", changing risks behaviour):**
  - Unreachable-branch removals (DL1/DL2 `retrying`, IM3 iOS backend short-circuit): removing a
    value from a status/type union risks exhaustiveness breakage; do it as a typed refactor with tests.
  - Threaded-constant params (ML5 `cpuOnly`, IM2 `backend:'auto'`): passed to the native bridge;
    removing the arg changes the native call. Not safe to cut blind.
  - Race/stub items (AU4/AU5/AU6, DL5, DL3): need on-device observation - `instrument-and-revisit`.

### Handling policy (how we close these)
1. **delete-safe** → each removed in a small, single-concern PR with a grep proof of zero references in the description.
2. **fix-the-guard** → fix the condition, add a fails-before/passes-after test that exercises the now-reachable branch.
3. **instrument-and-revisit** → add a `[*-SM]` trace + a Provit journey; only decide delete-vs-keep after observing it live.
4. **Standing gate** → add `knip` (or `ts-prune`) to CI to catch category-1 (unreferenced) dead code continuously, so this register only ever needs the reasoning-heavy categories.

---

## Image-gen QNN over-recommendation on non-flagship Snapdragons - 2026-07-08

**Verdict: fix-the-guard (DEFERRED - needs a curated SoC allowlist + on-device rounds, intentionally out of the current release).**

**Symptom (observed live on an AC2001 / OnePlus Nord, SoC SM7250):** the app recommends
a QNN/NPU image model, the user downloads + loads it, and the native local-dream process
crashes: `Failed to load image model: Server process exited with code 1. Your device
(SM7250) may not support this model's backend. Try a CPU model instead.` So it recommends
NPU and then reports NPU unsupported - a self-contradiction.

**Root cause (`src/services/hardware.ts`):**
- `classifySmNumber` buckets every non-flagship Snapdragon into `'min'` (the catch-all,
  the `return 'min'` after the 8gen1/8gen2 sets).
- `hasNPU = vendor === 'qualcomm' && !!qnnVariant` → `'min'` counts as NPU-capable → `true`.
- `getQualcommImageRec` returns `recommendedBackend: 'qnn'` for ALL variants (incl. `'min'`),
  with `compatibleBackends: ['qnn','mnn']`.
- So a SoC like SM7250 (Hexagon that can't actually run the QNN image binaries) is told QNN
  works, passes the pre-load gate (`checkImageModelCanLoad` only blocks qnn when `!hasNPU`),
  and crashes at runtime.

**Fix direction (do properly, not rushed):** QNN capability must be a narrow, verified set
(8gen1/8gen2, or an explicit allowlist), not "any Snapdragon". Then `hasNPU`/recommendation
key off ACTUAL QNN-capability; the catch-all recommends `mnn` (reliable GPU/CPU). That fixes
both the bad recommendation and the runtime crash (the pre-load gate would also block a
manually-selected qnn model with a clear message instead of a hard crash). Needs device
verification on affected SoCs (SM7250 and at least one true 8gen1/8gen2) before shipping -
hence deferred, not patched blind.

---

## Image-gen inline preview not shown on first run - 2026-07-08

**Verdict: instrument-and-revisit (native-emission behaviour, not a JS/UI bug).**

Observed on-device (OnePlus Nord, mnn/OpenCL, first run): the "Generating Image" card
showed no inline preview thumbnail. The UI IS wired correctly — `ChatScreenComponents`
renders `imagePreviewPath` when set, fed by imageGenerationService's onPreview →
appStore. The preview only appears when the NATIVE localdream module includes
`previewPath` in its progress events (`localDreamGenerator.ts:123`, optional field). No
preview events were emitted for this run — consistent with first-run OpenCL kernel
compilation skipping the (expensive) intermediate-latent decode while warming.

Next: confirm whether previews appear on a SECOND (warmed) generation. If they do, this
is expected first-run behaviour (optionally: show a "preview available after first run"
hint). If they never appear on mnn, it's a native gap in the localdream preview path to
fix on the native side — the JS/UI layer is already correct, so no JS change is warranted.

---

## On-device test session - 2026-07-09 (Qwythos-9B vision + memory, 12GB iPhone/Android)

Surfaced live on real hardware during 0.0.103 vision/memory testing. None caught by the
green suite — the reason the on-device gate is mandatory. Verdicts + evidence below.

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| OD1 | **Vision (mmproj) dropped on download retry** | fix-the-guard | `[DL-SM]` iPhone: main GGUF failed at 9% ("network connection lost") → auto-retry re-issued `needsMmProj:false, mmProjLocalPath:null` → finalized text-only (`savedEngine:llama`, `mmProjFileExists:false`). release/0.0.103 fix (persist metadataJson) targets this; UNVERIFIED on-device. |
| OD2 | **Repair Vision has no progress feedback** | fix-the-guard | ~900MB mmproj re-download behind an indeterminate "Repairing…" spinner; `[linkOrphanMmProj] recovered` eventually fired ("Vision Repaired"). Needs determinate progress. USER-SELECTED to fix. |
| OD3 | **Chat vs Home model-selector inconsistency** | fix-the-guard | `checkMemoryForModel` is called ONLY in `useChatModelActions.ts` (:96, :311). Chat pre-checks (predictive fileSize×1.5 ≈ 8.4GB for the 9B → critical on 12GB → gates behind "Load Anyway"); Home skips the pre-check → loads via `makeRoomFor` (measured) → succeeds. Two surfaces, one decision, divergent logic. USER-SELECTED to fix. |
| OD4 | **UI freeze on forced heavy load (Load Anyway on 9B multimodal)** | instrument-and-revisit | Only iOS native edge-swipe worked; all RN touchables dead; debug log stopped emitting = JS thread blocked by the synchronous native load of ~6GB + vision projector. The failure the override survival-floor is meant to prevent; installed build predates the release/0.0.103 fix. |
| OD5 | **Android download retry doesn't resume after network drop** | instrument-and-revisit | `[DL-SM]` android: Qwythos errored at 75% ("Network connection lost"), retry dispatched (WorkManager resume in place) → NO further progress milestones. Partly a real WiFi drop; retry-not-resuming is the reliability gap. |
| OD6 | **Kokoro TTS asset stuck loop** | instrument-and-revisit | android log: `[KOKORO-DL] checkAssetStatus → downloading (phase=ready progress=1.00 genuineCompletion=false)` spamming — stuck "downloading" while phase=ready/progress=1.0. |
| OD7 | **Thinking toggle missing for Qwythos-9B in settings** | instrument-and-revisit | Model has reasoning (HF tags: reasoning) + emits `<think>`, but settings shows no thinking toggle. Capability detection gap for community GGUF. |
| OD8 | **Voice-mode thinking not streamed (appears suddenly)** | instrument-and-revisit | Thinking renders live in text chat but batches in voice mode. Suspected in the audio-layout display path (`pro/audio/ui/AudioModeLayout.tsx`), not just the TTS sentence-queue (`pro/audio/streamingSpeech.ts`). Needs the display seam confirmed before fix. USER-SELECTED to fix. |

## More on-device TTS findings - 2026-07-09 (later)

| # | Finding | Verdict | Status |
|---|---------|---------|--------|
| OD9 | **TTS speaks tool-call content aloud (voice mode)** | fix-the-guard | DELEGATED (fix/tts-strip-tool-calls). streamingSpeech `answerOf` strips thinking only; `enqueueReadySentences` runs stripControlTokens per-SENTENCE-fragment, so a `<tool_call>…</tool_call>` block spanning sentence boundaries leaks in fragments. Fix: withhold+strip whole control-token blocks before segmentation (mirror the thinking withhold). Red-first. |
| OD10 | **TTS stops mid-speak** | instrument-and-revisit | `[TTS Store] Engine error: KOKORO_SPEAK The model is currently generating` + `stream segment FAILED session=1 fails=2` — a double-speak concurrency collision aborts the stream mid-sentence. Needs the speak/stream serialization checked (a second speak fired while the first was still generating). |

| OD11 | **Voice mode can't stream TTS alongside a large LLM (falls back to end-of-turn speech)** | fix-the-guard | With a big model resident (Qwythos 9B, ~6GB), the single-model residency rule blocks the ~82MB Kokoro TTS sidecar from co-loading (`[Whisper] Skipping load — no room alongside the active model (single-model rule)`), even with 4.4GB free (os_procAvailMB=4405). streamingSpeech loops `stream feed SKIP: engine not warm` (442× in one turn) then falls back to onStreamingEnd speaking the whole message at generation end. Works, but no live streaming + long silence + log spam. Fix: allow SIDECAR types (tts/whisper/embedding) to co-reside with a generation model when real free RAM fits them (they're tiny), rather than subjecting them to single-model eviction. |

| OD12 | **9B loads slowly on CPU + feels frozen (GPU too small → CPU fallback, threads=1)** | instrument-and-revisit | CORRECTED (earlier entry wrongly said 'freeze / survival-floor hole'): the Qwythos 9B DID load and generate (log: `Model loaded, vision/tools/thinking: true` at 11:54:28, first token 11:55:20). GPU (Adreno 4.6GB) can't hold the 9.3GB model → `cannot be used with preferred buffer` → CPU fallback (all 32 layers). On CPU with **threads=1** (app default is nThreads:0/auto — investigate the 0→1 resolution) the load took ~1m43s with a janky/unresponsive 'Loading Qwythos…' UI = the 'frozen' feeling. Not a hard freeze, not a survival-floor hole (it genuinely fit). Fixes worth doing: (a) ensure threads resolves to a sane core count for large models, (b) keep the UI responsive during a long native load (load off the JS/UI-blocking path / progress), (c) OD13 below on the reasoning-format mismatch. |
| OD13 | **Qwythos output goes entirely to reasoning_content (thinking), answer content undefined** | instrument-and-revisit | Generation logs show `content: undefined, reasoning_content: "The"` and `token: "<|channel>"` (harmony/Gemma-style channel tokens) while `reasoning_format=deepseek`. The model's actual reasoning delimiters don't match the configured format, so the whole turn is classified as thinking with no final answer surfaced — the 'weird thinking/no proper answer' behavior. Model-format vs parser mismatch (Qwythos is a creative merge). Needs reasoning_format detection per model, or accept it's a bad-fit model.
## RESOLUTION note - 2026-07-09: OD4 / OD11 / OD12 root cause = threads=1

On-device follow-up: the iOS "touch-dead freeze" (OD4) and Android "slow/feels frozen" (OD12)
were the SAME root cause — the 9B ran with `threads=1` (device default nThreads:0/auto was not
resolving to a sane core count; device has 8 cores). Single-threaded native inference blocked
long enough to starve the iOS main/JS thread (touches dead; native swipe survived) and crawl on
Android. Raising the CPU thread count made BOTH fast and responsive — confirmed on device.
Not a regression from release/0.0.103; a config/default issue.

Follow-up (own PR, not this branch): investigate why nThreads resolved to 1 instead of auto/
core-count for large models (see `[LLM] Resolved params: threads=1`); ship a sane default.
GPU/NPU are NOT viable for this model (Adreno OpenCL max-alloc 1GB can't hold 9.3GB weights →
CPU fallback; Hexagon NPU experimental + needs QNN-converted models; Qwythos is SSM-hybrid).
CPU-with-proper-threads is the path. The devicectl "developer disk image could not be mounted"
is a Mac-side tooling wedge (iOS 26.5.1), independent of the app — reconnect to clear.

## New bug reports - 2026-07-09 (Slack #bugs, during 0.0.103 review)

| # | Finding | Verdict | Note |
|---|---------|---------|------|
| OD15 | **"Generation Error: Unable to generate parser for this template / Jinja: Conversation roles must alternate" on model switch after a tool call** | fix-the-guard | From llama.rn native minja compiling a chat_template whose Jinja asserts strict user/assistant alternation, when tools are enabled (tool-call parser generation) and/or history has assistant+tool+assistant sequences. NOT caused by 0.0.103 (OD14 added a field to an existing message, no new message; OD3 didn't touch templates). Pre-existing. Fix: graceful fallback — catch the local tool-parser-generation failure and retry WITHOUT tools (the app already does this for REMOTE via isToolGrammarError; add the LOCAL equivalent), instead of a hard "Generation Error". Also consider sanitizing/merging roles before formatting for strict-alternation templates. Separate PR. |
| OD16 | **Remote model capabilities feel flaky across Ollama / LM Studio / OGA Desktop** | instrument-and-revisit | remoteModelCapabilities has 39 unit + 4 integration tests, per-provider — but all FIXTURE-based. Real-world flakiness is likely response-shape variance across provider versions the fixtures don't capture. Fix: capture real /props (OGA Desktop gateway), /api/show (Ollama), /v1/models (LM Studio) from LIVE instances as integration fixtures; harden derivation against missing/variant fields; add a provider-abstraction contract test so each provider's shape → derived caps is guarded. All three must work well (stated priority). Separate workstream. NOTE: 0.0.103's OD7 fix already made reasoning-detection single-source local+remote (small consistency win). |

## Prod review - Android image-gen "Resend" fails with "model cannot be loaded" - 2026-07-10
**Verdict: investigating (possible regression "after the update").** 1★ Android review: after
updating, an image-generation "Resend" errors that the model can't be loaded. Suspects to rule out
in THIS PR: (a) Fix C local/remote mutual-exclusion or the engine/readiness changes touching the
image dispatch/resend path, (b) image model residency/eviction interaction with the text-engine
unload changes. Reproduce the resend flow (dispatchGeneration → image route → loadImageModel) and
confirm whether the image model load path regressed vs main. Needs a meaningful regression test on
the image resend→load path + on-device confirm.

## Repo-wide /hygiene audit - 2026-07-09 (SOLID §A/§B + DRY §C, all spot-verified)

Through-line: decision/capability logic derived ad-hoc at many call sites instead of owned once
by a service. Two findings (DR1, DR3) are root-cause siblings of today's shipped bugs.

### SOLID (§A/§B)
| # | Location | Verdict | Fix |
|---|----------|---------|-----|
| SO1 | src/screens/ModelsScreen/TextModelsTab.tsx:143 handleRetryDownload | BLOCKING | Renderer re-implements download retry (Platform.OS branch, store mutation, mmproj, polling) — CLAUDE.md L100 says this moved to ModelDownloadService. Delete; delegate to modelDownloadService.retry() like useDownloadManager:278. |
| SO5 | src/screens/ModelsScreen/ImageFilterBar.tsx:55,73,91,129,139,149 | DEBT | Platform.OS chooses which filter DIMENSIONS exist. Data-driven filter descriptor from service. |
| SO6 | src/services/remoteServerManagerUtils.ts:122 | DEBT | provider instanceof OpenAICompatibleProvider to call updateCapabilities. Put on the provider interface (ISP). |
| SO7 | pro/audio/ttsStore.ts:377,385 | DEBT | instanceof OuteTTSEngine for cache ops. Optional getAudioCacheSizeMB?/clearAudioCache? on TTS engine interface. |
| SO8 | src/stores/remoteServerHelpers.ts:32,188 | DEBT-low | kind==='vision' capability branch; fold into shared deriveRemoteCapabilities. |

### DRY (§C)
| # | Location | Verdict | Fix |
|---|----------|---------|-----|
| DR2 | ~~remoteServerManagerUtils vs ModelsScreen/utils + huggingface~~ | RESOLVED | Unified onto `utils/visionModel.ts` (VISION_NAME_PATTERNS + VISION_TAG_PATTERNS + looksLikeVisionModel). All 3 consumers import it; cross-consumer test asserts remote (detectVisionCapability) + local (getModelType) agree for Pixtral/Moondream/InternVL/qwen-vl/minicpm-v/yi-vl (the previously-divergent set) + a contract test over every pattern. |
| DR3 | src/screens/HomeScreen/components/ModelPickerSheet.tsx:63,201 (*1.8/*1.5, -1.5) | DRIFTED (live) | Third memory-fit verdict bypassing memoryBudget.ts (self-declared single source). Can say "fits" when residency refuses — the Load-Anyway/selector bug family. Call modelMemoryBudgetMB. |
| DR4 | CHARS_PER_TOKEN=4 bare literal in llmHelpers,liteRTCompaction,litert,llm,generationServiceHelpers,providers/*,documentService (const only in contextCompaction:34) | DEBT | Export CHARS_PER_TOKEN_ESTIMATE + estimateTokens(); all import. |
| DR5 | STOP_TOKENS (llmHelpers:427) + CONTROL_TOKEN_PATTERNS (messageContent:1) + tests re-hardcode | DEBT | One token registry; derive stop-list + strip-patterns; tests import. |
| DR6 | pro/audio outetts:363 + ttsService:207 '<\|im_end\|>' | DEBT-low | Shared IM_END_TOKEN. |
| DR8 | remoteModelCapabilities:202 deltaHasThinking vs openAICompatibleStream:155 | DEBT | Shared REASONING_DELTA_FIELDS + deltaHasReasoning(delta). |

### Test quality (§D) - 371 files, ~13 with a genuinely weak top-tier block
| # | File | Verdict | Fix |
|---|------|---------|-----|
| TQ1 | __tests__/**/useDownloads.test.ts | WORST | Fakes the reducer under test (hand-sets entry.status then asserts the spy) - 37 call-asserts, 0 real-state. Drive real useDownloadStore; assert getState().downloads[key].status. |
| TQ2 | ChatScreenSpotlight (step 3→12 block) | WORST | Block ends after advanceTimersByTime with ZERO expect() - can never fail. Assert the coachmark text. |
| TQ3 | Spotlight trio (Chat/Home/ModelSettings Spotlight, ~40 tests) | HIGH | Assert goTo(<int>) not the coachmark; unmock react-native-spotlight-tour, assert getByText(coachmark). |
| TQ4 | useChatGenerationActions.test.ts (132 called vs 16) | HIGH | L932 tautology + mock-on-mock "message appeared"; assert store/rendered outcome. |
| TQ5 | coreMLModelUtils "downloads sequentially" | MED | Asserts order that only holds by .map push order while impl uses Promise.all - false guarantee. Assert real ordering w/ dynamic out-of-order mock or drop the claim. |
| TQ6 | render tests w/ no getByText: TTSButton, ModelFailureCard, ImageGenAdviceCard, ToolAccordionStreaming, ModelsManagerSheet, McpAddServerSheet, PlaybackControls, KokoroTTSBridge | MED | Assert visible content/state, not just container testID. |

## Parse-once-at-boundary refactor - REMAINING device gate (2026-07-09)
Steps A-C + native-first are DONE (committed on branch refactor/parse-once-boundary; single
REASONING_DELIMITERS + TOOL_CALL_OPENERS/CLOSERS grammars; DR1/DR7 closed; contract + integration
tests green). What is LEFT:

Step 5 = ON-DEVICE PROOF (GATE before any beta/release, §H):
- The native-first flip (buildThinkingCompletionParams Gemma4 reasoning_format 'none'→'auto') is a
  RUNTIME behavior change, NOT verified on-device. Run a Gemma4 thinking + tool-call flow on Android
  dev build (ai.offgridmobile.dev) AND iOS; pull Documents/offgrid-debug.log; grep [GEMMA-FALLBACK].
  - If it NEVER fires → native 'auto' works → DELETE parseGemmaNativeToolCalls + Gemma <|channel>
    branches (dead) + narrow the hand-parsers to the remote-only fallback.
  - If it fires → native 'auto' does NOT cover Gemma in this llama.rn build → keep the hand-parser;
    the grammar work is the fallback. (Relates to OD13; 'auto' may also fix OD13.)
- Must not ship the native-first flip in a beta until this device check passes (TestFlight is
  distribution-signed → no container logs; verify on the dev build first).

## Pre-existing: mid-chat model switch doesn't refresh chat state until remount - 2026-07-10
**instrument-and-revisit** | Reported on-device (iOS, gemma-4 local + remote), confirmed present on the OLD build (NOT introduced by the parse-once/selection/whisper work). Loading a new model from within the Chat screen mid-conversation does not update the screen's derived active-model state - it's not a freeze/hang; navigating Home → back into the chat re-syncs and it works. Suspect useChatModelStateSync / the chat's derived activeModel not re-running after an in-chat load (the model loads fine; only the screen's projection is stale). Fix separately with its own on-device repro - do NOT bundle into the current release PR (scope + risk).

## Device-verification gate before release (PR #510)
Unverified-on-device changes that MUST be checked on the Android dev build (ai.offgridmobile.dev)
+ iOS before shipping (§H - device-gate unverified fixes):
- Platform-aware override memory floor (700MB Android / 1200MB iOS, physical-based, no swap credit) -
  confirm a tight-memory LiteRT load refuses cleanly (no OOM) via [MEM-SM].
- doUnloadTextModelLocked now unloads the ACTIVE engine (LiteRT eviction frees native memory) -
  confirm [MEM-SM] on a LiteRT→llama switch under pressure.
- Readiness change: ensureModelReady/ensureModelLoadedFn now require isModelLoaded() (desync guard).
- Native-first Gemma flip - see the parse-once Step 5 gate above ([GEMMA-FALLBACK]).
- iOS collapsed thinking-box width fix - screenshot check.
