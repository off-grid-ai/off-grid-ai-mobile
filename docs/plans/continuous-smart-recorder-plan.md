# Continuous-Smart Recorder Mode — Implementation Plan

Execution-ready plan for a new recorder capture mode: **continuous capture + post-pass Silero trim**, replacing reliance on the real-time VAD gate. Written so another agent can build it directly.

Read first: `locket-recorder-handoff.md` (recorder state + conventions). This doc is the concrete build for the "continuous-smart" pivot.

---

## 0. Why this exists (the pivot)

The live gate (amplitude + Silero `VadGate`, open on speech / close on silence) **can't be trusted** — it leaked noise into recordings because a real-time state machine has to decide *at capture time* what to keep, and borderline frames slip through. Our own post-pass VAD (whisper.cpp Silero GGML v5) correctly rejected the same noise the live gate kept, so the **model was never the problem — the live-gate logic was.**

A quick search confirmed the field standard: whisper.cpp bundles Silero VAD, and the documented pipeline is "run Silero -> keep only speech segments -> feed whisper." The available React Native VAD libraries are all **live-gate** style (the approach we're moving away from). So we do NOT copy an RN lib; we run the standard post-pass pattern over a continuously-captured file.

**Decision:** capture everything continuously (no gate deciding at capture time), then let the trusted post-pass Silero decide what to keep. Nothing is missed at the mic; a trusted offline pass does the filtering.

---

## 1. Modes coexist — do not delete the gate

The native recorder already branches on **`autoDetect`** (`ContinuousRecorderModule.swift` / `ContinuousRecorderService.kt`):
- `autoDetect = false` -> continuous capture (write every byte, roll on time interval).
- `autoDetect = true` -> VAD-gated (`writeGated` / `VadGate`).

**Generalize `autoDetect: boolean` into a mode enum** so all three coexist behind one switch, and the gate code stays in place (fallback + A-B testing):

```ts
type RecorderMode = 'gated' | 'continuous' | 'continuous-smart';
```

- `gated` — the existing live gate (kept, not deleted; the iOS `vad == nil` fallback still applies).
- `continuous` — the existing "write everything, roll on time" behaviour (unchanged).
- `continuous-smart` — **new default**: continuous capture + checkpoint prune + roll-on-conversation-end + post-pass trim (this plan).

Store the mode in `alwaysOnSettingsStore` (migrate the existing `autoDetect` boolean: `true` -> `'gated'` or `'continuous-smart'` per the chosen default; `false` -> `'continuous'`). Pass the mode string down to native `start(...)` instead of the boolean. Native maps unknown/absent -> safe default.

---

## 2. Capture (continuous-smart) — native

Continuous-smart captures like `continuous` (write every frame, no gate). The differences are two background behaviours layered on top:

### 2a. Cheap amplitude pre-scan (optional, disk saver)
While recording, track a rolling RMS. This is only used to identify **pure-silence** windows (near-zero amplitude) as candidates for the checkpoint prune. It never gates capture and never decides speech — pure-silence is the only thing amplitude can safely claim.

### 2b. Periodic Silero checkpoint (every ~60-120s)
On a timer, run Silero (GGML v5, via `vadDetect`) over the **recent unflushed slice** of the open file. Purpose: prune **confidently-non-speech, long** windows in place so a multi-hour file doesn't grow unbounded.

**Safety rule (critical):** the checkpoint prune is **conservative and reversible**:
- Only prune a window if it is BOTH amplitude-silent AND Silero-confident-non-speech, AND the run is longer than the prune gap (§4). Anything shorter or borderline stays.
- Keep the compressed **AAC backup** (`ensureCompressedBackup`) before any in-place removal, so a Silero false-negative is recoverable. Never destructively cut with no backup.

If the checkpoint prune adds risk without a clear disk win on target devices, it is acceptable to **skip 2b entirely** and rely only on the roll-time post-pass (§3 + §5). Capture-continuous + trim-at-roll already gives the full guarantee; the checkpoint is a disk optimization, not a correctness requirement. Build §3/§5 first, add 2b only if long files prove a disk problem.

---

## 3. Roll on conversation-end (not on a fixed timer)

Continuous-smart rolls (finalizes the file, starts a new one) when a **conversation ends**, defined by a trailing no-speech gap:

- Track "ms since last speech frame" (Silero from the checkpoint pass, or a lightweight running check).
- When trailing no-speech exceeds **ROLL_SILENCE_MS (~45-60s)** after there was speech in the file, **roll**. The next speech becomes a new clip.
- Also keep a **hard cap** roll (existing `maxFileMs`) so a never-ending conversation still rolls periodically.
- If a file has **no speech at all** by the time it would roll, discard it (don't finalize an all-noise clip) — subject to the 0:00 guard already in place.

Rolling IS the trigger for the final speech-only trim (§5): the finalize boundary is what lets `autoPrune` produce a clean clip.

**Keep ROLL_SILENCE_MS distinct from the trim gap (§4).** They do different jobs:
- Trim gap (~15s) — trims dead air *inside* a kept clip.
- Roll silence (~45-60s) — ends the conversation and starts a new clip.

If both used the same value, every ~15s pause would split one conversation into many tiny clips. Roll threshold must be higher than the trim gap.

---

## 4. The trim rule (duration gate + pad) — the core policy

This is the policy the user specified. It runs in the post-pass (§5) and, conservatively, in the checkpoint (§2b).

- **Duration gate:** a non-speech run (silence OR noise) is pruned **only if it is longer than `AUTO_PRUNE_GAP_MS`**. A shorter run is kept (a natural pause inside a conversation). Set **`AUTO_PRUNE_GAP_MS` = 15_000** (currently 10_000 in `speechCleanup.ts`; the discussion settled on 15s).
- **Pad:** keep **3s on each side** of every detected speech run (`speechPadMs = 3000` in `vadDetect.ts`, already set). Preserves word onsets/tails, breaths, short pauses.
- **The 15s gate doubles as the false-negative guard:** a Silero miss would have to persist 15+ continuous seconds to lose real speech, which no real conversation does. So we do not depend on per-frame confidence being perfect — the duration gate is the margin.

**Worked example** (the user's test case): one ~3s line ("remind to call client at end of today"), then ~3 min noise, then silence.
- Result: ~3s speech + 3s pad each side ≈ **~9s clip**. The 3 min of noise is trailing and >15s, so it's cut down to the 3s pad. Trailing silence >45-60s triggers the roll -> one short reminder clip.
- The 15s is the *trigger to cut*, not the amount kept. A 180s run is cut to the pad; you never keep 15s of noise.

**Contrast (when 15s changes behaviour):** speech -> 8s noise -> speech keeps the 8s (bridged, natural pause); speech -> 40s noise -> speech cuts the dead middle (leaving pad), giving two tight chunks.

---

## 5. Post-pass trim at roll — reuse what exists

On `fileFinalized`, the existing `autoPruneRecording` already does the right shape:
`vadDetect` (Silero GGML) -> `mergeWithinGap(AUTO_PRUNE_GAP_MS)` -> `compactToSpeechOnly` (non-destructive: keeps a verified AAC backup + `restoreOriginal`; skips if <`AUTO_PRUNE_MIN_KEPT_MS` kept so no 0:00 clip).

This is **mode-agnostic** (runs on any finalized file), so continuous-smart gets it for free. The only changes needed:
- `AUTO_PRUNE_GAP_MS` 10_000 -> 15_000 (§4).
- `speechPadMs` -> 3000 (done).
- Confirm the AAC backup is always written before compaction (it is) — this is the "nothing lost" guarantee.

---

## 6. The "nothing lost" guarantee (design contract)

- **Capture:** continuous, so no onset is ever clipped — better than the gate.
- **Trim:** non-destructive. The trimmed clip is what the user *sees*; the full audio is retained in the compressed AAC backup and restorable via `restoreOriginal`. A Silero miss is "the clip cut a bit early," not "audio gone." Honors "never auto-delete user data."
- **The only path to real loss** is destructive in-place pruning with no backup + a 15s+ continuous VAD false-negative. We close it by (a) keeping the backup and (b) the 15s duration gate. So: no permanent loss.
- **Rolling is not loss:** a pause longer than ROLL_SILENCE_MS splits a conversation into two clips, it does not drop audio.
- **Crash safety:** continuous writing means a crash loses only the last few unflushed seconds.

---

## 7. What already exists (don't rebuild)

- Native continuous branch (`autoDetect = false`) — write-everything + time roll.
- `vadDetect.ts` — Silero GGML v5 over a file, chunked (5 min chunks, 2s overlap), `VAD_OPTIONS` (threshold 0.5, `speechPadMs` 3000, `maxSpeechDurationS` 30).
- `speechCleanup.ts` — `mergeWithinGap`, `compactToSpeechOnly` (AAC backup, restore, concat slices), `restoreOriginal`, `autoPruneRecording`, `AUTO_PRUNE_MIN_KEPT_MS` guard, `[AutoPrune]` logs.
- `fileFinalized` handler in `continuousRecorderService.ts` -> `autoPrune`.
- 0:00 guards (`MIN_RECORDING_MS`) in `recordingsStore`.
- The `VadGate` (`gated` mode) — keep as-is for fallback / A-B.

---

## 8. What to build

1. **Mode enum** — migrate `autoDetect` -> `RecorderMode` in `alwaysOnSettingsStore`; thread the string through the JS recorder service and native `start(...)`; native maps to behaviour; default `'continuous-smart'`.
2. **Roll-on-conversation-end** (§3) — trailing no-speech tracker + `ROLL_SILENCE_MS` roll, keep `maxFileMs` hard cap, discard all-noise files. Native (both platforms) is the natural home since it owns the file lifecycle; a JS-driven roll is the fallback if native is heavier.
3. **`AUTO_PRUNE_GAP_MS` 10s -> 15s** (§4).
4. **Checkpoint prune (§2b) — optional, last.** Only if long files are a disk problem; conservative + backed-up. Skippable.
5. **Settings UI** — a mode selector (Gated / Continuous / Smart) in `LocketSettingsScreen`, design tokens, replacing the current auto-detect toggle. Explain each in one line.

---

## 9. File-by-file

| File | Change |
|---|---|
| `stores/alwaysOnSettingsStore.ts` | `autoDetect: boolean` -> `mode: RecorderMode` (+ persist migration); default `'continuous-smart'` |
| `services/continuousRecorderService.ts` | pass `mode` to native `start(...)`; roll-on-conversation-end wiring if JS-driven |
| `android/.../alwayson/ContinuousRecorderService.kt` + `Module.kt` | accept `mode`; continuous-smart capture; trailing-silence roll; discard all-noise; keep gate branch |
| `ios/ContinuousRecorderModule.swift` (+ `.m`) | same as Android; keep `vad == nil` fallback |
| `services/vadDetect.ts` | `speechPadMs: 3000` (done) |
| `services/speechCleanup.ts` | `AUTO_PRUNE_GAP_MS` 10_000 -> 15_000 |
| `screens/LocketSettingsScreen.tsx` | mode selector (3 options), design tokens, one-line copy each |
| `__tests__/unit/locket/…` | duration-gate keep/cut (8s kept, 40s cut, 180s trailing -> pad); pad math; mode migration; all-noise discard |
| `__tests__/integration/locket/…` | finalize -> autoPrune -> speech-only clip + backup present + restore works |

---

## 10. Testing

- **Duration gate:** synthetic segments — 8s gap kept, 40s gap cut (pad remains), 180s trailing cut to pad.
- **Pad:** 3s each side present around kept speech.
- **Worked example:** 3s speech + 3min noise + silence -> ~9s clip, one recording, backup present.
- **Roll:** speech, 60s silence, speech -> two clips (not one, not many); 15s pause -> stays one clip.
- **All-noise file:** no speech -> discarded (0:00 guard).
- **Nothing lost:** after trim, `restoreOriginal` reproduces the full audio.
- **Mode migration:** old `autoDetect true/false` -> correct new mode; gate mode still records.
- **Fallback:** Silero fails to load -> falls back to plain continuous (no crash).

---

## 11. Guardrails (carry over)

- Never delete the gate code — it's the fallback + A-B baseline.
- Non-destructive always: keep the AAC backup before any prune; `restoreOriginal` must work. No silent eviction of user audio.
- Roll threshold (~45-60s) strictly greater than trim gap (15s) so pauses don't fragment conversations.
- Checkpoint prune is optional and conservative; ship trim-at-roll first.
- Design tokens, weights <=400, Feather icons, no emojis; brand voice in any settings copy.
- Revert any temporary `[VADDiag]` logs before merge; remove the unused native `detectSpeechOnnx` in cleanup.
- Pro code stays in the `pro/` submodule on its own stacked branch + PR; nothing pro leaks into core `src/` or docs.

---

## 12. Open decisions (confirm before building)

- Default mode: `'continuous-smart'` (this plan) vs keep `'gated'` default until smart is validated on-device.
- Roll ownership: native (owns file lifecycle, survives JS backgrounding) vs JS-driven (simpler, but pauses when backgrounded on iOS). Plan leans native.
- Ship the checkpoint prune (§2b) at all, or rely purely on trim-at-roll. Plan: defer 2b.
- `ROLL_SILENCE_MS` exact value (45 vs 60s) — tune on real conversations.

---

*Build order: mode enum -> continuous-smart capture + roll-on-conversation-end -> AUTO_PRUNE_GAP_MS 15s -> settings selector -> (optional) checkpoint prune. The post-pass trim already exists and is mode-agnostic, so the value shows up as soon as continuous-smart finalizes its first file.*
