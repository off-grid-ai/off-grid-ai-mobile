# Locket — Insights Screen + Triggers (Implementation Plan)

Detailed, execution-ready plan for the **Insights view** (title + summary + action items) and its three trigger phases: **(1) manual button**, then **(2) notification CTA**, then **(3) auto / opportunistic**. Written so another agent can build it directly.

Read first: `locket-llm-insights-plan.md` (strategy) and `locket-recorder-handoff.md` (state + conventions). This doc is the concrete build.

---

## 0. What already exists (don't rebuild)

- `pro/locket/services/recordingSummary.ts` → `summarizeRecording(recordingId)`: reuses core `transcriptSummarizer`, streams a summary, writes `recording.summary` + `summaryStatus` ('running'|'done'|'error'). Throws `SummaryModelMissingError` if the text backend isn't ready. Exposes `RECORDING_SUMMARY_PROMPT`, `RECORDING_COMBINE_PROMPT`.
- `pro/locket/screens/LocketPlayerScreen.tsx`: has `handleSummarize` + a Summarize action + progress phase label (`summaryPhaseLabel`) + `isSummarizing`, and renders the summary (MarkdownText).
- `recording.summary`, `recording.summaryStatus` fields exist.
- `recorderNotifications.ts`: posts a "captured" nudge (no CTA behaviour yet).
- Reusable: `transcriptSummarizer` (LLM), `recordingKb` (RAG), `@notifee/react-native`, `react-native-add-calendar-event`, remote gateway `/props` detection, `continuousRecorderService.getAvailableMemory` (memory gate), the batch-queue pattern in `recordingsStore`.

So the summary primitive is built. This plan (a) extends it to full **insights** (title + summary + action items), (b) adds a **dedicated Insights view**, and (c) wires the three triggers.

---

## 1. Data model additions (`pro/locket/stores/recordingsStore.ts`, `Recording`)

`summary` + `summaryStatus` already exist. Add:
```ts
title?: string;                       // AI or extractive
actionItems?: {
  id: string;
  text: string;
  done?: boolean;
  dueAt?: number;                     // epoch ms if a time was parsed
  reminderId?: string;               // set once exported to a reminder
}[];
insightsSource?: 'extractive' | 'on-device' | 'remote';
insightsAt?: number;
```
Add a `setActionItemDone(recordingId, itemId, done)` action (mutates `actionItems[i].done`) and a `setInsights(recordingId, patch)` helper, or just reuse `updateRecording`. Keep the file under the 500-line lint cap (extract if needed).

---

## 2. Generation service — extend to `generateInsights`

New export in `recordingSummary.ts` (or a sibling `recordingInsights.ts`) that produces **title + summary + action items in one pass**, reusing `transcriptSummarizer`.

**Contract:** `generateInsights(recordingId): Promise<void>` — writes `title`, `summary`, `actionItems`, `insightsSource`, `insightsAt`, `summaryStatus`.

**Prompt:** one prompt asking for loose, labelled sections (do NOT demand strict JSON — small models fail it):
```
TITLE: <one short line>
SUMMARY: <2-4 sentences>
ACTIONS:
- <who> <what> <when?>   (or "none")
```
Parse leniently by section header; tolerate missing sections. Reuse `RECORDING_SUMMARY_PROMPT` style + `NO_PREAMBLE_WITH_HEADINGS`.

**Model readiness / loading:**
- If `transcriptSummarizer.isBackendReady()` → run on-device.
- Else, per the router (§7): try auto-load, else remote, else throw `SummaryModelMissingError` (UI prompts).
- Merge the parsed action items with the **Tier-0 extractive** action items (§6) so detection isn't purely model-dependent.
- Throttle store writes while streaming (the existing summary code already does this).

Keep `summarizeRecording` working (summary-only) or make it call `generateInsights` internally.

---

## 3. The Insights view

**Decision:** a dedicated screen `LocketInsightsScreen` (param `{ recordingId }`), reachable from (a) the recording detail, (b) the day timeline, (c) the notification CTA. (An inline section in `LocketPlayerScreen` is the fallback if a separate screen feels heavy, but a screen is cleaner for the notification deep-link.)

**Register:** `registerScreen({ name: 'LocketInsights', component: LocketInsightsScreen })` in `index.ts`; add `LocketInsights: { recordingId: string }` to `navigation.ts` `LocketStackParamList`.

**UI (design tokens only, weights <=400, Feather icons, no emojis):**
- **Header:** back + recording title/time.
- **Title** (AI/extractive) as the screen heading.
- **Summary** block (`MarkdownText`), or an empty state.
- **Action items**: a checklist. Each row: checkbox (toggles `done` via store), text, optional due time, and an "add reminder" affordance (§8).
- **States:**
  - no transcript yet → "Transcribe first" (link to transcribe / it may be auto-transcribing),
  - no model → "Enable a model to generate insights" (download/enable CTA),
  - generating → spinner + `summaryPhaseLabel` phase text,
  - done → title/summary/actions,
  - error → retry.
- **Regenerate** button (re-run `generateInsights`).

Reuse `CenteredAlert`, `MarkdownText`, the summary phase label, and the existing summary rendering styles from `LocketPlayerScreen`.

---

## 4. Phase 1 — manual button (build first)

- Add a **"Get insights"** button on the recording detail (`LocketPlayerScreen`) and/or the Insights screen → calls `generateInsights(recording.id)`.
- On `SummaryModelMissingError` → show the enable/download prompt (reuse the existing summary model-missing handling).
- Show progress (reuse `isSummarizing` / `summaryPhaseLabel`), then render on the Insights view.
- This is the whole loop working end-to-end, manually. Ship this first.

---

## 5. Phase 2 — notification CTA

Turn the "captured" nudge into an insights trigger.

- **`recorderNotifications.ts`**: put `{ type: 'recorder-insights', recordingId }` in the notification `data`, and set the body/CTA to "Tap for summary + action items."
- **notifee event handler** (register once, e.g. in `activateLocket` or app bootstrap): `notifee.onForegroundEvent` + `onBackgroundEvent`. On `PRESS` with `type === 'recorder-insights'`:
  1. Navigate to `LocketInsights` with the `recordingId` (needs a navigation ref / the app's deep-link/navigation mechanism — check how existing notifications/deep-links navigate).
  2. Kick `generateInsights(recordingId)` in the foreground (auto-load the model per §7).
- The Insights screen should, on mount, auto-run generation if the recording has a transcript but no insights yet (so the CTA "just works").
- **Router applies** (§7): on-device auto-load, else remote, else prompt.

---

## 6. Tier-0 extractive (no model) — supports all phases

A small util `recordingInsightsExtractive.ts`:
- **Title:** first sentence of the transcript, or top keyword phrases.
- **Action items:** regex + trigger lexicon ("remind me", "don't forget", "call", "buy", "send", "follow up") + date/time parsing ("4pm", "tomorrow", "by Friday") → `actionItems`.
Run it right after transcription completes (immediate, no model), writing `title` + `actionItems` with `insightsSource: 'extractive'`. The LLM pass later upgrades them (merge, don't duplicate). This makes the Insights view useful even with no model and is the fallback in the router.

---

## 7. Router (used by generateInsights + the CTA)

```
generateInsights(recordingId):
  if transcriptSummarizer.isBackendReady():        run on-device
  elif <can auto-load an on-device text model>:    load (spinner), then run on-device
  elif <remote gateway reachable (/props)>:        offload transcript, get insights back   [opt-in server only]
  elif <a model is downloadable>:                  throw SummaryModelMissingError -> UI prompt
  else:                                            Tier-0 extractive only
  always: cache result on the recording
```
On-device/auto-load branches are foreground (or during-recording + memory-ok via `getAvailableMemory`). Remote branch may run backgrounded (network call).

---

## 8. Action items -> actions

- Render `actionItems` as a checklist on the Insights view; toggling writes `done` to the store.
- **"Add reminder"** per item → `react-native-add-calendar-event` (already a dep); store the created `reminderId`.
- **Later:** MCP export (Notion / Linear / Todoist), opt-in, behind the user's connected servers.

---

## 9. Phase 3 — auto / opportunistic (last)

- After transcription: run **Tier-0** immediately (title + action items, no model).
- **Opportunistic LLM insights**: an `insightsScheduler.ts` mirroring `transcriptionScheduler.ts` — when conditions are good (foreground / charging / during-recording) and memory-ok (`getAvailableMemory`) and the clip is **substantial** (importance gate), run `generateInsights` on the backlog, one at a time, cached. Optionally a **daily digest** (one LLM pass over the day's transcripts).
- Result: insights are "already there when you open the app"; the notification becomes a nudge for high-value items (a detected action item, a meeting recap), not a "tap to compute."

---

## 10. File-by-file summary

| File | Change |
|---|---|
| `stores/recordingsStore.ts` | add `title`, `actionItems`, `insightsSource`, `insightsAt`; `setActionItemDone`; keep < 500 lines |
| `services/recordingSummary.ts` (or new `recordingInsights.ts`) | `generateInsights` (title + summary + actions, loose parse) + router |
| `services/recordingInsightsExtractive.ts` (new) | Tier-0 title + regex action items |
| `screens/LocketInsightsScreen.tsx` (new) | the Insights view (states, checklist, regenerate) |
| `index.ts` / `navigation.ts` | register `LocketInsights` + param type |
| `screens/LocketPlayerScreen.tsx` | "Get insights" button → generate + link to the view |
| `services/recorderNotifications.ts` | CTA data + body |
| bootstrap (`index.ts` or app) | notifee press handler → navigate + generate |
| `services/insightsScheduler.ts` (new, Phase 3) | opportunistic generation, gated + batched |
| `__tests__/unit/locket/…` | parse-insights (loose sections), extractive action-item regex |

---

## 11. Testing

- **Extractive (no model):** transcript with "remind me to call Sam at 4" → title + one action item, no model loaded.
- **Manual (Phase 1):** model loaded → button → title/summary/actions render + cache; second open is instant.
- **Model missing:** button → enable/download prompt (no crash).
- **Notification (Phase 2):** conversation end → notification → tap → lands on Insights view + auto-generates.
- **Action item → reminder:** tap add → reminder created; `reminderId` stored.
- **Gate (Phase 3):** trivial clip → extractive only; low memory/power → deferred.

---

## 12. Guardrails (carry over)

- Loose LLM output, lenient parse; merge with deterministic extraction.
- On-device LLM only foreground / during-recording + memory-ok; never a big LLM in idle background.
- Cache once (`insightsAt`); never regenerate unless the user taps Regenerate.
- On-device by default; remote / MCP only on explicit connect.
- Graceful with no model (extractive); never block the recorder hot path.
- Design tokens, weights <=400, Feather icons, no emojis; brand voice in any copy.
- No auto-delete; insights are additive metadata.

---

## 13. Open decisions (for the implementer to confirm)

- Dedicated `LocketInsightsScreen` vs an inline "Insights" section in `LocketPlayerScreen` (this plan assumes a screen for the notification deep-link; confirm).
- Auto-load the model on the CTA vs prompt-only (this plan: auto-load with spinner, prompt as fallback).
- Exact small model to bundle/recommend (Qwen ~0.8B vs Llama 3.2 1B) — verify on real transcripts.
- Daily digest vs per-conversation as the surfaced unit (plan: per-conversation insights + digest as the notification).

---

*Build order: Phase 1 (manual, incl. data model + generateInsights + Insights screen + extractive Tier-0) -> Phase 2 (notification CTA) -> Phase 3 (opportunistic). Ship Phase 1 first; it is the whole value loop working by hand.*
