# Audio / recorder work — current state

Snapshot of the audio / transcription / recorder ("locket") work as it stands on
branch **`feat/locket-pro-enhance`**. TTFT / calendar / LLM-perf work is
deliberately left out (tracked separately).

> **Big change since the last notes:** the whole recorder has moved into the
> **`pro/` submodule** (`pro/locket/…`) and is registered behind the pro
> entitlement gate. The old `feat/locket-mode` layout (native `alwayson/` package
> + docs in core) is superseded. A mature service layer now exists, and the
> "meeting intelligence" phase (summaries, calendar match, ask-across-recordings)
> is largely built, not just planned.

---

## 1. Branch / repo state

- **Current branch:** `feat/locket-pro-enhance` (no upstream pushed yet).
- Diverged from `feat/locket-pro` by **2 commits**, both tests:
  - `5a2f4371 test(locket): split-planning unit tests + whisper.rn VAD types`
  - `3657aea9 test(locket): range math + transcript remap for speech cleanup`
- The actual **feature code lives in the `pro/` submodule** — the submodule
  pointer moved `1b629ff1 → 2e99eaae`. Recent pro commits:
  ```
  2e99eaa feat(locket): keep-speech-only cleanup + soft-delete + restore (non-destructive)
  f2b0e7f feat(locket): split a recording into pieces at VAD breaks
  8ecce11 feat(locket): on-device Silero VAD detection (chunked, bounded memory)
  dc1cca4 feat(locket): archive search UX, calendar totals, home dashboard cleanup
  51875c9 feat(locket): transcript-aware recording search
  adbd853 feat(locket): harden orphan recovery + detect abnormal stops
  cdf7169 feat(locket): reload the player in place after header repair
  9cc4adb feat(locket): restore recorder UI + one-tap repair for recovered recordings
  ```
- **Uncommitted:** `.so` files (ggml-hexagon, don't commit), `ios .pbxproj`,
  `package-lock.json`, the `pro` pointer, and a **new asset dir**
  `android/app/src/main/assets/whisper-vad/ggml-silero-v5.1.2.bin` (865 KB —
  the Silero VAD model, untracked). Plus this doc.

---

## 2. How the feature is wired (pro submodule, gated)

`pro/locket/index.ts` exports `activateLocket({ registerScreen, registerSettingsSection })`.
Core never imports locket code — it renders whatever screens/sections are
registered, which are absent in the free build. `activateLocket` runs only inside
`pro.activate`, behind the entitlement gate. It:
- Registers screens: `AlwaysOnTranscription`, `LocketRecordings`,
  `LocketMemoryArchive`, `LocketPlayer`, `LocketSettings`,
  `LocketWhisperSettings`, `DebugLogs`.
- Registers a `LocketSettingsSection` (Settings entry, hidden for free users).
- Kicks off `recoverOrphans()` 3 s after activation (after the store hydrates).

Structure under `pro/locket/`: `screens/` (7), `stores/`
(`recordingsStore`, `alwaysOnSettingsStore`, `alwaysOnTranscriptionStore`),
`services/` (17, below), `components/` (`AudioPlayerCard`, `SearchBar`,
`AttachToChatSheet`), `ui/`, `utils/`.

---

## 3. Service layer (`pro/locket/services/`)

### Capture / recovery
- `continuousRecorderService.ts` — the always-on foreground recorder bridge.
- `recordingsRecovery.ts` — **orphan recovery**. Walks the recorder's output dir
  and adds any `.wav` not in the store (catches missed `FileFinalized` events
  when JS was torn down). **Safety contract:** never writes/renames/deletes
  audio; reads only metadata + first 44 bytes (stale-header detect); scoped to
  the app-private recordings dir by DIRECTORY not filename; skips the in-progress
  file only while recording. Phase 2 (stale WAV header repair in-place) is a
  separate stricter path.
- `transcriptionForeground.ts` — foreground-service keepalive for transcription.
- `systemSpeechRecognitionService.ts` — system (OS) STT path
  (`isOnDeviceAvailable`, `start(language, preferOnDevice)`, event stream).
- `wavFormat.ts`, `whisperRemoteService.ts`.

### Transcription
- `transcribeChunked.ts` — chunked transcription via native `extractWavSlice`
  (whisper only ever loads ~one chunk → bounded memory on 10 h files). Fixes the
  whole-file-to-heap OOM.

### VAD → split (new, tested this branch)
- `vadDetect.ts` — **on-device Silero VAD** via `whisper.rn` `initWhisperVad`
  (Silero ggml — separates speech from silence AND loud noise, unlike the
  energy `vadThold`). Read-only. Slices the file into 5-min chunks with a 2 s
  overlap (`extractWavSlice`) so memory is ~one chunk; merges segments closer
  than 1 s; explicit `VAD_OPTIONS` (threshold 0.5, min speech 250 ms, etc.)
  because `{}` collapses to one giant "all speech" segment. Returns
  `VadResult { speech, gaps, totalMs, speechMs, speechPct, wallMs }`.
- `recordingSplit.ts` — **pure, deterministic** split planning. A gap becomes a
  divider only when longer than a user-tunable threshold (default 30 s, bounds
  5 s–5 min); cut at the gap **midpoint** so neither piece clips speech; pieces
  shorter than `minPieceMs` (3 s) fold into the previous one. `planSplits` /
  `countSplits`. Testable so the UI can re-plan live as the slider drags.
- `recordingSplitExec.ts` — **executes** a split plan: writes each piece as a
  NEW recording via lossless byte-range `extractWavSlice`, adds them to the
  store, **leaves the original untouched** (additive only; user deletes the
  original separately later). Streams in 64 KB chunks → bounded memory.

### Speech cleanup (new, tested this branch — safety-critical)
- `cleanupClassify.ts` — labels the timeline into **speech / noise / silence**:
  `speech` = loud (RMS) regions that overlap a transcript range; `noise` = loud
  with no transcript overlap; `silence` = gaps between loud regions. RMS handles
  silence cheaply, the transcript decides speech-vs-noise. **Only labels —
  deletes nothing;** the user reviews and removes the noise/silence piles.
- `speechCleanup.ts` — **non-destructive keep-speech-only cleanup** with
  soft-delete + restore. Model: `raw WAV → ensureBackup (raw + verified AAC) →
  compactToSpeechOnly (speech-only WAV, raw dropped ONLY after backup verifies)
  → restoreOriginal (from raw if present, else decode the AAC)`. **Safety
  invariants (from an adversarial review):** compaction blocked until a verified
  backup exists; raw dropped only after AAC read-back-verifies; derived/backup
  files named OUTSIDE the `^rec-\d+\.wav$` recovery pattern (so a mid-compaction
  kill never surfaces a phantom and header-repair never touches them);
  segment delete/restore are pure store edits (bytes untouched); all audio
  movement is native + streamed (bounded on 10 h files).
  - Exports the **pure range math** unit-tested this branch: `mergeRanges`,
    `subtractRanges`, `computeKeptRanges` (speech minus deleted), `remapSegments`
    (remap transcript timestamps after a cut — shift, drop-in-gap, and
    split-a-straddling-segment cases).

### Meeting intelligence (built, reuses core)
- `recordingSummary.ts` — on-request transcript summary, streamed into the store
  (throttled ~16/s) via core `llmService` + `transcriptSummarizer`; raises
  `SummaryModelMissingError` → download prompt when no llama model is resident.
- `recordingKb.ts` — indexes every recording into one system **"Recordings"**
  knowledge base (`RECORDINGS_PROJECT_ID = 'recordings'`, 500-char chunks) via
  core `ragService`, so the user can **ask across all recordings**.
- `recordingEnrichment.ts` — best-effort **calendar match**
  (`react-native-calendar-events`): after a recording is saved, finds an
  overlapping event + attendees (8 s timeout, never blocks the save, never
  throws). Worst case the recording just shows its time.

---

## 4. Native additions

- **Silero VAD model asset:** `android/app/src/main/assets/whisper-vad/ggml-silero-v5.1.2.bin`
  (865 KB, currently untracked).
- **`AudioNormalizer` native module** (Android) is the workhorse for all the
  bounded-memory audio ops the services call:
  `extractWavSlice`, `concatWavSlices`, `compressToAac`,
  `normalizeToWav16kMono`. All streamed, so 10 h files never OOM.
- `whisper.rn` type shim (`src/types/whisper.rn.d.ts`) gained the VAD surface
  (`initWhisperVad`, `WhisperVadContext.detectSpeech/detectSpeechData`,
  `VadSegment` in **centiseconds** — ×10 for ms, `VadOptions`,
  `VadContextOptions`, `releaseAllWhisperVad`) so `vadDetect.ts` typechecks
  (runtime already had them).

---

## 5. Tests added this branch

- `__tests__/unit/locket/speechCleanup.test.ts` — 14 tests over the pure range
  math + transcript remap (delete/keep composition, straddling-boundary split,
  gap-drop).
- `__tests__/unit/locket/recordingSplit.test.ts` — `planSplits` /
  `countSplits`: threshold→piece-count, midpoint cut, short-piece folding,
  empty input.
- (Earlier on the stack: `bf72918d test(locket): unit tests for orphan recovery
  + transcript search`.)

The pattern: the **safety-critical pure logic is extracted and unit-tested**;
the I/O wrappers around it aren't (yet).

---

## 6. Core-side pieces (still in core)

- `src/services/whisperService.ts` + `whisperModels.ts` — `buildTranscribeOpts`
  extraction + catalogue split (`9ec2cfcb`), native whisper.cpp log wiring.
  Documented `eslint-disable max-lines` with a deferred split tracked in
  `docs/plans/ci-lint-test-progress.md`.
- `src/services/audioRecorderService.ts` — the **one-shot voice-input** recorder
  (react-native-audio-api, 16 kHz mono int16 WAV; iOS `playAndRecord`
  AVAudioSession so record + TTS coexist). Distinct from the locket continuous
  recorder.
- `src/hooks/useWhisperTranscription.ts`, `src/stores/whisperStore.ts`,
  `src/components/VoiceRecordButton/`, `WhisperPickerSheet`,
  `TranscriptionModelsTab`.
- `docs/plans/whisper-download-sync.md` — download-state single-source-of-truth
  fix (Option A: `whisperStore` is canonical, Download Manager observes it).

---

## 7. Hard rules still in force (unchanged)

1. Nothing leaves the device — no cloud/analytics/telemetry (privacy audit on
   `feat/locket-mode`: `docs/privacy-audit-locket.md`, still the reference).
2. Never lose received audio; log every OS-caused gap.
3. **Never auto-delete user data** — cleanup/split are non-destructive and
   reversible; the user chooses what to remove.
4. Survive crashes / OEM kills / battery death (orphan recovery + header repair).

---

## 8. Open items / not-yet

- The new work isn't pushed (no upstream on `feat/locket-pro-enhance`); pro
  submodule commits need pushing too (separate repo `off-grid-ai/mobile-pro`).
- `whisper-vad/ggml-silero-v5.1.2.bin` asset is untracked — needs a decision on
  committing it (865 KB binary) vs downloading it like other models.
- Recovery Phase 2 (in-place stale WAV header repair) is a separate stricter path.
- I/O wrappers around the tested pure logic (executeSplit, compaction) lack
  their own integration tests.
- Old `feat/locket-mode` docs (`docs/locket-recorder-plan.md`,
  `docs/locket-ui-plan.md`, `docs/privacy-audit-locket.md`) describe the earlier
  in-core design; the storage/pipeline rules still hold but the code location and
  service shape have moved to `pro/`.
