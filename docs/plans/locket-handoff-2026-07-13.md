# Locket handoff - 2026-07-13

Current state so a fresh agent can pick up. Supersedes the earlier
`locket-insights-handoff*.md` for anything that conflicts.

## TL;DR

- The Locket insights UI was redesigned and the recorder/pipeline work committed.
  All of it is pushed to two open PRs (below).
- Two PRs are up as **drafts**, each stacked onto the team's active branch. They
  are **divergent** (our branches were cut Jul 9; the targets moved on a lot), so
  they need a rebase/cherry-pick onto the current target tip before merge - the
  GitHub diff itself is clean (merge-base), but merging will conflict.
- Background auto-transcription is **OFF** (a deliberate demo-stability switch).
- Gitar code review: the fixable findings are addressed; one recorder finding is
  deferred (needs on-device validation).
- There is a known architecture gap ("context busy / context not found") with a
  recommended fix that is not yet built.

## PRs

| Repo | PR | Head branch | Base | Notes |
|---|---|---|---|---|
| off-grid-ai/mobile-pro (`offgridpro`) | #21 | `feat/continuous-smart-recorder` | `feat/locket` | pro submodule work |
| off-grid-ai/off-grid-ai-mobile (`upstream`) | #532 | `feat/vad-gated-recorder` | `feat/locket-pro` | app/core work + submodule bump |

Both are draft, stacked so that merging feeds the parent PRs (#11 pro / #433 core).
CodeRabbit skips both (non-default base / draft); **Gitar** is the reviewer that
produces findings.

## Repo / branch topology (important)

- Local `feat/vad-gated-recorder` (core) is behind `upstream/feat/locket-pro` by
  ~455 commits (that branch merged `dev`); local `feat/continuous-smart-recorder`
  (pro) is behind `offgridpro/feat/locket` by ~76.
- Our actual new work is small: ~9 commits (pro) and a handful (core). The rest of
  any raw two-dot diff is just us being behind.
- To land cleanly: cut a fresh branch from the current target tip, cherry-pick /
  rebase our commits onto it, resolve conflicts (locket files were touched on both
  sides), build + test, then update the PR. **Do pro first, then bump the core
  submodule to the pushed pro commit** (submodule ordering).
- `git rebase --abort` is your friend; nothing is merged.

## What was built this session

Insights UI (pro):
- Day-scoped Insights screen + shared `DayStrip` calendar (reused by the Days
  screen so there is one calendar, not two).
- Analysed-card schema: facts heading, "Analysed" tag + green rail, one-line
  summary, `N points / N to follow up` footer; per-recording Analyse/Transcribe
  CTAs; re-analyse beside the tick.
- Insight detail: reuses `AudioPlayerCard` docked at the bottom; tap a provenance
  line or transcript segment to seek + play inline; active segment highlights;
  summary streams in live; rename sets `recording.name`.
- Two-door home card: Insights (primary) + Recordings (secondary).
- Content-only insights prompts (the model was echoing the instructions);
  `insightLabel` never uses a raw transcript/key-point as a title.

Core:
- `transcriptSummarizer`: dynamic context sizing + token streaming + `abort()`.
- `litert.getContextTokens()`.
- `whisperStore`: delete falls back to another on-disk model (+ presentModelIds
  recompute).

## Demo-stability switch (revert after)

`pro/locket/services/transcriptionScheduler.ts`: `AUTO_TRANSCRIBE_ENABLED = false`.
Background auto-transcription is off, so Whisper only runs on an explicit tap.
Re-enable by flipping to `true` - **but do the inference-gate work first** (below),
or the "busy / not found" errors return.

## Gitar review status

Resolved:
- pro: "5 min" comment fixed to 60s; scheduler teardown (`stopTranscriptionScheduler`
  + kept handles).
- core: grammar-retry stale streaming accumulators reset (`llm.ts` +
  `llmToolGeneration.ts`, incl. `ToolCallTokenFilter.reset()`);
  `whisperStore.deleteModel` now drops the deleted model from `presentModelIds`.

Open / deferred:
- pro `ContinuousRecorderService.kt`: the checkpoint Silero scan runs on the
  AudioRecord read thread and can drop audio during a fully-silent window. Real.
  Deferred: move detection off the read thread (snapshot the tail, detect on a
  separate thread while the loop keeps draining), then validate by recording on a
  device. Not pushed pre-demo because a threading bug in the recorder core is
  worse than the occasional gap.

## Known architecture gap: "context busy / context not found"

Several uncoordinated actors reach for heavy native models: the background
transcription scheduler (Whisper), insights/summary (llama), chat (llama). Two
failure modes:
- **busy**: two callers hit the same context; the scheduler only checks the
  transcribe batch, not whether an LLM run is active.
- **not found**: loading Whisper calls `makeRoomFor`, which can evict the llama
  context while a generation is mid-flight.

Recommended fix (not built):
1. One shared serialized inference gate that all heavy model work (Whisper +
   llama) acquires - one job at a time, foreground preempts the background sweep.
   Extends the existing `modelResidencyManager.runExclusive` (today it only wraps
   load/unload, not the runs).
2. Guarded context lifecycle: never evict a context a live job holds.
3. Global Stop that halts the pipeline and pauses the scheduler.

Effort: lean version ~2-3 days (reuses `runExclusive`, plus on-device memory
testing); full priority-queue version ~4-6 days. On a phone only one heavy model
(Whisper ~0.3-0.5 GB peak, or the LLM ~0.8-1.2 GB) fits safely at once alongside
the RN baseline, so serialise execution even though the features stay separate.

## Open follow-ups (rough priority)

1. Inference-gate architecture above (unblocks re-enabling auto-transcription).
2. Recorder audio-dropout fix + on-device validation.
3. `speechCleanup.ts` is **stashed** (git stash) because it is 532 lines and fails
   the 500-line eslint rule; the committed version is 498. Decide: split the file
   or scope-disable the rule, then unstash.
4. Rebase/cherry-pick both PRs onto the current target tips for a mergeable diff.

## Gotchas

- `speechCleanup.ts` edits are in a git stash (`git -C pro stash list`), not in
  either PR.
- Pro pre-push lints all files (CI-equivalent); core pre-push runs tsc + full
  jest + an Android build. Both must pass - do not `--no-verify`.
- Submodule: push pro first, then bump the core submodule pointer to the pushed
  pro commit, then push core.
- CodeRabbit will not review these branches (base/draft policy); rely on Gitar.

## Key files

- Insights feed: `pro/locket/screens/LocketInsightsHubScreen.tsx`
- Insight detail: `pro/locket/screens/LocketInsightsScreen.tsx`
- Day list: `pro/locket/screens/LocketTodayScreen.tsx`; calendar: `pro/locket/ui/DayStrip.tsx`
- Insights pipeline + prompts: `pro/locket/services/recordingInsights.ts`
- Transcription scheduler: `pro/locket/services/transcriptionScheduler.ts`
- Recorder native: `pro/android/.../alwayson/ContinuousRecorderService.kt`
- Summarizer: `src/services/transcriptSummarizer.ts`; LLM: `src/services/llm.ts`, `src/services/llmToolGeneration.ts`
