# Locket Recorder - Continuous-Smart Handoff

A handoff for the always-on ambient recorder ("locket"). It captures the product philosophy, the decisions made, the reasoning behind them (so nobody re-litigates them), the design we landed on, what has been built, and what we are still figuring out. Written so a new Claude chat or agent can pick up and keep going.

Read alongside: `continuous-smart-recorder-plan.md` (the execution plan), `locket-recorder-handoff.md` (recorder state + conventions), `locket-insights-screen-plan.md` and `locket-llm-insights-plan.md` (the insights layer that sits on top of recordings).

---

## 1. What this is

Locket is the always-on ambient recorder in Off Grid Mobile AI - a Pro feature. The phone listens, keeps the speech, and turns it into transcripts, then insights (title / summary / action items). Everything runs on-device: the microphone audio never leaves the phone, VAD and transcription and the LLM all run locally. This is the core promise, not a setting.

- Repo layout: public core in `src/` (`@offgrid/core`), private Pro in the `pro/` submodule (`@offgrid/pro`), pulled in via React Native autolinking + `pro.activate(registry)`, absent in the free build.
- Recorder native code: `pro/android/src/main/java/ai/offgridmobile/alwayson/ContinuousRecorderService.kt`, `pro/ios/ContinuousRecorderModule.swift`. JS in `pro/locket/`.
- Current work branch: `feat/continuous-smart-recorder` (pro submodule), based on `feat/locket-insights`.

---

## 2. Product philosophy (the fixed points)

These are the beliefs that drove every decision. Keep them fixed unless the user changes them.

1. **Never miss speech.** The recorder exists to catch the things you say (a reminder, a decision, a meeting). Missing a real utterance is the worst failure. Everything else (storage, battery, a bit of extra silence in a clip) is secondary to this.
2. **Never silently delete user data.** Recordings, transcripts, and downloads are the user's. We surface problems and let the user decide. The one narrow exception we allow (see below) is discarding a window that a trusted pass confirms never contained any speech - recorder byproduct, not user content.
3. **On-device, private by mechanism.** The audio lives in the phone's storage and RAM; nothing is uploaded. Privacy is how it works, not a policy line.
4. **Trust the trusted pass, not a live guess.** A reliable offline decision beats a flaky real-time one. This is the whole reason for the pivot below.
5. **Simplest low-risk change first.** Reuse proven primitives; add new logic only where the old logic was actually wrong. Less new native code = less on-device risk.

---

## 3. The journey: why we pivoted from live gating

The recorder started as a **live VAD gate**: while capturing, run Silero (plus an RMS energy pre-gate) frame by frame and only write audio when it decides "speech." The idea was to save storage by never writing silence/noise.

It could not be trusted. The live gate leaked noise into recordings - borderline frames slipped through, and the recording list filled with clips that were noise, not speech. We built diagnostic buttons that ran the SAME audio through two post-pass VADs (whisper.cpp GGML Silero v5 and the onnx Silero v4). **Both post-passes correctly rejected the noise the live gate had kept.**

The key insight, and the thing a new agent must internalize:

> **The model was never the problem. The live-gate LOGIC was.** Silero is accurate. The failure was asking a real-time state machine to decide, at capture time, what to keep - it has to commit before it has the full picture, and borderline frames go the wrong way.

So we pivoted: **capture everything continuously (no gate at the mic), then let a trusted offline pass decide what to keep.** Nothing is missed at the microphone; a reliable pass does the filtering afterward.

---

## 4. Research grounding (so this is not re-questioned)

We checked whether we were reinventing something or missing a better tool. Findings:

- **Silero VAD is the field standard** for on-device speech-vs-(silence+noise). whisper.cpp bundles a Silero GGML VAD, and the documented pipeline is exactly "run Silero -> keep only speech segments -> feed whisper." Our own labeled tests matched: Silero rejects loud noise with 100% speech recall at ~50x realtime. We are on the main road, not a side path.
- **The React Native VAD libraries that exist are all live-gate style** (react-native-vad, Picovoice voice-processor, ExecuTorch VAD) - the exact approach we moved away from. Copying one would re-introduce the bug.
- **There is no drop-in "continuous ambient recorder that trims noise."** The pieces (Silero, whisper.cpp, energy pre-gate) are standard; the composition (continuous + duration-gated trim + roll) is ours to assemble, and it is a well-understood pattern, not novel research.

Conclusion: keep Silero (via whisper.cpp GGML v5), keep continuous capture, keep the post-pass. Do not swap in an RN VAD lib.

---

## 5. The continuous-smart design (what we landed on)

One line:

> **Continuously write -> checkpoint the file -> keep if speaking / discard if it never had speech -> roll when the conversation ends -> trim the closed file (cut long non-speech, pad speech) -> drop clips with no real speech.**

### The flow in detail
1. **Record + write continuously.** Microphone always on, every frame written to disk (buffered). No gate decides at capture time, so no onset is ever clipped.
2. **Per-frame speech tracking.** Silero (with a cheap RMS pre-gate to skip near-silent frames for battery) labels each frame speech / not-speech. This drives the roll decision. Note this runs continuously during capture - it is much cheaper than the old per-frame gate because it only shapes the file, it does not gate writes, but it is not zero.
3. **Roll when the conversation ends.** Once a file has had speech, if there is **60s** of continuous trailing non-speech, the conversation is over: close the file (roll), open a new one. The next speech becomes a new clip. **If the speaker is still talking at any point, we do NOT roll** - short pauses stay in one file.
4. **Discard dead windows.** A file that reaches **5 minutes** having never contained any speech is discarded (dead air / noise-only). It never becomes a recording.
5. **Hard cap.** A marathon conversation still rolls at the **30-minute** cap so files do not grow without bound.
6. **Trim on save (post-pass).** When a file rolls (closes), `autoPrune` runs Silero (GGML v5) over the whole file and cuts every non-speech run longer than **15s**, keeping shorter pauses, and pads each kept speech run by **3s** on each side. This is the only place trimming happens - not mid-recording.
7. **Drop tiny clips.** Files under ~5s total (or under 1s of kept speech after trim) are dropped natively / by the store guards, so junk does not clutter the list. A meaningful one-liner ("remind me to call the client") is a few seconds and survives.

### The three thresholds, and why they differ
- **Roll silence (60s):** ends a conversation. Kept larger than the trim gap so a normal pause never splits one conversation into pieces.
- **Trim gap (15s):** cuts dead air *inside* a kept clip. Shorter runs are natural pauses and stay.
- **Checkpoint / discard (5 min):** how long a file with zero speech is allowed to exist before being thrown away.

If the roll and trim used the same value, every pause would fragment one meeting into many clips. They are deliberately separate.

---

## 6. Concepts a new agent must get right

- **"Not-speech" = silence OR noise.** Silero only classifies speech vs not-speech; it does not separate silence from noise, and neither do we. That is the point: RMS energy only caught silence; Silero also rejects loud noise (traffic, music, TV). Everywhere the docs say "silence gap" or "no speech," read it as "not-speech, decided by Silero, silence and noise treated the same."
- **Roll vs trim are different operations.** Roll = close the file when the conversation ends. Trim = cut non-speech out of the closed file. Roll happens per-frame when trailing silence crosses 60s; trim happens once, at rollup, on the closed file.
- **The 15s duration gate doubles as the false-negative guard.** Silero can briefly miss soft/quiet speech. But a miss would have to persist 15s+ continuously to lose real speech, which no real conversation does. So we do not depend on per-frame confidence being perfect; the duration gate is the safety margin.
- **The checks are per-frame, not a periodic timer.** There is no "wake up every 5 min and scan." Every frame (~96ms) the loop evaluates roll / discard / cap and fires the instant a threshold is crossed. The "5 minutes" is the age at which a speechless file is discarded, evaluated continuously.

---

## 7. The "nothing lost" contract

The user asked repeatedly whether this loses anything. The honest, designed answer:

- **Capture loses nothing** - continuous, so no onset is clipped (strictly better than the gate).
- **Trim is non-destructive** - `compactToSpeechOnly` keeps a verified compressed AAC backup, and `restoreOriginal` brings the full audio back. The trimmed clip is what the user *sees*; the full recording is retained and restorable. A Silero miss is "the clip cut a bit early," not "audio gone."
- **The only path to real loss** would be destructive mid-stream pruning with no backup plus a 15s+ continuous false-negative. We avoid it by (a) trimming only at rollup, non-destructively, and (b) the 15s duration gate.
- **Discarding dead windows** is the one narrow auto-delete we allow - only for windows a trusted pass confirms never had any speech (recorder byproduct). Anything with even a little speech is kept. If we ever want zero auto-delete, add a grace-period backup of discarded windows (see phase 2).
- **Rolling is not loss** - a long pause splits a conversation into two clips, it does not drop audio.

---

## 8. Battery and storage reasoning (settled - do not re-derive)

- **The microphone dominates power and is identical in every approach.** A gate cannot power down the mic (it has to keep listening for the next word), so gating does NOT save meaningful battery. Its only saving is fewer disk writes, while it ADDS constant real-time inference.
- **Continuous + post-pass is equal-or-slightly-better on battery** than the live gate: batched inference (a burst at rollup, race-to-idle) beats constant real-time inference (which keeps the CPU from sleeping). Continuous costs more *storage*, not battery.
- **Changing the audio format is a storage lever, not a battery one.** We already capture the minimum whisper needs (16kHz mono 16-bit PCM WAV, ~115MB/hr). Compressing saves disk ~10x but adds encode-on-write and decode-at-post-pass CPU; net battery ~neutral. So compress for storage/flash-wear, not battery.
- **Buffered writes (accumulate a few seconds, flush periodically) are a flash-wear and minor-CPU win, not a battery win.** The kernel page cache already coalesces physical flash writes, so app-level buffering mainly cuts syscalls. Worth doing (best practice, tiny RAM cost) but do not expect a battery jump.
- **Flash wear** = the storage chip physically wears out with writes. An always-on recorder writing GBs/day is exactly the heavy sustained load where fewer, larger writes extend the chip's life. Real but secondary benefit.

---

## 9. Audio provenance ("keep only me")

Always-on capture records everything with speech in it - TV, music, phone-call audio, other people. This splits into three sub-problems with different answers:

1. **The phone's own playback re-recorded (the bug the user hit): solvable now.** Handled two ways in-code: the existing `muted` / `setMuted` mechanism drops capture while the app plays audio (wired at `recordingPlayer.ts`), and Android hardware `AcousticEchoCanceler` cancels the phone's own loudspeaker output. Both are in v1.
2. **Other people's voices: solvable but a project.** Speaker verification (enroll the user's voiceprint, keep/label by match) with an on-device model (Picovoice Eagle / ECAPA-TDNN). Heavier than VAD, and for meetings you usually want *diarization* (label who spoke) rather than filtering others out. **Figuring out** - staged for later.
3. **A TV / radio playing in the room: genuinely hard.** Telling live room speech from played-back speech is research-grade (anti-spoofing) with no clean drop-in. Named as the honest ceiling; not being pursued now.

The user decided #2 and #3 are not a big problem right now; #1 is handled.

---

## 10. What was built this session

On `feat/continuous-smart-recorder`. Repurposed the existing `autoDetect=true` flag to mean continuous-smart (no native bridge or JS-signature change - lowest risk), so the default recorder is now continuous-smart. The old live-gate code is retired (kept in git history; iOS `writeGated` left in place but unused).

- **`ContinuousRecorderService.kt`** - replaced the live-gate branch with the continuous-smart loop (write every frame; roll on 60s trailing silence; discard a no-speech file at 5 min; 30-min cap). Added `discardCurrentFile()` and hardware `AcousticEchoCanceler` (best-effort, released on teardown). Removed the temporary `[VADDiag]` logging.
- **`ContinuousRecorderModule.swift`** - new `writeSmart` mirroring the Android loop, routed capture to it, opens the file immediately, added `discardCurrentFile()`. iOS echo relies on the existing mute wiring (hardware voice-processing was left out of v1 to avoid changing ambient capture characteristics).
- **`speechCleanup.ts`** - `AUTO_PRUNE_GAP_MS` set to 15s (was 10s), comments updated. `speechPadMs` in `vadDetect.ts` is 3s.
- **Settings store + JS service** - comments updated to the continuous-smart semantics; the `autoDetect` default stays `true` (now = smart). No settings mode-selector UI was added (the "Always-on recorder" settings entry was removed earlier for a shareable build).
- **Tests** - added a "continuous-smart trim policy" block to `__tests__/unit/locket/speechCleanup.test.ts` pinning the decided 15s behaviour (8s pause kept, 40s cut, 15s inclusive, one-liner survives). 27/27 pass; tsc clean.

**Reused vs new:** ~80% reuse (capture setup, file lifecycle, Silero + RMS pre-gate, VadGate, event emitter, mute/echo, and the entire post-pass trim - all untouched). ~20% new: the file-shaping loop (roll/discard/cap), `discardCurrentFile`, Android AEC.

### Decided constants
| Setting | Value | Where |
|---|---|---|
| Roll on trailing silence | 60s | `SMART_ROLL_SILENCE_MS` / `smartRollSilenceMs` |
| Discard dead (no-speech) window | 5 min | `SMART_CHECKPOINT_MS` / `smartCheckpointMs` |
| Hard-cap roll | 30 min | `maxFileLengthMs` (settings) |
| Trim gap (cut non-speech runs >) | 15s | `AUTO_PRUNE_GAP_MS` |
| Speech pad each side | 3s | `speechPadMs` (vadDetect) |
| Min save to bother compacting | 5s | `AUTO_PRUNE_MIN_SAVE_MS` |
| Min kept speech (else leave raw) | 1s | `AUTO_PRUNE_MIN_KEPT_MS` |
| Drop clip under (total duration) | 5s | `MIN_FILE_DURATION_MS` (native) |

---

## 11. Current state

- Code-complete for v1 with production values. tsc clean, jest green.
- **Nothing committed, nothing built.** Native (Kotlin/Swift) is typecheck-clean but compiled only by a real build, so it is on-device-UNVERIFIED. The next concrete step is a build + on-device test.
- Two uncommitted insights files (`LocketInsightsScreen.tsx`, `transcribeChunked.ts`) belong to a parallel insights effort - do not stage them with recorder changes.

### How to test on-device (production values)
- One sentence + ~65s silence -> one clean clip (~sentence + 3s pad), trailing silence trimmed.
- Silence/noise only for 5+ min -> nothing appears (dead window discarded).
- Continuous talk with short pauses -> stays one clip; rolls only after 60s of final silence.
- Logs: `[ContinuousRecorder] fileStarted/fileFinalized`, `[AutoPrune] START/DONE`; `adb logcat -s ContinuousRec` for `opened new file` / `discarded dead window` / `AEC enabled`.

---

## 12. What we are still figuring out (phase 2)

Framed as open, not cancelled. In rough priority:

1. **Whole-day robustness (highest impact).** This decides whether it truly records a full day.
   - iOS all-day background survival (iOS suspends background apps; the audio background mode helps but it can still be killed under memory pressure).
   - Crash/kill recovery of an *unfinalized* WAV (a file being written when the app dies has an incomplete header; recovery must rebuild it from file size, not only match `rec-<epoch>.wav`).
   - A user-facing retention policy (never auto-delete, but let the user set "keep N days"), because always-on + never-delete collides with storage over weeks.
2. **Mid-file checkpoint prune.** Trim the *open* growing file periodically so a long conversation or a dead window does not hold full audio until it rolls. Optimization only - not correctness. Keep it conservative and backed-up if built.
3. **Grace-period backup for discarded windows.** If we want literally zero auto-delete, keep discarded no-speech windows in a compressed bucket for a day or two before dropping them.
4. **Speaker ID / diarization** (see section 9) - label who spoke; keep-only-me as an option.
5. **Integration tests** for the finalize -> autoPrune -> speech-only clip + backup + restore flow (unit coverage exists for the range math).
6. **Cleanup:** remove the retired iOS `writeGated` and the now-unused Android `CLOSE_SILENCE_MS` const once the smart path is confirmed on-device.

The insights layer (title / summary / action items, notification CTA, opportunistic generation) is a separate track with its own plans (`locket-insights-screen-plan.md`, `locket-llm-insights-plan.md`) and is being built in parallel.

---

## 13. Conventions for whoever continues

- Pro code stays in the `pro/` submodule on its own stacked branch + PR; nothing Pro leaks into core `src/` or docs.
- Never commit or push without explicit user instruction. Never build/install without instruction (standing exception: after a build, if `adb devices` shows a device, install with `adb install -r`).
- Never `--no-verify` except the env-broken native hook after JS gates pass.
- Design tokens (TYPOGRAPHY / COLORS / SPACING), weights <= 400, Feather icons, no emojis in UI.
- Brand voice for any copy: no em dashes, no curly quotes, no forbidden words (revolutionary, seamless, leverage, robust, comprehensive, and the rest of the list in `docs/brand_tone_voice.md`).
- Commit co-author: `Co-Authored-By: Dishit Karia <hanmadishit74@gmail.com>`. No AI attribution in commits or PRs.
- "Plan means plan only" - if asked to plan, write the doc and stop; do not build.
- Prefer the simplest additive fix; state what is left out.

---

*Bottom line for a new agent: the recorder is now continuous-smart (capture everything, let a trusted Silero post-pass shape and trim), code-complete for v1 with production timeouts, tsc + tests green, on branch `feat/continuous-smart-recorder`, not yet built or committed. The live gate is retired because its logic (not the model) was the problem. The next real step is a build + on-device verification, then the whole-day robustness work in section 12.*
