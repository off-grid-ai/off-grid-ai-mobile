# Transcript Quality + Cheap Diarization — Living Findings

> Source of truth for the transcript-quality research. Newest info on top.
> Goal: squeeze the best transcript + cheapest speaker diarization out of noisy,
> ambient phone recordings using **tiny/base whisper**, expressible via whisper.rn,
> for the Off Grid on-device insights pipeline.

---

## Status line
**PLATEAU — done.** Rounds 1–6 complete (decode sweep, model sweep, preprocessing,
diarization + auto-count, ONNX/CT2 track, large-v3-turbo reference). Numbers plateaued:
params dominate, base is the sweet spot, preprocessing hurts, **diarization auto-count
SOLVED via NME-SC (validated 2 and 5)**, whisper can't cleanly code-switch. See
**Deliverables** for the shipping recommendation.

## Current best config
```
model:  ggml-base.en
flags:  -l en  -mc 0  -sns  -et 2.6  --vad --vad-model ggml-silero-v5.1.2.bin
        (beam 5 + temperature fallback = defaults, KEEP them)
```
whisper.rn mapping: `language:'en'`, `maxContext:0`, `suppressNonSpeechTokens:true`,
`entropyThold:2.6`, `useVad:true` + `vadModelPath`, leave `beamSize`/`temperature`
at defaults. Scores on `dl-1312.wav`: compression 2.96, max-trigram-repeat 24,
longest-run 3, avg_logprob −0.49, **domain_recall 0.58 (28/48 — highest of all
configs/models)**, zero blacklist/foreign markers, vad_coverage 1.13, 64s/28min on M3.

### Why these flags (each earned its place empirically)
- `-mc 0` (condition-on-previous-text OFF): the catastrophic loop killer. Control
  looped "go to the middle of the building" **×173**; `mc 0` cut max-trigram-repeat
  178→26. Partial context (`-mc 64`) was WORSE than default (263) — must be full 0.
- temperature fallback ON (default): turning it off (`-nf`) was catastrophic —
  longest-repeat-run **1555**, compression 33, domain_hits 4. Fallback is the
  loop-escape ladder; never disable it.
- `--vad` (silero): skips silent stretches where loops nucleate; cut over-coverage
  and residual loops, zero cost to real speech.
- `-sns` (suppress non-speech tokens): removes the "(speaking in foreign language)"
  / music-marker class. `mc 0` alone emitted 9 blacklist + 5 foreign markers; `sns`
  drove both to 0.
- `-et 2.6` (entropy threshold): triggers fallback earlier on high-entropy
  (loopy/uncertain) segments; nudged domain recall to its max (28) and coverage to
  its tightest (1.13). Alone it added foreign markers, but `sns` cancels that.
- beam search (default 5): `-bs 1 -bo 1` greedy reintroduced 21 blacklist + 10
  foreign markers and worst domain recall. Keep the beam.

## Benchmarking setup (how truth is anchored here)
- **No gold transcript by design** (owner decision: rank on **reference-free
  metrics + cross-model consensus only** — I cannot listen to the audio).
- **Test file:** `sim/insights/realdata/dl-1312.wav` — 1711.3s (28.5 min),
  16 kHz mono s16le. Mean volume **−28.8 dB** (quiet ambient; RMS/loudnorm is a
  candidate lever), max −1.5 dB.
- **Content anchor:** real product-strategy meeting about **Off Grid** — building a
  Neosapien/Fathom-style always-on listening + insights product. So a good
  transcript should surface domain nouns (Off Grid, Fathom, insights, retention,
  DAU/MAU, notifications, recorder…). This drives the **domain_recall** metric.
- **Speakers (owner):** 2 people → diarization target = 2.
- **Language (owner):** English is what matters; some Hindi present but not a
  target — force `language=en`, treat Hindi as a drop/mark case, not a goal.
- **VAD reference (silero v5.1.2):** 1213.2s speech / 1711.3s = **70.9% speech**.
  `vad_coverage` = transcribed-speech-sec / 1213.2; ~1.0 ideal, ≫1 = hallucination
  into silence, ≪1 = drops. (Rough proxy — whisper segment spans overlap silence.)

### Metric battery (reference-free) — see `sim/insights/harness/score.py`
| Metric | Meaning | Better |
|---|---|---|
| `compression_ratio` | gzip len ratio; whisper flags >2.4 as loop | lower |
| `max_bigram_repeat` / `max_trigram_repeat` | most-repeated n-gram count | lower |
| `longest_repeat_run` | longest run of same word (hard loop) | lower |
| `avg_logprob` | mean token log-prob (confidence) | higher (→0) |
| `pct_low_conf_segs` | frac segments avg logprob < −1.0 | lower |
| `blacklist_hits` | "thanks for watching"/music/"you"/foreign markers | lower |
| `foreign_marker_hits` | "(speaking in foreign language)" count | lower |
| `nonword_ratio` | non-dictionary token fraction | lower |
| `domain_recall` | frac of expected product-meeting vocab present | higher |
| `vad_coverage` | transcribed-speech / VAD-speech | ~1.0 |

## Leaderboard (full-file `dl-1312.wav`, `-l en`; raw rows in `results.jsonl`)
Lower better: comp, maxTri (max-trigram-repeat), run (longest-repeat-run), blk, frn.
Higher better: domain (distinct domain nouns /48), logP. vadCov: ~1.0 ideal.

### Round 1 — base.en decode-param sweep (one variable at a time)
| config | comp | maxTri | run | logP | blk | frn | domain | vadCov | verdict |
|---|---|---|---|---|---|---|---|---|---|
| b_default (control) | 5.81 | 178 | 4 | −0.31 | 0 | 0 | 25 | 1.40 | "middle of building"×173 loop |
| b_mc0 | 2.90 | 26 | 4 | −0.58 | 9 | 5 | 26 | 1.15 | loop killed, but markers appear |
| b_mc64 | 5.04 | 263 | 2 | −0.28 | 0 | 0 | 23 | 1.30 | partial ctx WORSE than default |
| b_nofallback | 33.2 | 1553 | 1555 | −0.05 | 0 | 0 | 4 | 1.39 | catastrophic — never disable fallback |
| b_mc0_ent26 | 2.55 | 14 | 16 | −0.64 | 20 | 11 | 26 | 1.16 | best loops, worst markers |
| b_mc0_sns | 2.96 | 100 | 102 | −0.61 | 0 | 0 | 26 | 1.26 | sns kills markers; loop returns w/o VAD/ent |
| b_mc0_vad | 3.01 | 20 | 2 | −0.46 | 2 | 1 | 24 | 1.21 | VAD tames loops |
| b_mc0_vad_sns | 3.05 | 21 | 3 | −0.52 | 0 | 0 | 27 | 1.19 | zero markers, high recall |
| **b_mc0_vad_sns_ent26** | **2.96** | **24** | **3** | **−0.49** | **0** | **0** | **28** | **1.13** | **WINNER** |
| b_mc0_greedy | 2.61 | 12 | 5 | −0.72 | 21 | 10 | 23 | 1.13 | beam matters; greedy adds markers |

### Round 2 — model sweep (winner config vs defaults)
| config | comp | maxTri | run | logP | domain | vadCov | sec | verdict |
|---|---|---|---|---|---|---|---|---|
| t_default | 3.72 | 98 | 34 | −0.55 | 21 | 1.41 | 34 | tiny loops badly at default |
| t_win | 3.01 | 44 | 38 | −0.57 | 24 | 1.17 | 87 | config helps but tiny still loops (run 38) |
| b_default | 5.81 | 178 | 4 | −0.31 | 25 | 1.40 | 47 | — |
| **b_win** | **2.96** | **24** | **3** | **−0.49** | **28** | **1.13** | **64** | **best domain recall of ALL** |
| s_default | 2.82 | 10 | 6 | −0.51 | 27 | 1.35 | 65 | bigger models loop less by default |
| s_win | 2.76 | 17 | 2 | −0.52 | 24 | 1.27 | 93 | fewer loops but LOWER recall + slower |

**Headline:** base.en + winner config **matches/beats small** on the product-relevant
metric (domain recall 28 vs 24) at 2/3 the cost. Size does NOT buy accuracy on this
audio once the params are right — the params matter far more than the model size.
tiny is the risky fallback (still loops); base is the sweet spot.

### Round 3 — preprocessing (winner config on preprocessed audio, each ALONE)
| preprocessing (ffmpeg) | comp | maxTri | run | logP | domain | vadCov | verdict |
|---|---|---|---|---|---|---|---|
| **RAW (no preprocessing)** | 2.96 | 24 | 3 | **−0.49** | **28** | **1.13** | **BEST** |
| loudnorm I=−16 | 2.79 | 34 | 4 | −0.57 | 25 | 1.26 | hurts recall + conf |
| volume +12 dB | 2.78 | 19 | 4 | −0.51 | 20 | 1.27 | worst recall |
| dynaudnorm | 2.87 | 30 | 5 | −0.56 | 22 | 1.22 | hurts |
| highpass 80 Hz | 2.75 | 19 | 2 | −0.50 | 23 | 1.14 | fewer loops, less recall |
| afftdn denoise | 2.74 | 13 | 5 | −0.61 | 21 | 1.21 | fewest loops, worst conf, low recall |
| highpass+loudnorm | 2.97 | 26 | 2 | −0.59 | 24 | 1.22 | hurts |

**Preprocessing verdict: NONE helps — feed whisper the RAW 16 kHz audio.** Denoise/
highpass cut loops slightly but every enhancement *lowers* domain recall (the metric
we weight highest) and worsens confidence/coverage. Confirms *"When De-noising Hurts"*
(arxiv 2512.17562): Whisper is enhancement-sensitive; lifting/denoising the quiet
(−28 dB) ambient amplifies noise Whisper otherwise tolerates. The recorder should NOT
add loudnorm/denoise before whisper. (RMS-lift hypothesis: tested, rejected.)

## Round 5 — ONNX / CTranslate2 track (faster-whisper, the whisperX engine)
faster-whisper base.en, int8, CPU, with the exact winner-equivalent config
(condition_on_previous_text=False, temp-fallback ladder, vad_filter, beam 5,
compression 2.4 / logprob −1.0 / no-speech 0.6):

| engine | comp | maxTri | run | logP | domain | vadCov | RTF | runtime |
|---|---|---|---|---|---|---|---|---|
| whisper.cpp b_win (Metal) | 2.96 | 24 | 3 | −0.49 | **28** | **1.13** | **0.037** | whisper.rn ✅ shippable |
| faster-whisper (CT2 int8, CPU) | 2.63 | 11 | 9 | −0.80 | 27 | 1.25 | 0.101 | CTranslate2 ❌ runtime swap |

**ONNX verdict: not worth switching.** faster-whisper is marginally less loopy
(maxTri 11) but recalls FEWER domain terms (27 vs 28), has worse confidence and
coverage, and ran 2.7× slower here (CPU int8 vs whisper.cpp Metal; on-device
whisper.rn is also GPU/NEON-accelerated). No dramatic quality or cost win, and adopting
it means ripping out whisper.rn for a CTranslate2/ONNX runtime — high cost, no payoff.
distil-whisper (English-only distilled) could be faster but distilled models are known
to hallucinate more on hard audio — not worth chasing when base.cpp already works.
**Stay on whisper.rn / whisper.cpp.** The only thing the whisperX ecosystem offered
that whisper.cpp lacks is diarization — and sherpa-onnx covers that on-device.

## Diarization status — AUTO-DETECT SOLVED (on-device ONNX, shippable)
First pass used sherpa-onnx's built-in `FastClustering`; it needed a FIXED count and
its auto mode failed (23 speakers for a 2-person meeting). Root cause: FastClustering
(threshold agglomerative) is a weak auto-counter on noisy embeddings. **Fix: replace
the clustering stage with NME-SC** (Normalized Maximum Eigengap Spectral Clustering,
the method pyannote/NeMo use). Same ONNX embeddings, better counting math.

Pipeline that works: whisper.cpp silero VAD → window speech (1.5s / 0.75s hop) →
sherpa-onnx **eres2net** embedding per window → cosine affinity → **NME-SC picks k by
max normalized eigengap** → spectral clustering → merge windows into turns. All ONNX,
no PyTorch, no HF token, no speaker-count hint.

| method (auto-count, true k=2) | slice k | full-file k | verdict |
|---|---|---|---|
| sherpa FastClustering (thr 0.5) | 23 | — | FAILS |
| phantom-drop (agglo + >5% floor) | 2 (thr≈0.65) | **3** | threshold-sensitive, over-counts |
| **NME-SC eigengap + eres2net (RAW)** | **2** | **2** | **WORKS — no hint, no tuning** |
| NME-SC + wespeaker-EN embeddings | 6 | — | worse — don't switch model |
| NME-SC + denoised audio (afftdn) | 3 | — | worse — don't denoise |

**Full-file auto result:** **2 speakers auto-detected, 351 turns, 74/26 talk split**,
matching the forced-2 reference (74/26) exactly, with a clean interviewer/interviewee
alternation. **The product does NOT need to ask "how many people".**

**Cost:** embeddings ~64s for the 28-min file on M3 CPU (RTF ≈0.037, same order as
transcription); NME-SC clustering adds a few seconds. Much cheaper than the original
FastClustering full-pipeline (RTF 0.38) because we embed fixed windows once instead of
sherpa's internal dense sweep. Still run it lazily/opt-in on phone, but it is NOT the
10× tax the first pass suggested.

**Embedding-model cost sweep (full file, all auto-count correctly = 2):**
| emb model | dim | disk | extract 28min (M3 CPU) | auto-k | split | turns |
|---|---|---|---|---|---|---|
| eres2net | 512 | 38 MB | 64s | 2 | 74/26 | 351 |
| CAM++ | 192 | 27 MB | 25s (2.6× faster) | 2 | 70/30 | 337 |
| **TitaNet-small (pick)** | 192 | 38 MB | **18s (3.5× faster)** | 2 | 72/28 | 307 |

**Cost correction:** with TitaNet-small the embedding pass is 18s vs whisper transcription
64s — **diarization is ~⅓ the cost of transcription, not 10×.** The earlier 10× figure was
sherpa's dense built-in pipeline; the lean windowed path is far cheaper. Lean total for
28 min ≈ 18s embed + 3.6s NME-SC = ~22s (RTF ~0.013 laptop). If you default to k=2 and
skip NME-SC, clustering is ~0.1s.

**Ablations that failed:** English wespeaker embeddings (k=6, worse); denoise before
diarization (k=3, worse). CAM++ and TitaNet-small both work AND are cheaper, so wespeaker
was just a bad model, not "only eres2net works". Phantom-drop over-counts to 3 on the full
file — NME-SC is the robust auto-counter.
- whisperX/pyannote cross-check: **blocked offline** (HF-gated, PyTorch, not
  mobile-shippable). Not needed — the ONNX NME-SC path already auto-counts correctly.

### Validation: NME-SC genuinely counts (not biased to 2) — CONFIRMED
Tested on a 5-min slice of the Lex Fridman × Cursor-team podcast (ground truth = Lex +
4 = 5 speakers). Both embedding models independently auto-detected **5**:
- TitaNet-small: 5 speakers, split 45/23/12/11/10
- eres2net: 5 speakers, split 44/21/12/11/11
So NME-SC returns 2 on the 2-person meeting and 5 on the 5-person podcast, no hint, no
tuning, with two models agreeing on both count and distribution. The "always-2" worry
is closed. (Not hand-labelled at the boundary level, so exact turn edges unverified;
the COUNT is correct and cross-model-consistent. A short/quiet window may show fewer
than the episode total if someone is silent in it — correct behaviour.)

## Prior art (what others do — sourced)
- **Loop/hallucination fixes (whisper.cpp #1490/#2286/#464, #3744):** limit context
  (`max-context 0` or 64) to stop self-reinforcing loops; **keep temperature
  fallback ON** — the fallback ladder is the main mechanism that *escapes* loops;
  raise `entropy-thold` ~2.6; silence → "thanks for watching"/"subtitles by" class
  hallucinations. Newest proposal (#3744, Apr 2026) adds `context_max_vad_gap_ms` +
  `retry_on_repeat`.
- **Thresholds:** compression-ratio fallback default 2.4 (aggressive 1.35),
  logprob −1.0, no-speech 0.6. `suppress-nst` / suppress-regex to kill non-speech.
- **Preprocessing is genuinely ambiguous:** some report 60–75% WER gains from
  denoise+loudnorm on heavy noise; but arxiv *"When De-noising Hurts"* (2512.17562)
  shows Whisper is unusually enhancement-sensitive and denoise can *raise* WER
  (16%→51% under Gaussian noise). ⇒ test each preprocessing step in isolation,
  keep only what the metrics reward. Loudnorm to ~−16 dBFS is the safe candidate.
- **Diarization:** industry meeting pipelines = VAD → whisper → wav2vec2 word-align
  → pyannote diarization → assemble (WhisperX). sherpa-onnx ports the diarization
  to on-device ONNX (pyannote-seg-3.0 + eres2net), ~2KB/speaker embeddings, no GPU.

## Open blockers / truth blockers (what NO config fixes)
- **Non-English / Hindi & code-switching.** Force-English mis-transcribes or drops
  Hindi stretches; no decode config recovers content the model can't hear in English.
  Product must route around: detect + mark "non-English segment (not transcribed)",
  don't let it feed garbage into the insights LLM.
- **Genuine low-signal stretches.** When SNR is too low, the honest output is nothing;
  the winner config correctly drops/marks these instead of looping. A summary built on
  a low-signal clip will be thin — the product should surface a "low-audio-quality"
  flag rather than a confident-but-wrong summary.
- **Overlapping speech.** Diarization talk-time is approximate when both speakers talk
  at once; whisper also garbles overlaps. Unfixable at this model scale.
- **Reference-free ceiling.** Ranking detects loops/foreign/low-confidence and vocab
  coverage, but cannot certify the exact right words survived. For a shipping decision
  the owner should spot-audit `experiments/*.txt` (that's why every transcript is saved).

## Deliverables — see bottom "DELIVERABLES" section (recommendation + fallback + routing)

---

# DELIVERABLES

## 1. Ranked findings (with numbers)
1. **Params matter far more than model size.** On raw base.en, fixing decode params
   cut max-trigram-repeat from **178 → 24** and lifted domain recall **25 → 28/48**,
   while raw small.en (no params) only reached 27 and still needed the same params.
2. **Best decode config for base:** `-mc 0 -sns -et 2.6 --vad` (details below).
   Best for tiny: same flags, but **tiny still loops** (longest-run 38) — usable only
   as a low-resource fallback, not the default.
3. **base ≈/> small.** base+config domain recall **28** vs small+config **24**, at 2/3
   the runtime (64s vs 93s / 28 min). Small is NOT worth shipping. tiny < base.
4. **Preprocessing does NOT help** — RAW audio scored best on domain recall (28);
   loudnorm/gain/dynaudnorm/highpass/denoise all lowered it (to 20–25). Do not add DSP.
5. **Cheapest diarization that works:** sherpa-onnx (pyannote-seg-3.0 + eres2net emb),
   ONNX/on-device, **with a FIXED cluster count** → 2 speakers, 72/28 split. Auto-count
   fails (23 vs 2). Cost RTF ≈0.38 CPU (~10× transcription) → run lazily/opt-in.
6. **ONNX verdict:** faster-whisper/CT2 = comparable quality, slower, needs a runtime
   swap → **stay on whisper.rn**.

## 2. Recommended default config (expressible via whisper.rn)
```jsonc
// DEFAULT — every recording
{
  "model": "ggml-base.en",          // NOT small; base+params ≥ small here
  "language": "en",
  "maxContext": 0,                  // -mc 0  condition_on_previous_text OFF (loop killer)
  "suppressNonSpeechTokens": true,  // -sns   kills "(speaking in foreign language)"/music
  "entropyThold": 2.6,              // -et 2.6 earlier fallback on loopy segments
  "useVad": true,                   // --vad  silero ggml-silero-v5.1.2.bin (already in-app)
  // KEEP defaults — DO NOT change these:
  "beamSize": 5,                    // greedy reintroduces hallucinations
  "temperature": 0.0,               // with fallback ladder ON (never disable fallback)
  "noSpeechThold": 0.6
  // NO audio preprocessing — feed raw 16 kHz mono PCM.
}
```

### Low-signal-clip fallback config
If a clip trips loop/low-confidence guards (compression_ratio > ~3, or
max-trigram-repeat high, or many low-confidence segments), re-run once with a MORE
aggressive anti-loop profile, then keep whichever output scores cleaner:
```jsonc
{ "model": "ggml-base.en", "language": "en",
  "maxContext": 0, "suppressNonSpeechTokens": true,
  "entropyThold": 2.8, "useVad": true, "vadThreshold": 0.6,  // stricter VAD
  "beamSize": 5, "temperature": 0.0 }
```
If the device is too slow for base, drop to `ggml-tiny.en` with the SAME flags — accept
that tiny loops more; still better than base-at-default.

## 3. Diarization recommendation (AUTO-DETECT — no user hint needed)
- Pipeline (all ONNX, on-device): silero VAD → 1.5s/0.75s windows over speech →
  sherpa-onnx **eres2net** embedding per window → cosine affinity → **NME-SC eigengap
  auto-count** → spectral clustering → merge into turns.
- **Do NOT use sherpa's built-in FastClustering** for auto-count (gave 23 vs 2) and do
  NOT switch to English embeddings or denoise (both made counting worse). eres2net on
  RAW audio + NME-SC is the combo that auto-counts correctly (k=2, 74/26, 351 turns).
- Models: pyannote-segmentation-3.0 (or just silero VAD) + eres2net emb (~40 MB) +
  silero_vad.onnx (~0.6 MB). No PyTorch, no HF token.
- Cost ≈ transcription-order (embeddings RTF ~0.037 on M3 CPU); still run lazily/opt-in
  on phone. Reference impl: `sim/insights/harness/{embed_once.py,diar_final.py}`.
- Caveat: validated where truth = 2 speakers; confirm it scales up on a known 3+
  speaker clip before shipping.

## 4. Product routing for the truth blockers
- **Mark, don't feed, non-English/Hindi + low-signal segments** — flag them
  ("audio unclear / non-English — not transcribed") so the insights LLM never
  summarizes hallucinated text.
- Surface a **low-audio-quality** badge when reference-free guards fire, instead of a
  confident-but-wrong summary.
- The insights pipeline should tolerate ~40% WER as long as key nouns survive — the
  winner config maximizes exactly that (domain-noun recall), which is the right target.

## Repro / audit
- Harness: `sim/insights/harness/{score.py,run_config.sh,run_fw.py,diarize.py}`
- Raw metrics: `sim/insights/harness/results.jsonl`
- 20 saved transcripts + map: `sim/insights/realdata/experiments/*.txt` + `INDEX.md`
- Models: `~/whisper-models` (ggml tiny/base/small ±.en), `~/whisper-models/diar`

---

## Round 6 — large-v3-turbo reference (Hinglish / auto-language question)
Ran large-v3-turbo (q5_0, 547 MB) as a REFERENCE (large is not a base shipping model).
On a 5-min slice, comparing language modes:

| mode | result |
|---|---|
| `-l auto` (plain) | locks to English (dominant), clean output; does NOT surface Hindi |
| `-l auto` + `--vad` | multilingual GARBAGE (random VI/HE/PL/DE words) — per-VAD-segment re-detect flails |
| `-l hi` (forced Hindi) | loops/hallucinates Hindi ("प्रेम प्रेम…", "सब्सक्राइब कर दो") over English audio |
| `-l en` (forced English) | clean, coherent English (≈ plain auto) |

**Hinglish verdict:** whisper does NOT cleanly code-switch at any size. It picks ONE
language per file (auto → English here) and renders everything in it; no per-sentence
Hindi/English tagging. `-l auto` + VAD is actively dangerous (garbage). Forcing English is
correct for this audio — the forced-Hindi run mostly *hallucinated* Hindi, meaning real
Hindi content is minimal (mostly English + a few transliterated words). Truth blocker
stands: code-switched/non-English is not recoverable here; route around it.

**Side finding (notable):** large-v3-turbo-q5 is DRAMATICALLY cleaner than base.en and is
only 547 MB — same size class as small.en (488 MB, already shipped). Example (same line):
- base.en: "when you are doing consumer, that time like daily active users… they are very
  complex. So, you want to have the risk to matter and smoothies and so on." (garbled)
- large-turbo: "It's a good way to incentivize me to go back to their app. Think about how
  you are going to incentivize me to come back… how do I consume what intelligence you have
  processed?" (clean)
So large-v3-turbo-q5 is a plausible PREMIUM on-device model for capable phones, not just a
laptop reference. On-device speed unverified (turbo's 4-layer decoder is fast in principle).
Transcripts saved: `experiments/large_{autoplain,hi,en}_slice.txt`, `large_auto_slice5m.txt`
(the auto+VAD garbage example).

---

## Round 7 — ON-DEVICE benchmarks (OnePlus 7T, Snapdragon 855+, arm64)
Built whisper.cpp arm64 (NDK + SDK cmake) and benchmarked via adb on the real phone.
Cores: cpu0-3 @1785 MHz (little A55), cpu4-6 @2419 (big A76), cpu7 @2956 (prime A76) =
4 fast + 4 little. base.en, `-fa -mc 0`, 15-30s clips, cooldown-gated where noted.

**Encoder dominates:** encode = thousands of ms, decode = 39-100 ms in EVERY run. All
speed lives in the encoder; decode (and thread effects on it) are noise.

**Thread scaling (cooldown-gated, base.en 15s):**
| threads | encode_ms | note |
|---|---|---|
| 1 | 29023 (30s clip) | — |
| 4 | ~8900 (repeatable ±0.4%) | best |
| 8 | ~10150 | ~14% SLOWER than 4 |
Only 4 fast cores; threads 5-8 hit the 1785 MHz little cores and drag the synchronized
encoder. **Use 4 threads. More is worse.**

**Parallel whisper contexts (`-p`, cooldown-gated, total wall time):**
| config | total_ms | |
|---|---|---|
| t=4 p=1 (single) | 11960 | best |
| t=2 p=2 (parallel) | 28708 | 2.4× slower |
| t=4 p=2 (parallel, oversubscribed) | 26504 | 2.2× slower |
Encoder is compute-bound; 2 contexts fight over the same 4 cores + memory bandwidth.
**Parallel contexts HURT ~2×. One context, 4 threads, is the ceiling.**

**Thermal/DVFS swamps everything:** the SAME t=4 config gave 5675 ms (warm, clock maxed),
8900 ms (cooled, governor ramping), and 19312 ms (throttled after heavy load) — a 3.4×
swing from identical settings. The affinity test even showed little cores "beating" big
cores because the big-core run was throttled. So sustained back-to-back transcription
throttles this SoC 2-3×; that dwarfs any thread/context tuning.

**On-device takeaways:**
- threads = 4 (not max); do NOT use parallel contexts. Both parallelism levers are dead ends.
- The real speedups do LESS encoder work: smaller model, quantization, smaller `--audio-context`.
- Manage thermal: chunk with gaps, backfill when cool/idle/charging. Chunked-with-gaps
  stays in the fast (warm-not-throttled) regime; sustained load falls into the 2-3× throttle.
- NOT YET RUN on-device: flash-attn on/off, audio-context sweep, q5 vs fp16 (the encoder-
  shrink levers). Binary + harness ready at ~/whisper-models (bench_android.sh).
