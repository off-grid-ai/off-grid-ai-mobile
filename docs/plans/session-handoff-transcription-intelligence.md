# Session Handoff — Transcription, CoreML, Grammar & Recorder Intelligence

**Date:** July 2026
**Branch:** `feat/vad-gated-recorder` (core) — pro changes are in the `pro/` submodule working tree
**Audience:** a new Claude chat / agent picking up this work
**Status of code:** everything below is **implemented but NOT committed** unless it says otherwise. Run `git status` in both the repo root and `pro/` to see the working tree before doing anything. iOS changes work on the current binary (JS reload only); the LiteRT change needs an Android rebuild.

> This doc is a narrative + reference handoff, not a spec. It captures *why*, *what state things are in*, and *where to look* so you can continue without re-deriving. Features that are "figuring out" are genuinely open, not cancelled.

---

## 0. How to use this doc

1. Read §1 (philosophy) and §2 (uncommitted state) first — they frame everything.
2. Each workstream in §3 is self-contained: what, why, current state, files, how to verify, open questions.
3. §4 is research/decisions already made (don't re-litigate). §5 is open decisions awaiting the user.
4. §6 is the file index. §7 is the log-grep cheat sheet for on-device verification.
5. **Working norms** are in §8 — read them before you commit, push, or build anything.

---

## 1. Product philosophy & principles

These are the through-lines behind every decision in this session. Internalize them; they decide tradeoffs.

- **On-device / privacy by architecture, not by promise.** Everything runs on the phone — models in RAM, no cloud relay. When we say private, we mean the mechanism (the model runs locally, nothing is sent), never a slogan. Any "sync" (desktop bridge) stays LAN-only.
- **Honest limitations over hype.** We state exactly what a feature does and does not do. Example: tinydiarize marks *where* speakers change, not *who* — the UI says "Speaker 1/2" but the doc/notes are explicit it's turn-alternation, not identity. We never overclaim (no "3× faster" without the measurement).
- **Proof-first claims.** Numbers come from measurement (we ran the SenseVoice/Whisper benchmark locally; we time CoreML load with real logs), not from vibes.
- **Never auto-delete or silently evict user data.** Recordings/transcripts: surface problems, let the user decide. Reversible/soft only.
- **Open-core architecture.** Public `@offgrid/core` + private `pro/` submodule (`@offgrid/pro`, repo `off-grid-ai/mobile-pro`). Pro is registered via `activateLocket(registry)` behind an entitlement; **core never imports pro**. Pro injects UI through registries/slots (`registerScreen`, `registerSettingsSection`, `registerSlot`). `docs/plans/` is gitignored in core precisely so handoff docs like this one don't leak pro details.
- **Design to abstractions (SOLID).** Multiple interchangeable backends (llama.rn / LiteRT / remote providers; whisper on CPU/CoreML) sit behind a service layer. UI/stores must not branch on a concrete backend.
- **Feature-first, then harden.** During iteration, get it building + on-device first; defer lint/test cleanup until it works (never `--no-verify` except the one env-broken native hook). Prefer the simplest additive fix; don't add fragile abstractions.
- **Design system is mandatory for UI.** `TYPOGRAPHY`/`COLORS`/`SPACING` tokens only, weights ≤ 400, `react-native-vector-icons` (Feather default) — never emojis, never hardcoded values. Brand voice guide governs all copy (no em dashes, no exclamation marks, no forbidden words, proof-first).

---

## 2. Uncommitted state — what's in the working tree right now

Nothing here is committed. A new agent must decide (with the user) what to commit and in what stacked-PR order. Grouped by workstream (details in §3):

**Core (`src/`)**
- `src/services/whisperModels.ts` — `WhisperModel` interface + `coreMLUrl` per model; tdrz reuses small.en encoder.
- `src/services/whisperService.ts` — CoreML encoder download/unzip/rename, asset-driven `useCoreML`, backfill, `initWhisper` timing log, transcribe-dispatch log.
- `src/stores/devInferenceStore.ts` — **new**, dev grammar harness store (persisted).
- `src/services/devInference.ts` — **new**, grammar-override helper (validate/apply/fallback + maxWords cap).
- `src/components/DevGrammarModal.tsx` — **new**, dev grammar modal (GBNF + LiteRT constraint fields).
- `src/services/llm.ts`, `src/services/llmToolGeneration.ts` — wire dev grammar into the two local completion paths.
- `src/screens/ChatScreen/ChatScreenComponents.tsx` — `__DEV__` terminal button opens the modal + logs.
- `src/services/litert.ts` — routes a LiteRT decoding constraint to the native module before `resetConversation`.
- `android/app/src/main/java/ai/offgridmobile/litert/LiteRTModule.kt` — LiteRT constrained-decoding probe (needs Android rebuild).

**Pro (`pro/`)**
- `pro/locket/ui/BatteryDrainStat.tsx` — added `compact` prop.
- `pro/locket/ui/RecorderHomeCard.tsx` — renders `<BatteryDrainStat compact />` while recording.
- `pro/locket/ui/LocketSettingsSection.tsx` — "Recorder" nav row → the recorder dashboard.
- `pro/locket/screens/LocketPlayerScreen.tsx` — stop-transcribe optimistic-idle fix; **speaker-turn rendering**.
- `pro/locket/services/transcribeChunked.ts` — progress-guard-after-stop; step + timing logs.

---

## 3. Workstreams

### A. Whisper CoreML encoder shipping (iOS) — **the headline change**

**Why:** iOS whisper was running CPU-only. The CoreML encoder runs whisper's encoder on the Apple Neural Engine (~2-3× faster encode, frees CPU) — the single highest-leverage iOS speedup. It was never wired: no `.mlmodelc` shipped, `useCoreML` defaulted false, and the load guard disabled it when the asset was missing.

**State:** implemented (JS + assets, no pod change — whisper.rn's iOS pod is already built with `-DWHISPER_USE_COREML`). Works on the current iOS binary after a JS reload + a model (re)download. **On-device verification pending** the actual `Core ML model loaded` confirmation.

**How it works now:**
- Catalog (`whisperModels.ts`) has `coreMLUrl` per model (ggerganov's `ggml-<id>-encoder.mlmodelc.zip`) for tiny/base/small/medium (+`.en`) / large-v3 / large-v3-turbo.
- `ensureCoreMLEncoder(modelId)` (iOS-only, non-fatal) downloads the zip, unzips next to the `.bin`, and — because the zip's internal dir is named after the source model — **renames** it to the path whisper.cpp derives (`ggml-<id>.bin` → `ggml-<id>-encoder.mlmodelc`). Called from `downloadModel` after the `.bin` validates.
- `loadModel` drives `useCoreML` purely off **asset presence** on iOS (not a user toggle) — if the encoder dir exists, CoreML is on; enabling it *without* the asset is what crashed A12 devices, so presence is the gate.
- **Backfill:** models downloaded before this change get the encoder fetched in the background on next load (once per session), so the load *after* that uses the ANE.

**Verify:** grep `[Whisper][CoreML]` for `START download` → progress → `READY`, then on next load `encoder PRESENT … requesting Neural Engine` and the native `whisper_init_state: Core ML model loaded`. If instead `failed to load Core ML model` → it fell back to CPU (safe) and we investigate.

**Open:** the automatic background backfill downloads a sizeable encoder (tens–hundreds of MB) even on cellular — user may want it gated to WiFi / explicit opt-in. First-run ANE compile adds a one-time delay ("first run on a device may take a while").

### B. Speaker diarization (tdrz) — rendering + CoreML reuse

**Why:** user selected "Small (speaker turns)" (`small.en-tdrz`) and (1) it was very slow, (2) no speakers showed.

**Root cause of "no speakers":** whisper.rn *does* append ` [SPEAKER_TURN]` to segment text on iOS when `tdrzEnable` fires — but `LocketPlayerScreen.cleanTranscript` stripped **all** `[...]` tokens, deleting the markers.

**State (implemented):**
- `cleanTranscript` now converts `[SPEAKER_TURN]` → a line break first, then strips other noise brackets (`[BLANK_AUDIO]` etc.), preserving newlines. Added `stripSpeakerTurn` helper.
- Segment render computes `speakerRows`: walks segments, alternates **Speaker 1/2** at each turn marker, strips the literal token, shows a `Speaker N` label at each change. Labels only appear if ≥1 turn was detected. Chat-attach also strips the marker.
- **Honest limitation:** tdrz gives turn boundaries, not identity — "Speaker 1/2" is alternation.
- **CoreML reuse for tdrz:** the tdrz checkpoint (akashmjn) ships no CoreML encoder, but its **encoder is architecturally identical to `small.en`** (tdrz only fine-tunes the decoder). So the tdrz catalog entry's `coreMLUrl` points at `small.en`'s encoder, and the download flow renames it to the tdrz path. `ALLOW_FALLBACK` means if it's ever incompatible it logs `failed to load Core ML model` and drops to CPU — safe to try.

**Verify:** Speaker labels appear on existing tdrz recordings after a JS reload (markers already in stored segments). For the CoreML reuse, watch for the `reused ggml-small.en-encoder.mlmodelc → ggml-small.en-tdrz-encoder.mlmodelc` log then `Core ML model loaded`.

### C. Stop-transcribing button (iOS) — fixed

**Why:** tapping Stop appeared to do nothing on iOS.

**Root cause:** `handleStopTranscribe` set `transcriptStatus='idle'` *after* `await whisperService.stopFileTranscription()`, but whisper.rn's native stop doesn't resolve until the current chunk finishes — so the button stayed "Stop transcribing" for seconds.

**Fix (implemented):** flip status to `idle` **optimistically before** awaiting the native cancel; `stoppedRef` still prevents a late `done` write. Also guarded `transcribeChunked`'s progress writes so the % doesn't creep after stop. **Caveat:** whisper.rn can't abort mid-chunk — the in-flight chunk's compute still finishes in the background (bounded by `CHUNK_MS`); this fix changes *perceived* behavior. True mid-chunk abort needs a whisper.rn `abort_callback`.

### D. Battery drain chip on the app Home screen

**Why:** user wanted to see battery drained since recording started, on the app home (not just the recorder screen).

**State (implemented):** extended `BatteryDrainStat` with a `compact` prop (drain-since-start only, only while recording) and rendered it inside `RecorderHomeCard` (the pro card already injected into the core Home via `SLOTS.homeRecorder`). **Accuracy caveat documented:** it's device-wide drain (not recorder-attributable), iOS reports in ~5% steps (coarse/laggy), %/hr is noisy early, and the baseline resets on relaunch.

### E. Recorder dashboard reachable from Settings

`AlwaysOnTranscription` (the recorder dashboard: live status, reminders, battery) was registered but orphaned. Added a "Recorder" nav row at the top of `LocketSettingsSection`.

### F. Chat grammar test harness (dev-only)

**Why:** validate the "GBNF grammar + prefill + temp 0" recipe on the real on-device model before wiring structured output into recorder insights. Plan doc: `docs/plans/chat-grammar-test-harness-plan.md`.

**State (implemented, `__DEV__`-gated):**
- `devInferenceStore` (persisted) holds grammar, temperature, assistantPrefix, maxWords, lastError, + LiteRT constraint fields.
- `devInference.applyDevGrammarOverrides(params)` mutates an in-flight llama.rn completion: injects `grammar`, overrides `temperature`, appends prefill as a trailing assistant message, **strips tools** (a custom grammar can't coexist with the tool grammar), applies a `maxWords`→`n_predict` cap (also guards runaway `item+` grammars). Validates the grammar in JS first (must have `root`/`::=`) so a malformed one never reaches native; runtime rejects fall back ungrammared (never bricks chat).
- Wired into both local completion paths (`llm.ts generateResponse`, `llmToolGeneration.ts generateWithToolsImpl`) with try/catch fallback. No-op when disabled → zero production impact.
- UI: `DevGrammarModal` (terminal icon in `ChatHeader`, `__DEV__` only) with a starter GBNF.
- Extensive `[DevGrammar]` logs (ARMED → APPLIED → reached native completion).

**Note:** llama.rn/GGUF only (GBNF is a llama.cpp sampler feature). On LiteRT the GBNF simply doesn't apply.

### G. LiteRT constrained decoding — **probe only, unverified**

**Why:** LiteRT (Android, Google AI Edge) has its own constrained decoding, requested as the LiteRT analog of the GBNF harness.

**Findings:** our SDK (`litertlm-android:0.11.0`) exposes it via `ExperimentalFlags.enableConversationConstrainedDecoding` + an `OptionalArgs` map on `sendMessage` under key `decoding_constraint`. Backend is **LLGuidance** — takes **JSON schema / Lark grammar / regex** (`constraint_type` + `constraint_string`), **NOT GBNF**. Android-only; needs a native rebuild.

**State (scaffolded, chosen approach = "verify contract first"):**
- `devInferenceStore` has `litertConstraintType` (`json_schema`|`lark`|`regex`) + `litertConstraintString`; modal has a LiteRT section.
- `LiteRTModule.kt`: `setConstrainedDecoding(enabled,type,constraint)`, sets the experimental flag at conversation creation, and passes `decoding_constraint` in `sendMessageAsync` — **all guarded, heavy logging, falls back to unconstrained on any failure** (never crashes the LiteRT path, which is the #1 historical crash surface). Kotlin compiles (`@OptIn(ExperimentalApi::class)` added).
- `litert.ts` arms/disarms the constraint before `resetConversation`.

**The unverified bit:** the exact serialization of `decoding_constraint` (C++ docs only). Run on Android and read `[DevGrammar-LiteRT]` logs: `sending WITH decoding_constraint` then either it works or `constrained send failed to start … falling back unconstrained`. Iterate on the map shape from that.

### H. Diagnostics & known issues (surfaced, mostly NOT yet fixed)

1. **`[RecordingsStore] PERSIST writing N recording(s)` spam** — zustand `persist` on `recordingsStore` re-serializes the **entire** `recordings` array (400+) to AsyncStorage on **every** `updateRecording`, including transient `transcriptProgress` ticks during transcription. Cause: `partialize` returns the whole array and persist has no debounce. **Proposed fix (not applied):** debounce the storage `setItem` (~2-3s) + move transient progress out of the persisted store. Preserves resume-after-kill.
2. **`CHUNK_MS = 15 min`** (`transcribeChunked.ts`) — huge chunks mean the first progress tick within a window takes minutes on a slow device → looks "stuck at 0%". **Tradeoff:** shrinking (e.g. 2 min) makes progress responsive + bounds memory but is slightly slower overall (10 s overlap re-encoded per chunk). Proposed, not applied.
3. **Boot auto-transcribe loads the 465 MB model at launch.** `[TranscribeSched] (boot) auto-transcribing N clip(s)` fires on app start → loads the biggest model immediately, competing with the UI (feels like slow startup). **Proposed:** defer/lazy-load until the user opens a recording or the app is idle. Also it can **starve a manual transcribe** (shared single whisper context).
4. **`File not found` in auto-transcribe** — some recordings' stored `path` (`rec-X.wav`) doesn't match the on-disk speech-trimmed file (`speech-rec-X…wav`); the scheduler errors per clip and churns. **Proposed:** skip/heal missing-file clips.
5. **Diagnostic timing logs added** (uncommitted, may want to keep or revert): `initWhisper took Xs`, slice-extraction timing, transcribe-dispatch, and the `transcribeChunked` step logs. These pinpoint load vs slice vs encode.

**Device context:** the test device is an **iPhone XS (A12)** with ~3.78 GB RAM — the slowest viable iOS target. small (465 MB) on CPU is inherently slow there; CoreML is what makes it usable.

---

## 4. Research & decisions already made (don't re-litigate)

- **SenseVoice vs Whisper (local benchmark, ran on the Mac):** SenseVoice-Small int8 ≈ **228 MB** (bigger than base 140 MB, not smaller), non-autoregressive so ~constant ~46× realtime on short clips. **Must be chunked** — single-pass 30-min OOM'd at ~14.6 GB; chunked (30 s windows) it's flat ~36× at ~0.8 GB. Best-in-class **code-switching** for its 5 languages (EN + Chinese/Japanese/Korean/Cantonese) — it caught EN+ZH in one clip where Whisper base/small dropped a language. **Decision: user said skip SenseVoice** (its languages don't cover the target; and Whisper's ecosystem/CoreML fit the app). On long files chunked, SenseVoice ≈ whisper base speed, not dramatically faster.
- **Android GPU whisper: does NOT exist in this app.** whisper.rn ships **CPU-only** Android `.so`s (the `vfpv4`/`v8fp16_va` variants are CPU ISA opts; no Vulkan/OpenCL symbols). `useGpu` is a no-op on Android. GPU whisper on phones is a poor tradeoff anyway (driver fragmentation, small encoder). **The real Android lever = quantized ggml models (`q5_1`/`q8_0`)** — offered, not yet built. Hardware accel on Android = NPU (Qualcomm QNN/Hexagon), which is a different runtime, not whisper.rn.
- **Parallel whisper on mobile: not worth it.** Decode is sequential; `n_processors>1` breaks streaming + oversubscribes cores; multi-context multiplies RAM. The iOS lever is CoreML (encoder→ANE); Android is quantized models / a non-autoregressive model. Don't chase CPU parallelism.
- **GBNF grammar risks (why the harness exists):** grammar guarantees *structure*, not *content*. "Let Me Speak Freely?" (EMNLP 2024) shows format restrictions can *hurt* reasoning; CRANE suggests reason-then-constrain. Long-context + `item+` grammars can loop forever (hence the `maxWords`/`n_predict` cap). Bigger/tool-tuned models degrade least under constraint; tiny models (SmolLM-135M) produce valid-but-poor content.

---

## 5. Open decisions awaiting the user

- **CoreML backfill gating:** automatic (current) vs WiFi-only vs explicit opt-in, given encoder download size on cellular.
- **`CHUNK_MS` shrink** (responsiveness vs slight throughput cost) — apply?
- **Boot auto-transcribe defer/lazy-load** — apply? (biggest "slow startup" lever.)
- **PERSIST debounce + drop transient progress from persist** — apply?
- **Android quantized models** (`q5_1`/`q8_0`) — add to catalog?
- **LiteRT constrained decoding** — needs an on-device Android run to confirm the `decoding_constraint` map contract before it's trustworthy.
- **iOS "recording stopped after app kill" nudge** — see §6; dead-man's-switch design proposed, not built.
- **Commit/PR strategy** for all the uncommitted work above (stacked, pro→core), when the user says so.

---

## 6. iOS background-recording nudge (design proposed, not built)

The recorder can't keep recording after the user force-quits iOS. Proposed: a **dead-man's-switch local notification** — while the app is alive+recording, keep bumping a single scheduled `notifee` notification ~20 min into the future; if the app dies, bumping stops and it fires ("Recording stopped — tap to resume"). Reuses the existing `meetingReminders` notifee helpers. Local notifications survive force-quit (OS-owned); calendar changes cannot wake a killed app; only location/VoIP/BLE relaunch a force-quit app (poor fit). Taper + make disablable. Not implemented.

---

## 7. Key file index

**Core**
- `src/services/whisperService.ts` — whisper load/transcribe, CoreML encoder logic, download.
- `src/services/whisperModels.ts` — model catalog (`WhisperModel`, `coreMLUrl`).
- `src/services/llm.ts`, `llmToolGeneration.ts`, `llmHelpers.ts` — local llama.rn completion paths.
- `src/services/litert.ts` — LiteRT JS wrapper (Android).
- `src/services/devInference.ts`, `src/stores/devInferenceStore.ts`, `src/components/DevGrammarModal.tsx` — grammar harness.
- `src/screens/ChatScreen/ChatScreenComponents.tsx` — chat header (dev button).
- `android/app/src/main/java/ai/offgridmobile/litert/LiteRTModule.kt` — LiteRT native module.

**Pro (`pro/locket/`)**
- `screens/LocketPlayerScreen.tsx` — recording detail: transcribe/stop, speaker turns, attach, summary.
- `services/transcribeChunked.ts` — chunked resumable transcription (owns store writes, `CHUNK_MS`).
- `stores/recordingsStore.ts` — recordings + persist (the PERSIST-spam source); auto-transcribe scheduler.
- `stores/alwaysOnSettingsStore.ts` — recorder settings (thread/model/diarize/autoDetect...).
- `ui/BatteryDrainStat.tsx`, `ui/RecorderHomeCard.tsx`, `ui/LocketSettingsSection.tsx` — Home/Settings injections.
- `services/meetingReminders.ts` — notifee scheduling (reused for the proposed kill-nudge).
- `screens/AlwaysOnTranscriptionScreen.tsx` — recorder dashboard.

**Docs (`docs/plans/`, gitignored in core)**
- `chat-grammar-test-harness-plan.md`, `combined-intelligence-layer-plan.md`, meeting-intelligence-* — prior plans.
- this file.

---

## 8. Working norms (read before committing/pushing/building)

- **Never push to `main`.** Branch per change; stacked PRs (parent→child), each its own branch + PR. Branch *before* editing.
- **Commit/push each need explicit user instruction.** "go ahead / build it / implement it" authorizes coding only, not commit or push.
- **Commit co-author:** `Co-Authored-By: Dishit Karia <hanmadishit74@gmail.com>` — never Claude attribution. No AI attribution in PR descriptions.
- **No build/install without instruction** (adb/gradle/xcode), EXCEPT the standing permission: after an Android build, if a device is connected, `adb install -r` it. iOS device build target: `npx react-native run-ios --udid 00008020-00126C302E62002E` (Dishit's iPhone).
- **`--no-verify` only** for the env-broken native pre-commit hook, and only after JS gates (lint/tsc/test) pass.
- **Never auto-delete user data.** Diagnostic questions ("why is X") want explanation + proposal first, not unprompted edits. "make a plan" = write the doc and stop.
- **Pro stays hidden** in `pro/` — no pro code or its docs leak into core (`docs/plans/` is gitignored to enforce this).
- **Quality gates:** `npm run lint && npx tsc --noEmit && npm test` before pushing; Husky runs scoped gates on commit.

---

## 9. On-device verification cheat sheet (grep the debug logs)

- CoreML: `[Whisper][CoreML]` (download/rename/READY) + native `Core ML model loaded` / `failed to load Core ML model`.
- Load/slice timing: `initWhisper took`, `slice ready in`, `transcribe progress N% elapsed=`.
- Speaker turns: they render as `Speaker N` labels in the player transcript (no log needed).
- Grammar harness: `[DevGrammar]` (ARMED → APPLIED → reached native completion).
- LiteRT constraint: `[DevGrammar-LiteRT]` (setConstrainedDecoding → sending WITH decoding_constraint → works or falls back).
- Perf smell: `[RecordingsStore] PERSIST writing N recording(s)` firing repeatedly during transcription = the spam issue (§3.H.1).

---

*End of handoff. When in doubt: measure on-device, keep claims honest, keep pro out of core, and don't commit/push without the user saying so.*
