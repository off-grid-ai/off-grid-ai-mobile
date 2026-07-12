# Auto-detect (VAD-gated) recording — implementation plan

Status: figuring out. This plan is the agreed direction after the Slack thread
with Mac and the Omi source-code review. It is a plan only — not implemented.

## What "auto-detect" means here

The recorder should **start/stop capturing based on voice**, instead of writing
every byte continuously. When there is speech, we record; when there is
sustained silence, we stop writing and open a fresh file on the next speech.

This is VAD-gated *capture*, as opposed to today's model (continuous capture +
post-pass VAD prune).

## Why the naive version failed before (and the two things that fix it)

The earlier apk attempt was unreliable because a plain threshold gate does two
bad things. Both are solved by copying what the open-source Omi firmware does
(`aad.c`), confirmed by reading its source:

1. **It clips the first word.** By the time the gate decides "this is speech,"
   the opening syllable is already gone.
   Fix: a **pre-roll ring buffer** (~1s). Keep the most recent ~1s of audio at
   all times; when speech is detected, flush the pre-roll into the file *first*,
   then continue. The onset is never lost.

2. **It chops mid-sentence on short pauses.** Natural speech has gaps; a gate
   that stops the instant amplitude drops cuts words in half.
   Fix: a **hangover** (reuse `silenceGapMs`). After speech stops, keep
   recording until silence has lasted longer than the hangover window. Only then
   close the file.

Without these two, auto-detect will lose audio. With them, it behaves.

## Honest constraints (so we set expectations correctly)

- **No battery win on a phone.** Omi saves power because it has a dedicated
  wake-on-sound MEMS mic (T5838) that lets the MCU sleep. A phone gives an app
  no such hardware — the mic + CPU stay on to listen either way. Auto-detect on
  a phone mainly saves *storage/processing*, not battery. Do not sell it as a
  battery feature.
- **Amplitude alone can't tell speech from loud noise.** A simple RMS threshold
  over-captures (treats traffic/music/typing as "speech"). It rarely *loses*
  speech (loud speech always trips it), so with a pre-roll it is safe, just not
  clean. Silero VAD is the clean answer but is more work to run in the capture
  loop. See phasing.

## Current architecture (what we're changing)

- `pro/android/.../alwayson/ContinuousRecorderService.kt` — `AudioRecord` PCM
  loop. Today: "write every byte, always"; the only file roll is the time
  interval (`maxFileMs`). `silenceGapMs` is plumbed but unused in the capture
  path. This is the main file to change.
- `pro/android/.../alwayson/ContinuousRecorderModule.kt` — `start(silenceGapMs,
  maxFileMs, audioSource)` RN bridge → Intent extras. Add an `autoDetect` param.
- `pro/ios/ContinuousRecorderModule.swift` — iOS equivalent capture loop; mirror
  the same state machine.
- `pro/locket/services/continuousRecorderService.ts` — `start({silenceGapMs,
  maxFileMs, audioSource})`. Add `autoDetect`.
- `pro/locket/stores/alwaysOnSettingsStore.ts` — add an `autoDetect` setting
  (default per product call) + setter + default.
- `pro/locket/ui/LocketSettingsSection.tsx` or the recorder settings screen — a
  toggle to switch modes.

## Design — native capture state machine (Android first, then iOS mirror)

Add an `autoDetect` flag to `start(...)`. When false, keep today's continuous
path exactly (no behavior change). When true, run this per-buffer state machine
inside the existing `AudioRecord` read loop:

```
state = IDLE            # no file open, buffering pre-roll
preroll = ring buffer (~1s of PCM frames)
lastVoiceMs = 0

on each PCM buffer:
    isVoice = amplitude(buffer) > threshold          # phase 1: RMS/avg-abs
    if state == IDLE:
        preroll.push(buffer)
        if isVoice:
            openNewFile()
            flush preroll -> file                     # <-- onset preserved
            write(buffer); lastVoiceMs = now
            state = CAPTURING
    else: # CAPTURING
        write(buffer)
        if isVoice: lastVoiceMs = now
        else if now - lastVoiceMs > silenceGapMs:      # <-- hangover
            closeCurrentFile(announce=true)            # finalize; triggers
            state = IDLE                               #   auto-prune + calendar
        if maxFileMs > 0 and durationSoFar > maxFileMs:
            roll file (close + open), keep CAPTURING
```

Notes:
- Reuse the existing WAV writer / `closeCurrentFile` (already emits
  `fileFinalized`, which already triggers auto-prune + calendar match).
- `silenceGapMs` becomes the hangover window (already a user setting).
- Threshold: start with a fixed conservative value; consider an adaptive noise
  floor (rolling min amplitude) so it works across quiet/loud rooms.
- Keep MIN_FILE_DURATION / MIN_FILE_BYTES so blips are discarded.

## VAD engine — phasing

- **Phase 1 (ship first): amplitude/RMS gate + pre-roll + hangover.** Entirely
  in the native loop, no new deps. Errs toward capturing (safe), and the
  existing **post-pass Silero prune stays on** as the reliability backstop — so
  even if the gate lets noise through, auto-prune cleans it. This is the
  simplest thing that is actually safe.
- **Phase 2 (if Phase 1 is too noisy): Silero VAD in the capture loop.** Run the
  Silero ONNX/GGML VAD on frames natively (we already ship `silero_vad` assets
  and use it via whisper.rn in the post-pass). More work: needs the model loaded
  in the service and run in real-time. Only do this if the amplitude gate proves
  too dirty in real use.

## Data-loss safeguards (non-negotiable)

- Pre-roll + hangover as above (no clipped onsets, no mid-sentence cuts).
- If the VAD/threshold subsystem errors, **fall back to continuous capture**
  (write everything) rather than risk dropping audio. Log it.
- Auto-prune already keeps a backup of the original; unchanged.
- Never delete user audio silently (existing rule).

## JS / settings / UX

- `alwaysOnSettingsStore`: `autoDetect: boolean` (+ setter, default). Product
  decision: default ON per "let's make it auto detect based."
- `continuousRecorderService.start` passes `autoDetect` through to native.
- Recorder settings: a toggle "Auto-detect speech (only record when talking)"
  with a one-line note that it saves storage, not battery.
- Home card + detail screen: no change.

## Test plan

- **Unit (pure):** extract the state-machine decision (isVoice → open/write/
  close, pre-roll flush, hangover) into a testable helper; cover onset
  preservation, short-pause survival, long-silence close, file roll.
- **Native instrumentation:** feed a known PCM fixture (speech + gaps + noise)
  and assert file boundaries + that the first N ms of speech are present (onset
  not clipped).
- **On-device (the side-by-side Mac asked for):** record the same meeting in
  continuous vs auto-detect; measure miss rate (any speech dropped?) and
  false-capture (noise recorded). This is the acceptance test.

## Risks / open questions

- Amplitude gate cleanliness in real rooms (Phase 1 vs Phase 2 Silero).
- iOS parity: the Swift capture loop must implement the same pre-roll/hangover;
  AVAudioEngine tap buffers differ from AudioRecord.
- Threshold tuning / adaptive noise floor — the main knob; needs device testing.
- Interaction with auto-prune: with auto-detect on, files are already mostly
  speech, so prune has little to do — confirm no double-trimming of onsets.

## Rollout

- Behind the `autoDetect` setting so we can flip back to continuous instantly.
- Ship Android Phase 1 first (dev-loop device), validate miss rate, then iOS.
