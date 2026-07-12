# Locket Insights - Session Handoff v2 (current)

Handoff for the next agent on the **Locket on-device insights pipeline** (importance scoring -> transcription -> LLM summary / key points / action items) in Off Grid Mobile AI. This is the current, authoritative handoff. It supersedes `locket-insights-handoff.md` (v1), which still holds the deep algorithm detail and the sim/real-data method - read v1 for those, this doc for the current shape, the UX + reliability layer built this session, the file map, open items, and the conventions to keep in mind when building features here.

Read alongside: `locket-insights-handoff.md` (v1: algorithm depth, sim harness, real-data method), `locket-insights-screen-plan.md`, `locket-recorder-handoff.md`, `combined-intelligence-layer-plan.md`.

> Open-core layout: public `@offgrid/core` lives in `src/`; the private **`pro`** submodule holds the recorder + insights feature (`pro/locket/...`). Core exposes registries/slots + shared services; pro plugs in. Everything below is in `pro/locket/` unless the path says `src/`.

---

## 1. TL;DR - current state

- The pipeline works and is **more usable** as of this session: insights **stream token-by-token** into the card as the model writes them, you can **play the exact source moment inline**, Regenerate **takes over the model** instead of failing "busy", and it **loads a model itself** when none is resident.
- Pipeline shape (unchanged core): **free importance funnel -> (transcribe) -> extractive floor -> grammar-forced LLM one-pass (title/summary/key points/actions) -> merge with regex extractive -> precision filter -> cache.** Higher-importance clips first (priority queue).
- Importance scoring is **pure heuristics, no model, ~15us/clip**; it gates (skip junk) and orders (priority).
- Insights run on **whatever text backend is active** (local llama.rn, LiteRT, or a remote provider) via `transcriptSummarizer`. There is no separate "insights model".
- **Everything this session is JS/TS**, reload-testable on a dev build. No native changes.
- Validated earlier on real July 9 data (see v1). Known-open funnel bug (repetition-loop clips pass) is documented in v1 and still open.

---

## 2. The pipeline as built

`pro/locket/services/recordingInsights.ts` -> `generateInsights(recordingId)`:

1. **Extractive floor first** (`recordingInsightsExtractive.ts`): regex trigger-lexicon action items + due-time parse. Writes `title` + `actionItems` immediately, marks `insightsSource: 'extractive'`. Works with no model.
2. **Backend check**: if `!transcriptSummarizer.isBackendReady()` -> throw `SummaryModelMissingError` (the extractive floor is already saved; UI turns this into a load/download path - see section 4).
3. **Busy check**: if the single model context is already generating -> throw `InsightsBusyError` (see section 4).
4. **One grammar-forced pass**, streamed: `transcriptSummarizer.summarize(input, { systemPrompt: RECORDING_INSIGHTS_PROMPT, combinePrompt: RECORDING_INSIGHTS_COMBINE_PROMPT, grammar: RECORDING_INSIGHTS_GBNF, repeatPenalty: 1.3, onProgress, onToken })` -> `TITLE / SUMMARY / KEY POINTS / ACTIONS`.
5. **Parse leniently** (`parseInsights`), **merge** LLM actions with the extractive set, **precision filter** (`refineActionItems`), **attribute provenance** (`withSources`: best-match source sentence + `sourceStartMs` for tap-to-play), cache with `insightsSource: 'on-device'`, `insightsAt`, `keyPoints`, `summaryStatus: 'done'`.

- **repeat_penalty 1.3** is applied on the final/single pass only; without it small models loop on noisy transcripts.
- **Grammar (GBNF)** is llama.rn only. LiteRT/remote ignore it (constrained decoding is possible on LiteRT via `decoding_constraint` but not wired - see v1 section 5). On remote, format rides on the prompt; `parseInsights` is lenient enough.
- **Priority-queue processor** `runInsightsQueue(cb, includeAll, scopeIds)`: filters `needsPass` (never analyzed, or extractive-only) and worth-LLM (unless `includeAll`), sorts by `priorityRank`, runs `generateInsights` one at a time, resumable + cancellable, skips `imported` clips. Owned by `recordingsStore.startInsightsProcessing` / `stopInsightsProcessing`; progress in `insightsBatch {running,done,total,currentId,approxTokens}`.

---

## 3. The UX layer (built this session)

### Streaming (copied from the detail-screen summary)
`generateInsights` streams like `recordingSummary.summarizeRecording`: a `makeInsightsStreamer(recordingId)` helper threads `onToken`/`onProgress` into `summarize`, writes the partial `summary` to the store on a 60ms throttle (`STREAM_FLUSH_MS`), and shows `Reading part X of N` headers on multi-part clips. A `streamPreview()` strips the grammar's `TITLE:`/`ACTIONS:` scaffolding and `SUMMARY:`/`KEY POINTS:` labels on the fly so the card shows readable prose while generating; the final `parseInsights` still gets the raw text. **Reuse pattern:** when a feature needs live output, copy this streamer shape rather than awaiting the whole result.

### Inline playback (detail screen)
`LocketInsightsScreen.tsx` mounts the shared `useRecordingPlayer(recording.path)` hook (same one `LocketPlayerScreen` uses - do not build a second player). A compact transport bar (play/pause + progress + `mm:ss / mm:ss`) sits above the summary. Tapping an action item's `from: "..."` provenance snippet calls `player.seek(sourceStartMs)` + plays **in place** (no navigation). The hook mutes the always-on recorder during playback to avoid feedback.

### Screens
- **Hub** `LocketInsightsHubScreen.tsx`: priority-ordered pass, day-scoping (`route.params.day` + scope chip), worth-LLM primary list, collapsible "Low-signal / other" section, transcribe-then-analyze, live status card with a 1-indexed `Analyzing N of M` counter + `reading part X of Y` phase, per-clip `analyzing...` marker, Stop button, Export/Import with loaders, `imported` tags.
- **Detail** `LocketInsightsScreen.tsx`: summary -> key points -> action items (checkbox, due date, provenance tap-to-play, reminder bell), Regenerate, inline player, model-load handling.
- **Today** `LocketTodayScreen.tsx`: dev score labels (`__DEV__`), `imported` tags, per-clip processing spinner, lightning icon -> hub scoped to that day, resumable transcribe button.

---

## 4. Model lifecycle + reliability (built this session)

The hard lesson: there is **one native llama context with a single `isGenerating` flag**. Only one generation runs at a time. Whisper transcription is a separate engine and does **not** hold this lock; the insights batch, chat, and the detail-screen run all do.

- **Regenerate preempts** (`runGenerate(false)` in the detail screen): stops any running batch (`stopInsightsProcessing`), calls `transcriptSummarizer.abort()`, then runs. It **takes over** instead of showing "busy". Auto-run (`runGenerate(true)` on screen entry) does **not** preempt - it defers to the batch.
- **`transcriptSummarizer.abort()`** (core, new): calls `llmService.stopGeneration()` (`stopCompletion`) and clears `_isSummarizing`. This interrupts a real in-flight generation **and** clears a wedged `isGenerating` flag. The hub Stop button now calls it too, so Stop frees the lock immediately (previously it only skipped the next clip while the current one kept the lock).
- **Auto-load a model** (`ensureModelLoaded` in the detail screen): when no backend is ready on a manual tap, it loads the selected model (`useAppStore.activeModelId`) or the first downloaded text model via `activeModelService.loadTextModel` (the one canonical load gateway - handles residency/eviction/memory), showing a "Loading model..." state. It only falls back to the download prompt when nothing is downloaded.
- **Auto-run suppressed while busy**: opening a recording mid-batch logs and defers instead of colliding.
- **Diagnostic logging** (visible in the Debug Logs screen): `[insightsQueue] start / clip i/N / cancelled`, `[TranscriptSummarizer] abort requested (isSummarizing=…, llmGenerating=…)`, `[recordingInsights] model busy (isSummarizing=…, llmGenerating=…)`, `starting LLM pass`, `LLM pass failed: <name>: <msg>`, `[LocketInsights] generate <id> (auto=…) / done / failed / auto-loading model <id>`.
- **Known root cause not yet fixed**: `isGenerating` can wedge `true` if a generation is orphaned (unmount/navigation bypassing the `finally` in `generateWithMaxTokens`). Regenerate's preempt force-clears it (the symptom cure). The root fix (reset the flag on context teardown / callback teardown so chat and the batch also self-heal) is open - see section 6.

---

## 5. Persistence + resumability (analyzed; part built)

- `recordings[]` is persisted to AsyncStorage (`continuous-recordings-storage`); each clip carries its own `insightsAt`/`insightsSource`/`summary`/`keyPoints`/`actionItems`. **There is no separate queue object.**
- On app kill: the batch does **not** auto-resume (by the user's decision - keep it manual). But nothing done is redone: the next run recomputes `targets` and skips `insightsSource === 'on-device'` clips. Order is deterministic (`priorityRank`), so it continues the remaining backlog in the same order.
- The finest resumable unit today is **one whole clip**. A clip killed mid-generation has its `summaryStatus` reset from `running` to `error` on rehydrate and its partial `summary` dropped (matches the detail-screen summary), so it restarts from scratch.
- **Designed, not built** (agreed direction): part-level checkpointing so a long clip resumes from its last finished map-part. Plan: extend `transcriptSummarizer.summarize` with `resumeParts?: string[]` + `onPart?(index,total,text)` (additive, defaults keep chat unchanged); persist finished parts on the recording (`insightsParts`, `insightsPartsTotal`); discard on chunk-count mismatch (model changed). Plus an optional `failed` terminal state so a persistently-failing clip stops retrying every run.

---

## 6. Open items (priority order)

1. **Funnel `uniqueRatio` fix** (v1 section 3) - real-data-validated, still open. Repetition-loop clips wrongly pass.
2. **Part-level checkpoint + `failed` terminal state** (section 5) - agreed, not built.
3. **Harden `generateWithMaxTokens` so `isGenerating` can never wedge** (section 4) - reset the flag on context unload / callback teardown, so chat and the batch self-heal, not just Regenerate.
4. **Insights-forward hub** - render summary + key points + top actions inline on the hub (streaming) so a user never has to tap in; move dev chrome (scores, counts, transcribe/analyze) behind a `__DEV__` toggle. Add the inline player to the hub too.
5. Real noise markers + phrase-repetition + real foreign-string matching in `fullScore`/`textStats` (v1).
6. `chrono-node` for dates; commitment gate via the shipped all-MiniLM + op-sqlite; LiteRT grammar via `decoding_constraint`; recordings -> op-sqlite; fine-tune the small model (all in v1 section 7).

---

## 7. File map (this session's touches in bold)

| File | What |
|---|---|
| `services/recordingInsights.ts` | `generateInsights` (**streaming**, **busy guard**, `InsightsBusyError`, `makeInsightsStreamer`, `streamPreview`), `runInsightsQueue` (**queue logs**), GBNF prompts |
| `services/recordingInsightsExtractive.ts` | Tier-0 title + regex actions + due parse + `refineActionItems` |
| `services/recordingSummary.ts` | The reference streaming impl (`summarizeRecording`) + `SummaryModelMissingError` |
| `services/recordingPlayer.ts` | Shared single-track player hook (`useRecordingPlayer`, `seek`) - reused by insights detail |
| `utils/recordingImportance.ts` | `preScore`/`fullScore`/`classifyImportance`/`priorityRank` |
| `stores/recordingsStore.ts` | `insights*` state + `start/stopInsightsProcessing`, rehydrate reset of stuck `running`. **500-line lint cap - at the cap; extract, do not add lines** |
| `stores/recordingTypes.ts` | `Recording` type + `keyPoints`/`imported`/reset constants |
| `screens/LocketInsightsScreen.tsx` | **Streaming render, inline player, Regenerate preempt, auto-load model, logging** |
| `screens/LocketInsightsHubScreen.tsx` | **Stop aborts in-flight (`stopBatch`), logs** + day-scoping, buckets, status card |
| `screens/LocketTodayScreen.tsx` | Dev score labels, hub entry, resumable transcribe |
| `src/services/transcriptSummarizer.ts` (core) | Optional `grammar`/`repeatPenalty`, `onToken`/`onProgress`, **`abort()`** |
| `src/services/llm.ts` (core) | `generateWithMaxTokens` grammar + `repeatPenalty`; single `isGenerating` lock; `stopGeneration` |
| `src/services/llmHelpers.ts` (core) | iOS Metal <4GB offload cap removed |

Sim harness `sim/insights/` (dev-only, not shipped) - see v1 section 8 for how to run it and how real July 9 data was pulled.

---

## 8. How we build features + UX here (conventions to keep in mind)

**Reuse before building.** Before a new component/hook/service, grep for one that exists. This session reused the summary streamer, the player hook, and `activeModelService`; it did not fork any of them. Two screens showing the same thing must use the same component.

**Design to abstractions (SOLID).** UI/stores never branch on a concrete backend (`if engine === 'kokoro'`). Insights depend on `transcriptSummarizer` / `activeModelService`, which dispatch to local/LiteRT/remote. Adding a backend must need zero UI changes.

**Design system.** `TYPOGRAPHY`/`COLORS`/`SPACING` tokens only - never hardcode sizes/colors/spacing. Weights <=400 (no bold). Icons via `react-native-vector-icons` (Feather default; MaterialIcons only when Feather lacks one). No emojis in UI. Read `docs/design/VISUAL_HIERARCHY_STANDARD.md`.

**Brand voice** (applies to docs + UI strings): no em dashes, no curly quotes, no exclamation marks, no forbidden words (revolutionary, seamlessly, leverage, robust, comprehensive, crucial, delve, showcase, enhance, and the rest). Proof over adjectives. Read `docs/brand_tone_voice.md`.

**One model lock.** Any feature that generates shares the single native context. Check `transcriptSummarizer.isSummarizing` / `llmService.isCurrentlyGenerating()` before generating, or preempt with `transcriptSummarizer.abort()`. Do not raise thread counts to fix latency - not a lever here.

**Never auto-delete user data.** Recordings/transcripts/downloads: surface the problem, let the user decide. No silent eviction.

**Streaming + loaders.** Long on-device work must show progress (stream tokens, phase text, per-item counters), never a frozen spinner. Users need to see what is happening.

**Log for diagnosis.** On-device failures are invisible without logs. Log start/done/fail with the real error name+message; the Debug Logs screen surfaces them. Silent re-throws waste debugging sessions (this session's "model busy" bug was one).

**Process discipline.** Pro code stays in the `pro/` submodule on its own stacked branch + PR; nothing pro leaks into core `src/`/docs. Never commit or push without explicit instruction - "build it" authorizes coding only, commit and push each need a separate go. Co-author `Dishit Karia <hanmadishit74@gmail.com>`; no AI attribution. Prefer the simplest additive fix; feature-first, defer lint/test cleanup but never `--no-verify`. Quality gates: `npm run lint && npx tsc --noEmit && npm test`.

---

*This doc lives in `docs/plans/`. Update it as things land. v1 (`locket-insights-handoff.md`) remains the algorithm + sim reference. Current next action: the funnel `uniqueRatio` fix (v1) and part-level checkpointing (section 5), whichever the user prioritizes.*
