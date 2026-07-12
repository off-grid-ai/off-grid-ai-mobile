# Locket Insights - Commit Plan

Plan only. Nothing is committed or staged by this doc. Execute only on explicit "commit it".

## Decisions locked in
- Gitignore the private real data + debug screenshots (never commit).
- Grouped commits directly on the current branches (no new stacked branches).
- Commit only app code + tests. Sim harness stays out of git. Docs/plans stay untracked (kept on disk, not committed).
- Every commit: `Co-Authored-By: Dishit Karia <hanmadishit74@gmail.com>`. No AI attribution.
- Quality gates run on commit (lint/tsc/test per staged type). If a native hook is env-broken, pause and report - do not `--no-verify` without asking.

## Repos + branches
- Pro submodule: `pro/` on `feat/locket-insights`.
- Parent: root on `feat/vad-gated-recorder`.
- Order: commit inside `pro/` first, then bump the `pro` pointer in the parent (existing "bump pro submodule" flow).

---

## Step 0 - .gitignore (excludes, not a commit)
Add to the parent `.gitignore`:
```
# Dev-only sim harness + private real recordings (never commit)
/sim/
# Debug screenshots (scratch)
/image.png
/image-*.png
```
`/sim/` also covers `sim/insights/realdata/` (~178MB of real July 9 transcripts + audio).

## Do NOT commit
| Item | Reason |
|---|---|
| `sim/insights/realdata/` | Private real transcripts + audio, ~178MB |
| `sim/insights/**` (rest) | Dev-only harness, not app code |
| `image.png`, `image-1..4.png` | Debug screenshots |
| `docs/plans/*.md`, `redesing.md`, this file | Docs, not app code - left untracked, decide later |

---

## Step 1 - PRO (`pro/`, `feat/locket-insights`)

**A. `feat(locket): on-device insights pipeline + hub/detail screens`**
- New: `locket/services/recordingInsights.ts`, `recordingInsightsExtractive.ts`, `recordingExport.ts`, `actionItemReminders.ts`, `recordingContext.ts`
- New: `locket/utils/recordingImportance.ts`, `locket/stores/recordingTypes.ts`
- New: `locket/screens/LocketInsightsScreen.tsx`, `LocketInsightsHubScreen.tsx`
- Modified: `locket/stores/recordingsStore.ts`, `locket/navigation.ts`, `locket/index.ts`, `locket/screens/LocketPlayerScreen.tsx`, `LocketTodayScreen.tsx`

**B. `feat(locket): stream insights live + preempt/auto-load model on regenerate`**
- Streaming + abort + auto-load hunks in `LocketInsightsScreen.tsx` and `LocketInsightsHubScreen.tsx`
- Note: pairs with the core `transcriptSummarizer.abort()` in the parent (Step 2, commit 1).
- If hunk-splitting from commit A is fussy, fold B into A as one "insights feature" commit.

**C. `feat(locket): transcription scheduler, capture notifications, battery stat`**
- New: `locket/services/transcriptionScheduler.ts`, `recorderNotifications.ts`, `locket/ui/BatteryDrainStat.tsx`
- Modified: `locket/services/continuousRecorderService.ts`, `transcribeChunked.ts`, `vadDetect.ts`, `locket/screens/AlwaysOnTranscriptionScreen.tsx`, `locket/ui/LocketSettingsSection.tsx`, `RecorderHomeCard.tsx`
- Native: `android/.../alwayson/ContinuousRecorderModule.kt`, `ios/ContinuousRecorderModule.m`, `ios/ContinuousRecorderModule.swift`

---

## Step 2 - PARENT (`src/`, `feat/vad-gated-recorder`)

**1. `feat(llm): grammar + repeat_penalty + streaming abort on single-context lock`**
- `src/services/transcriptSummarizer.ts`, `src/services/llm.ts`, `src/services/llmHelpers.ts`, `__tests__/unit/services/llmHelpers.test.ts`

**2. `feat(models): LiteRT + Whisper infra + hexagon/silero assets`**
- `src/services/litert.ts`, `src/services/whisperService.ts`, `src/services/whisperModels.ts`
- `android/.../litert/LiteRTModule.kt`, `ios/OffgridMobile.xcodeproj/project.pbxproj`
- Assets: `android/.../ggml-hexagon/*.so`, `android/.../whisper-vad/ggml-silero-v5.1.2.bin`

**3. `feat(chat): tool-generation + chat component updates`**
- `src/services/llmToolGeneration.ts`, `src/screens/ChatScreen/ChatScreenComponents.tsx`

**4. `feat(dev): grammar/inference dev harness`** (dev-only; drop if not wanted in bundle)
- `src/components/DevGrammarModal.tsx`, `src/services/devInference.ts`, `src/stores/devInferenceStore.ts`

**5. `test(locket): insights pipeline unit tests`**
- `__tests__/unit/locket/recordingInsights.test.ts`, `recordingInsightsExtractive.test.ts`, `recordingImportance.test.ts`

**6. `chore: bump pro submodule (locket insights)`**
- Stage the updated `pro` pointer after Step 1 lands.

---

## Open questions before executing
1. Docs/plans: leave untracked (current plan) or add a `docs:` commit? Defaulting to untracked per "code only".
2. Dev grammar harness (parent commit 4): keep in the app or drop?
3. Split pro A/B by hunks, or fold into one insights commit?
