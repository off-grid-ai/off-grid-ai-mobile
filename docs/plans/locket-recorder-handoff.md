# Locket Recorder — Session Handoff

Handoff for the next agent working on the **locket / always-on ambient recorder** (Pro feature) in Off Grid Mobile AI. This captures what was tried, what changed, the decisions and the reasoning behind them, the current git/PR state, and what's still being figured out.

> Open-core layout: public `@offgrid/core` lives in `src/`; the private **`pro`** submodule (`off-grid-ai/mobile-pro`) holds the recorder feature (screens, stores, services, native `alwayson/`). Core exposes registries/slots; pro plugs into them. Feature code never lives in `src/` — only seams + shared services do.

---

## 1. TL;DR — current state

- The recorder captures **speech-only** via a live VAD gate, then **trims each finished clip to speech** on roll-up (post-pass Silero), non-destructively.
- **Live gate was tightened** to stop recording noise; **post-pass trim** cleans whatever slips through.
- Diagnostic tooling (VAD-comparison buttons) was added to investigate a noise bug, then **removed for a shareable build**.
- UI: Today (day timeline w/ brief-clip folding, filters, search icon, batch transcribe), Days (calendar), global Search.
- Everything is committed + pushed on `feat/vad-gated-recorder` and **propagated up to the open PRs** (pro #11, core #433). Both PRs are MERGEABLE; **nothing merged into `main`/`dev`.**
- **Not yet verified on-device** — the trim flow, the tightened gate, and the iOS RMS behaviour still need a real device pass.

---

## 2. The problem & how we think about it

**Goal:** an ambient recorder that keeps *speech* and discards silence + noise, fully on-device (no cloud), privacy-first.

**The journey:**
1. Started with a **live VAD gate** (Silero via onnxruntime) deciding what to record, plus an **RMS energy pre-gate** to skip the neural model on dead-silent frames (battery).
2. Noise kept ending up in recordings. We built a **post-pass VAD comparison tool** (two buttons on the detail screen: GGML Silero v5 via whisper.rn vs the live onnx Silero v4) to diagnose.
3. **Finding:** *both* post-pass VADs flagged the same clips as noise that the **live gate kept** → the leak was the **gate logic, not the model.** Root cause: the live gate's `EXIT` threshold was **0.35**, so borderline 0.35–0.50 noise kept it "speaking," while the post-pass counted speech at **0.50**.
4. **Researched Omi** (open-source wearable, `BasedHardware/omi`): it gates **amplitude first** (hardware WAKE pin on the mic), then a light on-device VAD + a ~0.8s pre-roll, and runs **Silero again in the cloud**. Confirmed the layering instinct: cheap amplitude gate → heavier VAD deferred. Also confirmed Silero is ~1 ms/frame (~50–100× realtime), so live-vs-batch is not a big compute difference — the batch/post-pass win is **whole-file context** (better noise rejection), not speed.

**Mental model we landed on:**
```
amplitude (RMS) pre-gate  →  Silero (live) opens on speech, closes on silence  →  file rolls up
        │
   on roll-up: one-shot Silero post-pass over the file → trim silence+noise → keep speech ✅
```
Amplitude = cheap wake-up. Live Silero = lenient open + clean close. **Post-pass = the precise cleaner.** Because the post-pass does the precise trimming, the live gate only needs to be "good enough to not open on pure noise."

---

## 3. Decisions taken (with rationale)

| Decision | Why |
|---|---|
| **Tighten the live gate**, don't rebuild to full post-processing capture | The bug was one threshold (0.35 vs 0.50), not the architecture. Fix the knob, not the pipeline. |
| `EXIT` **0.35 → 0.50** | Align "keep recording" with the post-pass "is speech" threshold that correctly rejects noise. |
| **Sustained-onset START** (3 consecutive ≥0.5 frames ≈ 288 ms) | A single transient (click/door) shouldn't open a file. |
| **Pre-roll 5 → 8 frames** (~768 ms) | Cover the onset-confirmation delay so the first word isn't clipped. |
| **Keep Silero for the close decision** (not amplitude-only) | Silero is cheap; amplitude-close would never roll up in continuous background noise (a file would grow to the 30-min cap). Silero closes cleanly even in noise. |
| **Post-pass trim on roll-up** (already wired via `autoPruneRecording`) | The clean-output guarantee. Runs one-shot Silero, keeps speech, drops the rest. |
| Trim gap **60s → (tried 2s) → 10s** | 2s chopped natural conversational pauses (jump-cut playback). 10s keeps natural pauses, trims genuine dead air / long noise-only stretches. **User-tunable via `AUTO_PRUNE_GAP_MS`.** |
| **Trimming is non-destructive** | `compactToSpeechOnly` enforces "no verified backup, no cut" — keeps a compressed AAC backup; `restoreOriginal` brings the full audio back. Honors "never auto-delete user data." |
| **0:00 clips must never list** | Guards added: skip compaction if <1s speech would remain; reject <1s recordings in `addFinalized` + orphan recovery (catches damaged/stale WAV headers). |
| **No-speech clips: don't auto-delete** | Surface + let the user delete (existing select-no-speech flow). *Proposed but NOT built:* have `autoPrune` mark no-speech clips so they show as "no clear speech" and are bulk-deletable without needing transcription first. |
| **Brief-clip UI: fold into a collapsible group** | Short clips clutter the list. Group per time-of-day section into "N brief clips" (dashed card, show/hide). Grouping keys off `startedAt` (a clip spanning a section boundary belongs to its start). Threshold **user-settable** (`briefMaxMs`, default **1 min**, options 30s/1m/5m/10m). |
| **Removed diagnostic "Check speech" buttons** for the share build | They were an investigation tool, not a shipped feature. (Native `detectSpeechOnnx` + `[VADDiag]` logs remain but are unsurfaced.) |
| **Removed "Always-on recorder" nav item** from the Settings section | The recorder is reached from the Home card now; the Settings row was redundant. |
| **Merge, not rebase**, for stack reconciliation | Reviewed, stacked, submodule-coupled branches — rebase would force-push + replay conflicts repeatedly. Merge resolves once, no force-push. |

---

## 4. The pipeline, as built

**Live capture (auto-detect mode), per 1536-sample (96 ms) frame** — native (`alwayson/ContinuousRecorderService.kt`, `ios/ContinuousRecorderModule.swift`):
1. RMS pre-gate: `rms < ENERGY_FLOOR (0.005)` → skip Silero, treat as silence.
2. Else run Silero v4 (`SileroVad` onnx) → prob.
3. `VadGate` (`ENTER 0.5`, `EXIT 0.5`, `ONSET_FRAMES 3`, `REDEMPTION 8`): START after 3 consecutive ≥0.5; STOP after 8 sub-0.5 frames.
4. File opens on speaking (flush `PREROLL_FRAMES 8`); closes after `CLOSE_SILENCE_MS 30s` of non-speech (+ trailing trim); native min-duration filter (5s / 16 KB).
5. VAD inference is guarded (try/catch) so a failure logs + treats the frame as silence rather than crashing the loop; iOS surfaces failures via `NSLog`.

**On roll-up** — JS (`continuousRecorderService.ts` `fileFinalized` → `speechCleanup.autoPruneRecording`):
1. `detectSpeechSegments` (whisper.rn GGML Silero) over the whole file.
2. `mergeWithinGap(speech, AUTO_PRUNE_GAP_MS=10s)` → keep gaps ≤10s, drop longer + head/tail silence.
3. Guards: skip if no speech / `<AUTO_PRUNE_MIN_KEPT_MS (1s)` kept (no 0:00) / `<AUTO_PRUNE_MIN_SAVE_MS (5s)` to remove.
4. `compactToSpeechOnly` → AAC backup, then `concatWavSlices` the kept ranges → speech-only WAV. Verbose `[AutoPrune]` logs.

---

## 5. What changed this session (file-level, all in `pro`)

- `android/.../alwayson/VadGate.kt`, `ios/VadGate.swift` — tightened gate (EXIT 0.5, sustained onset, pre-roll 8).
- `android/.../alwayson/ContinuousRecorderService.kt`, `ios/ContinuousRecorderModule.swift`, `ContinuousRecorderModule.m`, `SileroVad.swift`, `ContinuousRecorderEvents.kt` — RMS pre-gate + engine emit + `[VADDiag]` diagnostics (temporary) + VAD-failure crash guard + native `detectSpeechOnnx` (onnx-over-file, used by the now-removed buttons).
- `locket/services/speechCleanup.ts` — `AUTO_PRUNE_GAP_MS 10s`, `MIN_SAVE 5s`, `MIN_KEPT 1s`, verbose `[AutoPrune]` logs, non-destructive compaction (already existed).
- `locket/stores/recordingsStore.ts` — `vadEngine` state, **batch transcribe** (`startBatchTranscribe`/`stopBatchTranscribe`), `MIN_RECORDING_MS (1s)` 0:00 guards.
- `locket/services/continuousRecorderService.ts` — vadState `engine`, `vadDiag` event, `detectSpeechOnnx` wrapper.
- `locket/screens/LocketTodayScreen.tsx` — day timeline, brief-clip folding, filter chips, search icon (calendar button removed), safe-area selection bar, batch-transcribe button.
- `locket/screens/LocketDaysScreen.tsx` — search icon (week-range label was tried then reverted — the month label is intentional).
- `locket/screens/LocketSearchScreen.tsx` (**new**) — global transcript search reusing `SearchBar` + `searchRecordings` + deep-link to the matched moment.
- `locket/screens/LocketPlayerScreen.tsx` — VAD comparison buttons **added then removed**; "Check speech" pieces gone.
- `locket/services/vadDetect.ts` — one-shot Silero (whisper.rn) over a file (pre-existing, reused).
- `locket/stores/alwaysOnSettingsStore.ts` + `LocketSettingsScreen.tsx` — `briefMaxMs` setting (`BRIEF_OPTIONS` 30s/1m/5m/10m, default 1m); "Brief clip length" section.
- `locket/ui/LocketSettingsSection.tsx` — removed "Always-on recorder" nav item.
- `ios/RecordingPlayerModule.swift` — player joins the recorder's `.playAndRecord` session (fixes OSStatus 561017449).
- `__tests__/unit/locket/dayTimeline.test.ts` (**core repo**) — day-timeline grouping tests.

**iOS reconciliation note:** core `whisperService`/`whisperStore` were reconciled to keep our recorder features (`onSegments`, `stopFileTranscription`, `loadModel(options)`, `downloadFromUrl`) *and* dev's additions (residency OOM `fits`-rule + `WhisperLoadResult`, `audioSessionManager`, `cleanTranscription`, vision-crash guard).

---

## 6. Git & PR state

**Working branch (both repos): `feat/vad-gated-recorder`.** The battery agent's uncommitted files (`AlwaysOnTranscriptionScreen.tsx` + `BatteryDrainStat.tsx`) live in the pro working tree — **not mine, leave them.**

**Pro repo (`off-grid-ai/mobile-pro`):**
```
feat/vad-gated-recorder → feat/locket-enhance → feat/locket → main
                                                   (PR #11, OPEN, MERGEABLE)
```
- #19, #15 merged (closed). #11 head = `5f09970`, has ALL work.
- **#11's `ci` check "Typecheck pro against real core" is RED** — this is a **cross-repo coupling**, not a bad merge: pro depends on core APIs (`audioSessionManager`, `modelDownloadService`, `SLOTS.homeRecorder`, `whisperService.stopFileTranscription`, `loadModel(options)`, `transcriptSummarizer`, `ResidentSpec.canEvict`, `@notifee`, …) that exist on **core `feat/locket-pro` (#433)** but not yet in core `main`/`dev`. Goes green once core lands.

**Core repo (`off-grid-ai/mobile`, redirects to `off-grid-ai/off-grid-ai-mobile`):**
```
feat/vad-gated-recorder → feat/locket-pro-enhance → feat/locket-pro → dev
                                                       (PR #433, OPEN, MERGEABLE)
```
- #502, #469 merged (closed). #433 pro submodule pointer = `5f09970` (matches pro `feat/locket` tip).
- Reconciled with dev (was 451 commits behind) — only ~9 files conflicted; resolved by synthesis. Core src/ tsc + eslint clean; **full test suite not run** in-worktree (empty submodule).

**Propagation reality:** `feat/vad-gated-recorder`'s PRs are already merged, so new commits on it sit *ahead* of the merge points and must be propagated up (merge `feat/vad-gated-recorder → feat/locket-enhance → feat/locket`, then bump core `feat/locket-pro`'s pro pointer). This was done for every change. **Consider committing directly on `feat/locket` going forward to kill this overhead.**

**Merge order rule:** pro first (core's submodule pointer must reference the reconciled pro commit).

---

## 7. Open items / what we're still figuring out

- **On-device verification** — the tightened gate + trim flow are unverified on a phone. Test per §8. Watch `[AutoPrune]` and gate behaviour.
- **iOS RMS gate** — on iOS the RMS pre-gate rarely drops below `ENERGY_FLOOR` (mic/AGC floor is higher), so Silero effectively runs every frame there (RMS never gates). It's a battery optimization only — correctness is fine. `[VADDiag]` logs (routed to JS for both platforms) exist to measure `rmsMin` vs the floor; decide whether to raise the iOS floor.
- **Cross-repo landing** — pro #11 and core #433 must land together (core APIs into `dev`/`main` for pro to typecheck green). Nothing merged into `main`/`dev` yet, per instruction.
- **No-speech clips** — proposed: mark `autoPrune`'s no-speech verdict on the recording so it shows as "no clear speech" and is bulk-deletable without transcription. Not built.
- **`[VADDiag]` + `detectSpeechOnnx`** — temporary diagnostics. `[VADDiag]` per-second logs should be **reverted before merge**. Native `detectSpeechOnnx` is now unused (buttons removed) — remove in a native cleanup pass.
- **Meeting intelligence** — next phase: on-device summaries/titles/action-items. Needs a text LLM present; a small dedicated summarizer (~1B, e.g. Llama 3.2 1B Q4 ~0.8 GB) is viable; sub-1B is too weak / hallucinates. Reuse `transcriptSummarizer`. Runs foreground / opportunistically (iOS can't run an LLM in the background).
- **Qodo review (deferred, replied on PRs):** iOS VAD off the audio thread (background queue — careful refactor); Android per-frame copy overhead; onnxruntime pod not pro-gated; recorder lacks native tests.
- **Battery** — aggressive per-clip compaction (AAC encode + concat) is more background work than the old 60s threshold. Detached/best-effort, but measure on a busy day; both prune thresholds are single constants.

---

## 8. How to test the trim flow

1. **Reload** (JS change) — don't rebuild for JS-only tweaks.
2. Open logs filtered on `AutoPrune`: in-app **Debug Logs** screen, or `npx react-native log-ios` / `log-android`.
3. Record: **talk ~5s → quiet ~20s → talk ~5s → tap Stop** (Stop rolls up immediately).
4. Expect the clip's duration to **shrink** (~30s → ~10s) a few seconds after it appears, and:
   ```
   [AutoPrune] … START … gap=10000ms
   [AutoPrune] … VAD: 2 speech segs, speechMs=10000 …
   [AutoPrune] … COMPACTING -> trimming 20s of noise/silence
   [AutoPrune] … DONE: kept 10s of 30s (removed 20s)
   ```
5. Edge checks: short pauses only → `skip: only Xms to remove`; mostly-noise blip → `skip: only Xms kept speech` (no 0:00); pure noise → `skip: NO speech`.
6. **No `[AutoPrune]` line at all** = it isn't firing (fileFinalized/import) — that's the real bug to chase.

Key knobs (in `speechCleanup.ts`): `AUTO_PRUNE_GAP_MS` (trim aggressiveness), `AUTO_PRUNE_MIN_KEPT_MS`, `AUTO_PRUNE_MIN_SAVE_MS`. Gate knobs in `VadGate.{kt,swift}`. `ENERGY_FLOOR` in the native services.

---

## 9. Working conventions (the human's rules — follow these)

- **Never commit or push without explicit instruction.** Each is a separate go. "Build it/implement it" authorizes coding only.
- **Never build/install without instruction** — except a **standing** rule: after a build, if `adb devices` shows a device, `adb install -r` it yourself (dev loop).
- **Never auto-delete user data** (recordings/transcripts/downloads). Surface + let the user decide. (Trimming silence is OK because it's non-destructive with a backup.)
- Commit co-author: `Co-Authored-By: Dishit Karia <hanmadishit74@gmail.com>` — **never** Claude attribution. No AI attribution in PRs.
- Pro code lives in the `pro/` submodule on its own stacked branch + PR. Nothing pro leaks into core `src/`/docs.
- **Explain before changing** for diagnostic/opinion questions; **"make a plan" = write the doc and stop.**
- Prefer the **simplest additive fix**; weigh the tradeoff — if a fix adds worse risk than the problem, don't do it. Feature-first; defer lint/test cleanup but never `--no-verify` except the env-broken native hook after JS gates pass.
- Design tokens only (TYPOGRAPHY/COLORS/SPACING), weights ≤400, icons via `react-native-vector-icons` Feather, no emojis in UI. Brand voice: no em dashes, no forbidden words, no curly quotes.
- Reuse before building; design to abstractions (no `instanceof`/`engineId ===` branching in UI).

---

## 10. Key files map

| Area | File |
|---|---|
| Live gate state machine | `pro/android/.../alwayson/VadGate.kt`, `pro/ios/VadGate.swift` |
| Native capture loop | `pro/android/.../alwayson/ContinuousRecorderService.kt`, `pro/ios/ContinuousRecorderModule.swift` |
| Native Silero v4 (onnx) | `pro/android/.../alwayson/SileroVad.kt`, `pro/ios/SileroVad.swift` |
| Post-pass VAD (whisper GGML) | `pro/locket/services/vadDetect.ts` |
| Trim / compaction (non-destructive) | `pro/locket/services/speechCleanup.ts` |
| Recorder JS service (events) | `pro/locket/services/continuousRecorderService.ts` |
| Store (recordings, batch, guards) | `pro/locket/stores/recordingsStore.ts` |
| Settings store | `pro/locket/stores/alwaysOnSettingsStore.ts` |
| Today timeline + brief folding | `pro/locket/screens/LocketTodayScreen.tsx` |
| Days calendar | `pro/locket/screens/LocketDaysScreen.tsx` |
| Global search | `pro/locket/screens/LocketSearchScreen.tsx` |
| Recording detail / player | `pro/locket/screens/LocketPlayerScreen.tsx` |
| Day-timeline grouping util | `pro/locket/utils/dayTimeline.ts` |
| Settings section (nav) | `pro/locket/ui/LocketSettingsSection.tsx` |
| Home card entry | `pro/locket/ui/RecorderHomeCard.tsx` |

---

*This doc lives in `docs/plans/` (git-ignored / local). Update it as things land. The two PRs to watch: pro **#11** and core **#433** — they land together.*
