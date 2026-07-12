# Transcript Quality + Cheap Diarization — Experiment Prompt

Paste the block below into a fresh agent chat. Goal: empirically find how to get
the best transcript + cheapest speaker diarization out of noisy ambient phone
audio, ideally with tiny/base whisper, for the Off Grid on-device insights
pipeline. The agent has full internet + download latitude.

---

```
You are a researcher solving a hard, open problem: how to get the BEST possible
transcript + the cheapest viable speaker diarization out of noisy, ambient phone
recordings — ideally using TINY or BASE whisper. This is for an offline React
Native app ("Off Grid") whose on-device insights pipeline (summary / key points
/ action items per recorded conversation) is bottlenecked by TRANSCRIPT QUALITY,
not the LLM.

## Mindset (important)
Work like a researcher, not a task-runner. You have internet access — search and
read as much as you want: papers, whisper.cpp issues, HuggingFace model cards,
blog posts, forum threads, other people's configs. You have full freedom to
download anything and run anything. Be CREATIVE and try techniques beyond the
obvious — e.g. classic DSP like RMS (root-mean-square) loudness normalization to
lift quiet ambient audio, spectral gating / denoise, high-pass filtering, VAD
pre-segmentation, chunk-stitching, prompt/initial-token tricks, decoding-param
combos others have found. Form hypotheses, test them one variable at a time,
measure, keep what works, discard what doesn't, and follow promising threads
wherever they lead. Iterate until the numbers plateau.

## Keep a LIVING progress log (do this from the start, update constantly)
Maintain a single file at `docs/plans/transcript-quality-findings.md` and update
it after EVERY experiment round so someone else can track progress without
seeing this chat. Keep it in this exact shape, newest info on top:
- **Status line:** round number + what you're currently testing.
- **Current best config:** model + params + preprocessing, with its numbers.
- **Leaderboard table:** each config tried -> key metrics (WER/CER on the hand-
  labeled clip, repetition score, compression ratio, avg_logprob, VAD-alignment,
  entity recall). One row per experiment.
- **Diarization status:** what was tried, what works, accuracy + cost.
- **Open blockers / truth blockers:** what no config fixes yet.
- **Next experiments:** your ordered hypotheses to try next.
Overwrite/append this file continuously — treat it as the source of truth for the
research. Do not bury findings only in chat.

## Research first (don't guess — go read)
- whisper.cpp README + full decode-param docs; its GitHub issues/discussions for
  known loop/hallucination fixes and recommended flag combos.
- What people actually do: repos, posts, HF cards, threads on reducing whisper
  hallucination/repetition on noisy audio.
- Newer approaches: whisperX, faster-whisper, distil-whisper, sherpa-onnx, recent
  small-model or preprocessing tricks.
- Specifically: can turn/speaker detection be added to tiny/base output by ANY
  method (word-timestamps + a separate speaker-embedding/diarization pass, à la
  whisperX), instead of needing a tdrz model?

## The audio (know it before you benchmark)
- Always-on recorder audio: phone on a table / in a pocket. 16 kHz mono 16-bit
  WAV. Ambient, variable SNR, multi-speaker, often code-switched (English + a
  second language), clips up to ~30 min.
- base.en on this audio fails in 3 ways we've observed: (a) loops a phrase 50+
  times on low-signal stretches, (b) emits "(speaking in foreign language)" x N,
  (c) mishears heavily. "Accuracy" = fewer loops/hallucinations, fewer
  dropped/foreign segments, closer to what was really said.
- PRIMARY TEST FILE: a ~30-min real product-strategy meeting recording at
  `sim/insights/realdata/dl-1312.wav` (16k version: `dl-1312-16k.wav`); the
  original may also be in the laptop's `~/Downloads`. Genuine noisy multi-speaker
  conversation — the realistic hard case. Existing base.en transcripts of other
  clips are in `sim/insights/realdata/jul9/*.txt` (loop + foreign examples to
  study). NOTE: no phone is connected — work entirely from files already on the
  laptop (Downloads + the realdata folder). Do not rely on adb.

## Goal + model priority
- We WANT tiny or base to be good enough — squeeze the MAXIMUM decent quality out
  of tiny/base via params + preprocessing + any add-on. `small` is a fallback,
  less preferred. SKIP medium and large as shipping models.
- Shippable path today is whisper.cpp via whisper.rn (exposes decode params +
  `tdrzEnable`). App recommendations must be expressible there. ONNX paths are
  exploratory — allowed, but flag that they'd mean a different runtime.

## Experiments (systematic, one variable at a time, log everything)
1. Decode params on tiny/base against the 3 failure modes:
   - condition_on_previous_text OFF (`--no-context`) — the loop killer, test first
   - entropy_thold / logprob_thold / compression-ratio fallback thresholds
   - temperature + temperature-inc fallback, beam-size, best-of, no-speech-thold,
     word_thold, VAD gating (silero) before decode
   Find the param SET that most reduces loops/hallucination on tiny/base without
   hurting real speech.
2. Model sweep: tiny vs base vs small (.en too). Does size actually move accuracy
   on THIS audio, or do the right params on base match/beat small? Quantify. The
   win we want: base (or tiny) + right config ≈ small.
3. Audio preprocessing — does it help tiny/base? RMS/loudness normalization
   (ffmpeg loudnorm or manual RMS gain), amplitude gain, high-pass filter, light
   denoise (afftdn / rnnoise), spectral gating. Test each alone. Does lifting
   quiet ambient audio reduce mishearing/loops?
4. Diarization, cheapest first — "how many speakers / who spoke when":
   - Verify: tiny/base have NO tdrz variant and ignore diarization flags (only
     small.en-tdrz exists). Confirm or refute.
   - Then research + try diarizing tiny/base output via a SEPARATE pass:
     word-timestamps + speaker embeddings + clustering (whisperX-style), or
     sherpa-onnx speaker diarization, or a cheap energy/pitch heuristic on VAD
     segments. Report which gets usable speaker counts/turns and its cost.
5. ONNX track (separable): whisperX / faster-whisper / distil-whisper /
   sherpa-onnx. Is any dramatically better or cheaper on this audio at tiny/base
   scale? If yes, note it AND the cost of switching the app off whisper.rn.

## Benchmarking — there is NO full gold transcript for this audio, by design
This audio is unique real-world recording; you cannot get a full reference
transcript, and a big-model transcript is NOT truth (it hallucinates too). So do
NOT chase full-file WER. Rank with the layered approach below.

- Reference-free metrics do MOST of the ranking with zero gold (the full battery
  below) — they catch loops/foreign/low-confidence directly.
- Small hand-corrected slice = your only real gold: take a big model's draft of
  ~2-4 min of `dl-1312.wav`, LISTEN, and CORRECT it into a true transcript. The
  corrected version is gold (the draft is not). Compute WER/CER on that slice
  only. A representative slice is enough to rank configs.
- Fact recall (best fit for the product): the audio owner can supply a short
  ground-truth FACT LIST from memory (who was there, topics, numbers, decisions,
  actions) without transcribing. Measure whether each config's transcript
  preserves those facts. Weight this ABOVE WER.
- Work ONLY on the real-world audio (`dl-1312.wav`, plus any other real clips in
  the realdata folder). Do NOT synthesize or TTS test audio — the whole point is
  the messy real recording. Real audio only.
- Any big-model transcript is only ever a DRAFT to correct — never ground truth,
  and never a shipping model (skip medium/large regardless).

## Save every transcript for human audit
The audio owner will audit transcripts by hand later, so SAVE each config's full
output. Write every transcript you produce to
`sim/insights/realdata/experiments/<short-config-name>.txt` (e.g.
`base_no-context_rmsnorm.txt`), and keep a manifest `experiments/INDEX.md`
mapping each filename -> the exact config (model, params, preprocessing) and its
metric scores. Never overwrite a prior config's transcript. This folder is the
audit trail.
- Objective, reference-free metrics on the full file (use the whole battery, not
  just WER):
  - Repetition: max n-gram repeat count, longest repeated substring, gzip
    compression ratio (whisper.cpp flags >2.4), abnormal segment length.
  - Confidence: avg_logprob, no_speech_prob, decode temperature used, token
    entropy per segment.
  - Alignment: VAD-vs-transcript (text over VAD-silence = hallucination; VAD
    speech with no text = drop; transcribed-duration / VAD-speech-duration).
  - Sanity: words-per-second, language-detect probability + foreign-marker count,
    known-hallucination blacklist ("thanks for watching", "please subscribe", "♪").
  - Plausibility: transcript perplexity under a small LM; non-word ratio.
  - Consensus: cross-model agreement (tiny vs base vs small) as a pseudo-
    confidence map — segments where models disagree are the low-quality ones.
- WER alone is MISLEADING for this product. Weight ENTITY RECALL (did the key
  names/numbers/dates/decisions survive?) and downstream insight quality above
  raw WER - a summary can be right at 30% WER if the important nouns made it.
- Optional cross-check only: a bigger model's transcript — treat as fallible, not
  ground truth (do not use medium/large as the shipping model regardless).
- Diarization: compare detected speaker count to the real number of people; if
  you hand-label a few turn boundaries, compute a rough DER.

## Deliverables
1. Ranked findings with NUMBERS: best decode-param config for tiny and for base;
   whether tiny/base can match small; whether preprocessing (incl. RMS) helps;
   the cheapest diarization method that works (accuracy + cost); ONNX verdict.
2. One recommended default config (model + params) expressible via whisper.rn,
   plus a low-signal-clip fallback config.
3. Remaining "truth blockers" — what no config fixes (non-English, overlapping
   speech, etc.) — so the product can route around them (skip / mark / ask user).
Keep a running experiment log. Iterate until the numbers plateau, then report.
```
