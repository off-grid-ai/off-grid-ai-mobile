# Locket — LLM Insights & Auto-Summary Plan

Build plan for turning transcribed recordings into insights (title, summary, action items, entities) with an on-device LLM. Assumes the recorder + background transcription + ephemeral context + notifications are in place (see `locket-recorder-handoff.md`). LLM insight generation was deliberately deferred until now; this is that phase.

---

## 1. Goal

Turn each conversation from "a transcript" into something you can act on:
- a **title** (so the list reads like meanings, not "0:03"),
- a short **summary**,
- **action items** (and, when the user wants, real reminders / exported tasks),
- **entities** (people, topics, places) that link recordings into a graph.

All on-device by default. A user's own remote model server or an MCP tool is used only when they explicitly connect one.

---

## 2. Constraints (the shape of the solution)

- **The LLM can't run in true idle background** (iOS suspends the app when not recording; a multi-GB model is the first thing jetsammed). So insight generation runs **foreground**, or **while recording** (audio session keeps the app alive) with the memory gate, or is **offloaded to a remote server**.
- **Two models is the memory risk** (whisper + the chat/insight LLM). The existing `getAvailableMemory` gate sequences the heavy work rather than fighting.
- **Privacy:** transcripts/entities never leave the phone unless the user connects a remote server or MCP. This is the core difference from cloud recorders.
- **Small models are weak at strict structure** - keep LLM output loose (plain bullets), parse leniently; do deterministic extraction where possible.

---

## 3. The model

- **Tier:** ~0.8-1B, Q4 (Qwen ~0.8B or Llama 3.2 1B, ~0.5-0.9 GB). Good enough for title + summary + loose action items. Do **not** rely on sub-0.5B for summaries (generic / hallucinates on messy transcripts).
- **Reuse the loaded chat model when present** - many users already have one, so no extra download. Offer the small dedicated model only for users who don't.
- **Router order:** on-device model loaded -> use it; else a reachable remote model server (Off Grid gateway, `/props` detection) -> offload; else prompt to download; else **extractive fallback** (Tier 0) so the list is still labelled with no model at all.

---

## 4. Architecture — tiers + triggers

**Tier 0 — extractive, no LLM, always-on (free):** as a clip is transcribed, derive cheaply:
- **title** = first sentence / top keyword phrases,
- **action items** = trigger phrases + time/date regex ("remind me", "call", "by Friday", "4pm"),
- already indexed for search.
Makes the catalogue useful immediately, even with no model.

**Tier 1 — LLM insights, on the notification -> CTA path:**
- per-conversation **clean title + summary + action items**,
- a **daily digest** (one LLM pass over the day's transcripts),
- reuses `transcriptSummarizer`.

**Tier 2 — entities + knowledge graph (later in this phase):**
- people (matched to contacts), topics, places -> link recordings; power person/topic/place views + ask-across (`recordingKb`).

**Trigger model (locked earlier):** do NOT run the LLM eagerly in the background. Instead:
```
conversation/meeting ends (or time-of-day digest) -> local notification
   -> user taps CTA -> app foreground -> generate insights (on-device or remote) -> cache -> show
```
"Opportunistic silent generation" (small model during recording / while charging) is a later upgrade toward the "insights already there when you open the app" feel - not MVP.

---

## 5. Generation pipeline (per conversation)

Input: the recording's transcript (+ segments, + calendar/context metadata).
1. **Gate (cheap):** skip trivia - only summarize clips with enough speech (reuse the brief/`briefMaxMs` idea, or a tiny importance classifier). Trivial clips get a Tier-0 title only.
2. **Prompt the model** for a compact, loose-structured result:
   - Title: one line.
   - Summary: 2-4 sentences.
   - Action items: plain bullets ("- <who> <what> <when?>"), empty if none.
   - (Optional) decisions / questions.
   Keep it ONE prompt returning labelled sections; parse leniently (no strict JSON).
3. **Merge with Tier-0 extraction** (regex action items / entities) so detection is not purely model-dependent.
4. **Cache** onto the recording; never regenerate.

Daily digest = same, but the input is the day's concatenated transcripts and the output is a recap + the day's action items.

---

## 6. Router + fallback (detail)

```
generateInsights(recording):
  if on-device text model loaded:      run transcriptSummarizer on-device
  elif remote gateway reachable:       offload (POST transcript, get summary back)   [opt-in, user server only]
  elif a model can be downloaded:      surface "download a model for insights"
  else:                                Tier-0 extractive title + regex action items
```
Foreground only for the on-device branch (or during recording + memory-ok). Remote branch is fine backgrounded (it's a network call). Always cache the result.

---

## 7. Data model additions (`Recording`)

```
summary?: string;
summaryStatus?: 'idle' | 'running' | 'done' | 'error';   // already partially present
title?: string;               // AI or extractive
actionItems?: { text: string; done?: boolean; dueAt?: number }[];
entities?: { people?: string[]; topics?: string[]; places?: string[] };
insightsSource?: 'extractive' | 'on-device' | 'remote';
insightsAt?: number;
```
(`summary`/`summaryStatus` already exist; add the rest.) Persisted; cache-once.

---

## 8. Entities & knowledge graph (Tier 2)

- Extract people / orgs / topics / places from the transcript (small LLM or NER); match **people -> contacts** and **places -> the captured location**.
- Store on `recording.entities`; build an index so the UI can offer **person / topic / place views** and sharpen **ask-across** (`recordingKb`).
- All on-device.

---

## 9. Actions layer

- **On-device:** action items -> real reminders / calendar events via `react-native-add-calendar-event` (already a dep).
- **MCP (opt-in):** push an action item / summary to the user's connected tools (Notion for notes/DB, Linear/Jira for tickets, Slack for recaps). External, so explicit opt-in only. Start with Notion + one task tool.

---

## 10. Reuse map (little new inference code)

| Need | Reuse |
|---|---|
| LLM summary | `@offgrid/core/services` `transcriptSummarizer` |
| Ask-across / RAG | `recordingKb` |
| Notifications | `@notifee/react-native` (meeting reminders pattern) |
| Remote model detection | Off Grid gateway `/props` reader |
| Batch/queue pattern | store `startBatchTranscribe` (mirror for insights) |
| Memory gate | `continuousRecorderService.getAvailableMemory` |
| Reminders | `react-native-add-calendar-event` |
| Contacts / location (for entities) | needs geo/contacts deps (see handoff) |

---

## 11. Build steps (MVP first)

1. **Tier-0 extractive** (no model): title from transcript + regex action items, on transcribe-complete. Immediate payoff, works with zero model. Cache on the recording.
2. **`generateInsights(recording)`** service: reuse `transcriptSummarizer`; one loose-structured prompt -> title + summary + action items; merge with Tier-0; cache. Foreground.
3. **Router**: on-device -> remote -> download-prompt -> extractive fallback.
4. **Notification -> CTA wiring**: conversation/meeting-end (substantial, batched) + optional time-of-day digest; tap runs step 2 in foreground; deep-link to the recording.
5. **Surface**: show title/summary/action-items on the recording detail + use the title in the Today/Days lists.
6. **Actions**: action items -> "add reminder" (on-device); then MCP export (Notion + a task tool), opt-in.
7. **Tier 2 entities + graph** (people/topics/places -> views + ask-across).
8. **Later:** opportunistic silent generation (small model during recording / charging) for the "already there when you open" feel.

MVP = steps 1-5 (extractive baseline + on-device/remote summary via the notification CTA, shown in the list). Actions + entities + opportunistic layer follow.

---

## 12. Testing

- **Tier-0** (no model): transcribe a clip, confirm a keyword title + any regex action items appear with no model loaded.
- **On-device path:** with a text model loaded, tap the CTA -> title/summary/actions generated and cached; second tap is instant (cached).
- **Remote path:** with a reachable gateway, confirm offload + result; with none, confirm the download prompt.
- **Gate:** trivial clip -> Tier-0 title only, no LLM run; low memory / low power -> deferred (reuse the scheduler gate logs).
- **Notification:** conversation end -> notification -> tap -> insight flow runs.

---

## 13. Open decisions (figuring out)

- Which small model to bundle/recommend (Qwen ~0.8B vs Llama 3.2 1B) - verify exact GGUF sizes + quality on real transcripts.
- Daily digest vs per-conversation as the default surfaced unit (probably both: per-conversation title always, digest as the notification).
- How aggressive the "important?" gate is (what gets a full summary vs a title only).
- Whether/when to add the opportunistic silent-generation layer (needs the during-recording small-model + charging gate).
- MCP set: which servers to offer first (leaning Notion + Linear/Todoist).

---

## 14. Guardrails (carry over)

- Foreground (or during-recording + memory-ok) for on-device LLM; never a big LLM in idle background.
- Loose output, lenient parse; deterministic extraction where possible.
- Cache once; never regenerate.
- On-device by default; remote/MCP only on explicit user connect.
- Graceful with no model (extractive), and never block the recorder's hot path.
- No auto-delete; insights are additive metadata on the recording.

---

*Lives in `docs/plans/` (local). Pairs with `locket-recorder-handoff.md`. Ship MVP (steps 1-5) first; entities, actions, and opportunistic generation are the next slices of the same phase.*
