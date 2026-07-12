# Locket Insights — Algorithm + Plan (Session Handoff)

> **Superseded by `locket-insights-handoff-v2.md`** for current state, the UX + model-lifecycle layer, the file map, and conventions. This v1 doc remains the reference for the **algorithm depth, the sim harness, and the real-data pull method** (sections 3-8). Read v2 first, then come here for the algorithm internals.

Handoff for the next agent working on the **on-device insights pipeline** (importance scoring → transcription → LLM summary/action-items) for the Locket ambient recorder in Off Grid Mobile AI. Captures the algorithm as built, what real-device data proved, the research conclusions, current code state, and what's still open.

Read alongside: `locket-insights-screen-plan.md` (the original screen/trigger plan), `locket-recorder-handoff.md` (recorder state + conventions), `combined-intelligence-layer-plan.md`.

> Open-core layout: public `@offgrid/core` in `src/`; the private **`pro`** submodule holds the recorder + insights feature (`pro/locket/…`). Core exposes registries/slots; pro plugs in. Everything below in `pro/locket/` unless noted.

---

## 1. TL;DR — current state

- The pipeline is: **free importance funnel → (transcribe) → grammar-forced LLM one-pass (WHAT + actions) → merge with regex extractive → precision filter → cache.** Higher-importance clips are processed first (priority queue).
- **Importance scoring is pure heuristics — no model, ~15µs/clip.** It both *gates* (skip junk) and *orders* (priority) transcription + LLM.
- **Grammar (GBNF) is wired into on-device generation** so even a 270M model can't drop the `TITLE/SUMMARY/ACTIONS` shape (validated in sim: 0-2% → 100% format).
- **Validated on real July 9 data** (69 recordings pulled off an Android phone, transcribed with whisper base.en): the funnel correctly drops foreign-only/blank/chatter/music and passes the real meetings. **One real bug found:** whisper repetition-loop clips (near-zero unique-word ratio, high word count) still pass — fix is to gate the word-count bonus by uniqueRatio.
- **Everything is JS/TS** (no native changes) except the LiteRT constraint work (separate). Reload-testable on a dev build.
- **NOT done:** the funnel `uniqueRatio` fix, the small-classifier commitment gate (sim-validated, not in app), `chrono-node` dates, LiteRT grammar exposure, on-device model-quality confirmation.

---

## 2. The problem & mental model

An always-on recorder captures **hundreds of clips/day, mostly junk** (silence, music, one-sided calls, foreign speech, ambient noise). Goal: surface **what happened + action items** per real conversation, **fully on-device**, on a **tiny (~270MB) model**, without draining battery.

Mental model landed on:
```
every recording
   → IMPORTANCE SCORE (free heuristic)   ── gate: skip junk · order: priority
   → TRANSCRIBE (whisper) [priority order, important-looking first]
   → FULL SCORE (adds text signals)      ── gate: worth the LLM?
   → LLM one-pass (grammar-forced) WHAT + ACTIONS   [priority order]
   → merge LLM actions ∪ regex extractive → precision filter
   → cache on the recording (insightsAt)
```
Two hard constraints shaped it:
1. **Prefill is the cost, not generation** → never do two LLM passes over one transcript. One pass does WHAT + actions.
2. **Whisper and the LLM fight for RAM** → don't swap per clip. Process in **stage-batched epochs** (transcribe all, then analyze all), each model loaded once.

Key finding from the sim bake-off: **the LLM is the value; the cheap layers do triage.** Extractive regex alone gets ~91% action recall; the 270M LLM's real job is the *what-happened* line + cleaner phrasing. Precision (noise), not recall, is the hard part.

---

## 3. The importance funnel (the piece that works well)

`pro/locket/utils/recordingImportance.ts`. Pure regex + arithmetic, **no model, ~15µs/clip** (measured; a full day of 94 clips scores in ~1.4ms). Two scores:

- **`preScore(rec)`** — metadata + VAD only, **no transcript**. Signals: calendar match (+0.45, the strongest), ≥2 attendees, absolute speech-time (`vad.speechMs`, saturates ~5min), speech density (`speechPct`), duration. Gates the **transcribe** queue.
- **`fullScore(rec)`** — adds cheap text signals once transcribed: word count (substance), **unique-word ratio** (coherence), **repetition** (adjacent-dup), trigger-lexicon hits ("need to"/"by Friday"/"call"…), entity regex (Names/numbers/times), question marks, turn count, noise-marker penalty. Gates the **LLM**.

**Thresholds (tuned in sim):** `PRE_THRESHOLD = 0.35`, `LLM_THRESHOLD = 0.42`. Bias to recall (a false positive is one cheap extra LLM call; a false negative misses an action). At 0.42 the sim day held **100% recall / 76% precision**.

**`priorityRank(rec)`** = calendar-matched → score → recency. Drives BOTH epochs so important clips surface first. The score is a **gate AND a sort key**.

### Real-data verdict (July 9, 56 substantive clips, whisper base.en)
- **Correct drops:** foreign-only clips (`(speaking in foreign language)` × N → low word count → 0.08-0.25), `[BLANK_AUDIO]` (0.00), `(crowd chattering)`/`(audience laughing)`/`[INAUDIBLE]`/`(mumbles)` (u=1.00 but ~1-4 words → ~0.16-0.20), music. All skipped. ✅
- **Correct passes:** the real evening business meetings (20:29-20:55, u=0.46-0.66 — "API calls a day", "order creation service", "delegation") scored 0.77-0.83. ✅
- **The bug (confirmed on real data):** whisper **repetition loops** — clips where the model looped a phrase (u=0.01-0.04) but produced 800-978 "words" (16:42, 16:53, 17:04, 17:37) — scored 0.45-0.62 and **passed**. The word-count *substance* bonus (`clamp01(words/200)*0.2`) rewards volume even when `uniqueRatio≈0`.

**The fix (real-data-validated, do this first):** gate the substance bonus by uniqueRatio — e.g. multiply it by `uniqueRatio`, or hard-drop when `uniqueRatio < 0.15`. That tanks the four false positives below threshold while leaving the real meetings (u≥0.46) untouched. Also: the sim's synthetic `(foreign language)` placeholder differs from real whisper output — add real noise markers (`♪`, `(singing in foreign language)`, `(speaking in foreign language)`, `[BLANK_AUDIO]`, `(crowd chattering)`) and match the real foreign strings; add **phrase/line-repetition** detection (not just adjacent-token), since real loops repeat whole lines.

---

## 4. The LLM pass (as built)

`pro/locket/services/recordingInsights.ts` → `generateInsights(recordingId)`:
1. Tier-0 **extractive** floor first (`recordingInsightsExtractive.ts`): regex trigger-lexicon sentences + due-time parse → writes `title` + `actionItems` immediately (works with no model).
2. If no text backend ready → throw `SummaryModelMissingError` (UI prompts); the extractive floor is already persisted.
3. Else one **grammar-forced** pass via `transcriptSummarizer.summarize(input, { systemPrompt, combinePrompt, grammar: RECORDING_INSIGHTS_GBNF })` → `TITLE/SUMMARY/ACTIONS`.
4. Parse leniently (`parseInsights`), **merge** LLM actions ∪ extractive, run **precision filter** (`refineActionItems`: drop filler / <3 words / no action-verb, dedup), attribute **provenance** (`withSources`: best-match source sentence + `sourceStartMs` for tap-to-jump), cache.

- **Grammar path:** `src/services/transcriptSummarizer.ts` threads an optional `grammar` → `llmService.generateWithMaxTokens(msgs, max, { grammar })` → `ctx.completion({ grammar })` (llama.rn GBNF), applied only on the final/single pass, with a safe ungrammared retry on failure. **llama.rn only** — LiteRT ignores it (see §6).
- **Model:** `gemma3:270m` (or qwen2.5:0.5b), temp 0, output ≤200 tok, input capped ~1200 words. Single-pass; **no micro-batching** (sim showed batching costs ~13pts recall).
- **Priority-queue processor:** `recordingsStore.startInsightsProcessing` → `runInsightsQueue` (classify → `priorityRank` sort → sequential, resumable, cancellable, `imported` clips skipped). Progress in `insightsBatch {done,total,currentId,approxTokens}`.

---

## 5. Research conclusions (what to build next — evidence-backed)

From a deep-research pass (24 sources, verified) + a sim bake-off on our fixtures:

- **The fragile regex commitment-gate should become a small fine-tuned encoder**, not an LLM. Action-item detection = sentence-level binary classification; small (<160M) fine-tuned encoders beat few-shot 70B LLMs. Realistic ceiling is low (~43 F1 on AMI), action items are ~0.5-1.5% of utterances → **build a high-recall cheap gate feeding the LLM as the precision filter** (which is exactly our design).
- **Sim bake-off (all-MiniLM embeddings, our fixtures):** regex gate = 46% recall; **embeddings+LR = 79%**, **hybrid (embedding + regex-bit) & kNN = ~90-95% recall @ ~45% precision** at the high-recall operating point. **Tiny LLM as a per-sentence gate over-fires** (24% precision) — don't. Zero-shot prototypes ≈ regex (need a little training).
- **The gate can be built from parts already on the phone:** the app already ships **all-MiniLM (`all-MiniLM-L6-v2-Q8_0.gguf`)** for RAG (`src/services/rag/embedding.ts`) + **op-sqlite** + cosine kNN (`src/services/rag/vectorMath.ts`). So the commitment gate = shipped embedder + op-sqlite exemplar store + kNN, **zero new model/deps**. Bootstrap labels via SetFit/few-shot or distill from our own gemma3.
- **Dates: use `chrono-node`** (pure JS, on-device) to replace the hand-rolled `parseDueAt` regex. SUTime/HeidelTime (Java) / Duckling (Haskell) are NOT portable to RN.
- **LiteRT DOES support constrained decoding** (LiteRT-LM: JSON Schema / Lark / Regex via `decoding_constraint`, backed by LLGuidance) — corrects an earlier assumption. So the grammar recipe can work on LiteRT too, *if* the app's `liblitertlm_jni` bridge exposes it (a separate agent task; prompt already drafted).
- **Fine-tuning gemma3-270m** on our TITLE/SUMMARY/ACTIONS format (distilled from a bigger model over real transcripts) is the biggest *quality* lever, but a project (data pipeline + LoRA/MLX + GGUF convert + re-verify), not a quick win.

---

## 6. What's built (file-level, all in `pro/locket/` unless noted)

| File | What |
|---|---|
| `utils/recordingImportance.ts` (new) | `preScore`/`fullScore`/`classifyImportance`/`priorityRank` + thresholds |
| `services/recordingInsightsExtractive.ts` (new) | Tier-0 title + regex action items + due-time parse + `refineActionItems` (precision filter) |
| `services/recordingInsights.ts` (new) | `generateInsights` (grammar one-pass + merge + filter + provenance), `runInsightsQueue`, `RECORDING_INSIGHTS_GBNF` |
| `services/recordingExport.ts` (new) | Export/Import all recordings (lean JSON: no segments/audio), share-sheet + picker; import merges deduped, marks `imported` |
| `services/actionItemReminders.ts` (new) | Schedule a notifee reminder for an action item |
| `stores/recordingsStore.ts` | `insights*` fields, `setActionItemDone`, `startInsightsProcessing`/`stop`, `clearInsights`/`clearTranscripts`, O(N) dedup in `addRecoveredBatch`, transcribe filter resumes partials |
| `stores/recordingTypes.ts` | `Recording` type (extracted) + `title/actionItems/insightsSource/insightsAt/imported`, reset constants |
| `screens/LocketInsightsScreen.tsx` (new) | Per-recording insights (states, checklist, provenance `from:` tap-to-jump, reminders) |
| `screens/LocketInsightsHubScreen.tsx` (new) | Global hub: auto-run/2-option flow, live status card, results list, Export/Import, retry controls, `imported` tags |
| `screens/LocketTodayScreen.tsx` | Dev score labels on cards, `imported` tags, per-clip processing spinner, `⚡`→hub entry, resumable transcribe button |
| `screens/LocketPlayerScreen.tsx` | "Get insights" entry, "Share recording" in 3-dot |
| `src/services/transcriptSummarizer.ts`, `src/services/llm.ts` (core) | Optional `grammar` threaded to `ctx.completion` (final pass), safe fallback |
| `__tests__/unit/locket/recordingInsights*.test.ts`, `recordingImportance.test.ts` | 35 unit tests (parse/merge/extractive/scoring/filter) |

`sim/insights/` (dev-only, not shipped): fixtures + generator + funnel/parse/model libs + `run.mjs`/`bakeoff.mjs`/`realrun.mjs` + the embedding-gate experiments + pulled real July 9 transcripts (`realdata/`).

---

## 7. Open items / next steps (in priority order)

1. **Funnel `uniqueRatio` fix** (§3) — real-data-validated, one-line-ish, do first. Then re-run `sim/insights/realdata` to confirm the four repetition-loop false positives drop.
2. **Real noise markers + phrase-repetition + real foreign-string matching** in `fullScore`/`textStats` (the sim used a clean `(foreign language)` placeholder; real whisper emits `♪`, `(speaking/singing in foreign language)`, `[BLANK_AUDIO]`, `(crowd chattering)`, looped lines).
3. **`chrono-node`** to replace `parseDueAt` (dates), pure-JS, on-device.
4. **On-device model-quality pass** — run the real flow on a phone with a GGUF text model; confirm the grammar recipe holds on llama.rn (sim is a desktop/ollama proxy).
5. **Commitment gate** — port the sim's hybrid/kNN gate into the app reusing the shipped all-MiniLM + op-sqlite (optional; the LLM path is what ships today).
6. **LiteRT grammar** — wire `decoding_constraint` through `liblitertlm_jni` (separate agent; until then test on GGUF only).
7. **Recordings → op-sqlite** — recordings live in a zustand array persisted to AsyncStorage, which doesn't scale to a big day (import of a bloated export hung; fixed by leaning the export + O(N) dedup, but the real fix is SQLite, matching the RAG stack).
8. **Fine-tune gemma3-270m** (distilled) on our format — biggest quality lever, own project.

---

## 8. The sim harness + real-data method

`sim/insights/` — validate off-device before touching a phone. Uses **ollama** locally (`gemma3:270m`, `qwen2.5:0.5b`, `all-minilm`).
- `node generateDay.mjs` — build a synthetic realistic day from `fixtures/seeds_*.json`.
- `node run.mjs --model gemma3:270m --grammar` — funnel + LLM + scored against ground truth.
- `node classifier/bakeoff.mjs` — commitment-gate bake-off (regex vs embeddings/LR/hybrid/kNN vs LLM-gate).
- `node realrun.mjs <recordings.json>` — run the pipeline over REAL pulled data.

**Pulling real data off a release Android build** (run-as fails — not debuggable):
- Recordings are `rec-<startMs>.wav` (raw chunks) + `speech-rec-<start>-<rand>-<end>.wav` (finalized) in `/sdcard/Android/data/ai.offgridmobile/files/Music/Recordings/` (+ some in `/sdcard/Download/`), adb-pullable without run-as.
- Duration ≈ `bytes / 32000` s (16k mono 16-bit). Overnight = 115MB 1-hour idle chunks (skip).
- Transcribe with `whisper-cli` + `ggml-base.en.bin` (English-only, so foreign speech drops — this *matches* the app's behavior). base.en is a faithful-enough proxy for the app's on-device whisper.
- **Better path (faithful transcripts, no re-transcription):** the in-app **Export** (hub → Export) writes the app's own transcripts as JSON — but only exists on a build carrying this session's JS (a dev build). On a release build, audio-pull + whisper is the fallback.

---

## 9. Conventions (carry over)

- Pro code lives in the `pro/` submodule on its own stacked branch + PR. Nothing pro leaks into core `src/`/docs.
- **Never commit/push without explicit instruction.** "Build it" authorizes coding only. Co-author `Dishit Karia <hanmadishit74@gmail.com>`; no AI attribution.
- **Never auto-delete user data.** Trimming/compaction OK only with a verified backup.
- Design tokens (TYPOGRAPHY/COLORS/SPACING), weights ≤400, Feather icons, no emojis in UI. Brand voice: no em dashes, no curly quotes, no forbidden words.
- Reuse before building; design to abstractions (no backend-type branching in UI). `recordingsStore.ts` has a **500-line lint cap** — extract if you approach it.
- Prefer the simplest additive fix; feature-first, defer lint/test cleanup but never `--no-verify`.

---

*This doc lives in `docs/plans/`. Update it as things land. The insights pipeline is built and reload-testable; the next concrete action is the funnel `uniqueRatio` fix (§3, §7.1), validated by the real July 9 data in `sim/insights/realdata/`.*
