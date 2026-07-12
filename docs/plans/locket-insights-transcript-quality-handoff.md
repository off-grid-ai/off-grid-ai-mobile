# Off Grid Insights - Transcript Quality & Diarization Handoff

> Purpose: let a fresh Claude chat or agent pick up this work with full context.
> This doc covers the product philosophy, what the recorded product-strategy meeting
> was actually about, the transcript-quality problem, what the research found (with
> numbers), the shipping recommendation, and what is still open.
>
> Companion docs (read alongside):
> - `docs/plans/transcript-quality-findings.md` - the living research log, full
>   leaderboards, every config and metric.
> - `docs/plans/transcript-quality-experiment.md` - the original research brief.
> - `sim/insights/realdata/experiments/INDEX.md` - 21 saved transcripts + scores.
> - Other `docs/plans/locket-insights-*` handoffs - the surrounding product work.

---

## 1. What Off Grid is (product philosophy)

Off Grid is an offline, on-device AI app. Models run in the phone's own RAM; audio,
transcripts, and insights stay on the device and are not sent anywhere. Privacy is not
a promise laid over the product, it is the mechanism: there is no server in the loop to
leak from. The emotional arc for all Off Grid copy is Recognition -> Return -> Freedom:
name what has been happening to people's attention and data, show what is being given
back, hand over the capability without conditions.

The line of work in this handoff is the **always-on recorder + insights pipeline**
(internally "locket"): the phone listens continuously, transcribes on-device, and turns
each conversation into a summary, key points, and action items. The reference points the
team uses are Neosapien and Fathom, an always-listening capture device and a meeting
note-taker. The difference Off Grid is betting on is that all of it runs locally.

## 2. What the recorded meeting was actually about

The primary research file (`sim/insights/realdata/dl-1312.wav`, ~28.5 min, 2 speakers)
is a real internal product-strategy meeting about this exact product. Reading the
transcript, the product direction discussed was:

- **Capture in the moment.** A persistent notification with a call-to-action so a user
  can tap to start a recording when a conversation begins.
- **Consumer retention is the hard part.** The discussion centered on daily / weekly /
  monthly active users and the risk of "manufactured top line" (vanity metrics that do
  not reflect real use).
- **Notifications that carry value drive re-engagement.** The team compared to a personal
  finance app ("CO") that notifies on each transaction; a large share of its app-opens
  come from those notifications. The lesson: scheduled background processing should
  **surface something worth coming back for**, not just ping.
- **The share loop.** A Fathom-style email recap ("here is what was discussed") that a
  user copies and shares with a teammate or customer. Sharing is the growth loop.
- **In-app value is chat over recordings, not just reading.** Reading a transcript plus
  summary is table stakes. The pull is being able to **ask questions across recordings**:
  "what was the budget discussed in this meeting", "what were the action items", "find
  the detail from that conversation". Recordings organized into projects.
- **Transcript quality is the stated bottleneck.** In the meeting itself someone flags
  that leaning on small transcription models is "the wrong direction". That instinct is
  what this research set out to test and answer.

The takeaway for the pipeline: the insights layer (summary, key points, chat) is only as
good as the transcript feeding it. On this audio the limiter is the transcript, not the
LLM. So the first job is a transcript good enough that the important nouns survive.

## 3. The technical problem

Recorder audio is 16 kHz mono, phone on a table or in a pocket: ambient, variable signal,
two or more speakers, some code-switching (English plus some Hindi). English is what
matters for the product; Hindi is not a target.

Default `base.en` fails on this audio in three ways:
1. **Repetition loops** - a phrase repeats dozens of times on low-signal stretches.
2. **Foreign / non-speech markers** - "(speaking in foreign language)" and similar.
3. **Mishearing** - plausible but wrong words.

Two hard constraints shaped the work:
- Ship path is whisper.cpp via **whisper.rn** (exposes decode params and VAD), so any
  recommendation must be expressible there.
- There is no gold transcript for this private audio and no one can hand-listen it here,
  so ranking is **reference-free**: repetition, confidence, VAD-alignment, foreign-marker
  count, and recall of the meeting's own domain vocabulary (Off Grid, Fathom, DAU/MAU,
  notifications, retention, insights, recorder). The owner confirmed there are 2 speakers.

## 4. What the research found (with numbers)

Full detail and leaderboards in `docs/plans/transcript-quality-findings.md`. Headlines:

### 4.1 Decode params matter far more than model size
The single biggest win is turning off context carry so loops cannot self-reinforce, while
keeping temperature fallback on so the decoder can escape a loop when one starts.

- Control `base.en` looped one phrase **173 times** (a third of the transcript was junk).
- Turning context off cut the worst repeat from **178 to 24**.
- Turning temperature fallback OFF was catastrophic (a single run of **1555** repeats):
  never disable fallback.
- Partial context (max-context 64) was worse than default: it has to be full zero.
- Greedy decoding (no beam) brought back foreign markers: keep beam search.

### 4.2 base beats small here once params are right
With the winning config, `base.en` recalled **28 of 48** domain terms, higher than
`small.en` at **24**, and ran in 64s vs 93s for the 28-min file. `tiny.en` still loops
even with the config. Conclusion: ship **base.en**; size does not buy accuracy on this
audio once the params are set. `tiny.en` is a low-resource fallback only.

### 4.3 Audio preprocessing does not help - feed raw audio
Every enhancement tested lowered domain recall: loudness-normalization, +12 dB gain,
dynaudnorm, 80 Hz high-pass, and light denoise all scored worse than raw. The audio is
quiet (mean -28.8 dB) but lifting it also lifts the noise, which the model handles worse
than the quiet original. Do not add DSP before whisper.

### 4.4 Diarization auto-detect works (this was the hard part)
First attempt used sherpa-onnx's built-in clustering; it needed to be told the speaker
count, and its auto mode returned **23 speakers** for a 2-person meeting. That is useless
for a passive recorder that cannot ask the user how many people are present.

The fix was to keep the on-device ONNX speaker embeddings but replace the counting math
with **NME-SC** (Normalized Maximum Eigengap Spectral Clustering, the method pyannote and
NeMo use). Result on the full 28-min file, with no speaker-count hint and no tuning:
**2 speakers auto-detected, 351 turns, 74/26 talk split**, matching the forced-2
reference exactly.

Ablations: English speaker-embedding model was worse (counted 6); denoise-before-
diarization was worse (counted 3); a simple "drop speakers below a talk-time floor"
heuristic over-counted to 3 on the full file. So the working combo is specific:
**eres2net embeddings + raw audio + NME-SC**.

### 4.5 ONNX / faster-whisper: not worth switching
faster-whisper (CTranslate2) matched quality but was slower here and would mean ripping
out whisper.rn for a different runtime. Stay on whisper.rn. The only thing the whisperX
ecosystem offered that whisper.cpp lacks is diarization, and the ONNX NME-SC pipeline
covers that.

## 5. Shipping recommendation

### 5.1 Transcription (whisper.rn), default config
```jsonc
{
  "model": "ggml-base.en",           // not small; base + params >= small on this audio
  "language": "en",
  "maxContext": 0,                   // context OFF - the loop killer
  "suppressNonSpeechTokens": true,   // removes "(speaking in foreign language)" etc.
  "entropyThold": 2.6,               // earlier fallback on loopy segments
  "useVad": true,                    // silero ggml-silero-v5.1.2.bin (already in app)
  "beamSize": 5,                     // keep beam; greedy brings back hallucinations
  "temperature": 0.0,                // with fallback ladder ON - never disable it
  "noSpeechThold": 0.6
  // NO audio preprocessing - feed raw 16 kHz mono PCM
}
```
Low-signal fallback: same flags with `entropyThold` 2.8 and a stricter VAD threshold
(0.6); if the device is too slow for base, drop to `ggml-tiny.en` with the same flags and
accept more looping.

### 5.2 Diarization (auto-detect, no user hint), on-device ONNX
Pipeline: silero VAD -> 1.5s windows (0.75s hop) over speech -> sherpa-onnx embedding per
window -> cosine affinity -> NME-SC picks the count by max normalized eigengap -> spectral
clustering -> merge windows into turns. Reference impl: `sim/insights/harness/embed_once.py`
and `diar_final.py`. No PyTorch, no Hugging Face token.

- **Embedding model: use TitaNet-small or CAM++ (192-dim), not eres2net.** All three
  auto-count correctly (k=2), but TitaNet-small embeds the 28-min file in 18s vs
  eres2net's 64s (3.5x faster), CAM++ in 25s. So diarization costs ~1/3 of transcription,
  not more. Do not use English wespeaker (mis-counted 6) and do not denoise (mis-counted 3).
- **Cost:** lean path ~22s for 28 min on M3 laptop (18s embed + 3.6s NME-SC), RTF ~0.013;
  on phone roughly 1.5-3 min. Default k=2 (skip NME-SC) makes clustering ~0.1s if you know
  it is a 1:1.
- **Scaling caveat (long recordings):** NME-SC clustering is O(N^3) in window count. Fine
  to ~45 min; for multi-hour always-on captures, coarsen windows (cap N) or use a truncated
  eigensolver, or default k=2. Run diarization lazily / on-demand, not on every clip.

### 5.2b Reuse vs rebuild (whisperX and turnkey options)
- **whisperX is NOT the cheap/mobile option.** Its diarization is pyannote (PyTorch,
  ~1.5 GB runtime, 8 GB+ VRAM or 16 GB RAM, GPU/server). It is the same seg+embed+cluster
  algorithm on a much heavier host and cannot ship in a React Native phone app. "Smaller
  whisperX" only means smaller whisper (the ASR), which does nothing for diarization cost.
- **Turnkey mobile options that DO exist:** (a) sherpa-onnx has a React Native TurboModule
  (STT/TTS/diarization/VAD, Android+iOS, offline, open) - reuse its VAD + embedding models;
  its built-in FastClustering auto-count is the only weak link, which the ~40-line NME-SC
  swap fixes. (b) Picovoice Falcon - purpose-built turnkey on-device diarization SDK with
  RN bindings, auto-detects speakers, but commercial/proprietary (AccessKey, licensing);
  weigh against the offline/privacy-first stance.
- **Verdict:** the "rebuild" is tiny - we reuse sherpa-onnx's turnkey VAD + embedding
  models and only replace the final clustering call with NME-SC. That is not rebuilding a
  diarization engine; it is swapping one function for a better-counting one.

### 5.3 Product routing for what no config fixes
- Mark, do not feed, non-English / Hindi and genuinely low-signal segments. Suppressing
  non-speech tokens removes whisper's own foreign-language flag, so the app should detect
  these spots itself (per-segment low confidence, or a quick language-detect pass) and
  label them "audio unclear / not transcribed" so the insights LLM never summarizes a
  phonetic mis-hearing as if it were real English.
- Show a low-audio-quality badge when the reference-free guards fire, instead of a
  confident but wrong summary.
- The insights pipeline should tolerate roughly 40% word error as long as the key nouns
  survive. The winning config maximizes exactly that, which is the right target for
  summary / key-points / chat quality.

## 6. Open questions / next steps
1. **Diarization count scaling - DONE.** NME-SC returned 2 on the 2-person meeting and
   **5** on a 5-min slice of the Lex Fridman x Cursor-team podcast (truth = Lex + 4 = 5),
   with two embedding models agreeing. It genuinely counts, not biased to 2. Boundary-
   level accuracy still unaudited (count is confirmed).
2. **Wire the recommended config into the app** and confirm on-device parity (the numbers
   here are from the Homebrew whisper.cpp with Metal on an M3; whisper.rn on phone uses
   the same core but different acceleration).
3. **Decide the foreign-segment handling** in product: silently drop (current effect of
   `suppressNonSpeechTokens`) vs keep the marker and filter in post so the pipeline can
   see and skip those spots. A one-flag change; worth an explicit product call.
4. **Spot-audit the winning transcript by ear** before shipping. Ranking is reference-
   free, so it cannot certify the exact words. Every config's full transcript is saved in
   `sim/insights/realdata/experiments/` for this.
5. **Diarization + transcript join.** Combine whisper word/segment timestamps with the
   diarization turns to produce "who said what" for the insights layer and chat.

## 7. File and tooling map
- Research log: `docs/plans/transcript-quality-findings.md`
- Audit trail: `sim/insights/realdata/experiments/*.txt` (+ `.json`, `.log`) and
  `INDEX.md`; raw metrics `sim/insights/harness/results.jsonl`.
- Harness (`sim/insights/harness/`):
  - `score.py` - reference-free metric battery.
  - `run_config.sh` - run one whisper-cli config, save transcript, score it.
  - `run_fw.py` - faster-whisper comparison run.
  - `embed_once.py` - extract speaker embeddings once (VAD + windows) to `.npy`.
  - `diar_cluster.py` - sweep auto-count methods over saved embeddings.
  - `diar_final.py` - shippable auto-diarization recipe (NME-SC -> turns).
  - `diar_auto_full_turns.txt` - the full-file auto result (2 speakers, 351 turns).
- Models (not in repo): `~/whisper-models` (ggml tiny/base/small +.en),
  `~/whisper-models/diar` (eres2net emb, pyannote seg, silero_vad.onnx), and a
  python3.11 venv at `~/whisper-models/venv` (sherpa-onnx, faster-whisper, scikit-learn).
- Test audio: `sim/insights/realdata/dl-1312.wav` (28.5 min, 2 speakers) plus other real
  clips in that folder.

## 8. One-paragraph summary for a new agent
Off Grid is building an offline, on-device always-on recorder that turns conversations
into summaries and lets you chat across them, in the spirit of Fathom and Neosapien but
fully local. The bottleneck is transcript quality on noisy ambient audio, not the LLM.
The research here found that `base.en` with context off, non-speech-token suppression,
entropy threshold 2.6, silero VAD, beam search, and temperature fallback on - fed raw
audio with no preprocessing - gives the best transcript, beating small and matching it
for far less cost, expressible directly in whisper.rn. Speaker diarization runs fully
on-device in ONNX and auto-detects the speaker count correctly using NME-SC spectral
clustering over eres2net embeddings, so the product does not need to ask how many people
are talking. What remains is validating the count on a known 3-plus-speaker clip, wiring
the config into the app, deciding how to surface non-English and low-quality segments,
and a human ear-check of the winning transcript before shipping.
