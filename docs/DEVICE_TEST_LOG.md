# Device test log — PR #510 (refactor/parse-once-boundary)

Live on-device testing of the PR #510 build (Android dev `ai.offgridmobile.dev` + iOS "Mac's iPhone").
Every bug reported during this session is logged here with status + evidence. Status legend:
**FIXED-VERIFIED** (fixed + confirmed on device) · **FIXED-PENDING-RECHECK** (fix committed, rebuild to
confirm) · **INVESTIGATING** · **PASSED** (tested, works).

Session started 2026-07-10.

---

## Bugs reported

### B1 — E4B LiteRT "Load Anyway" refuse-loop / too aggressive (Android)
**FIXED-VERIFIED.** Hitting Load Anyway on gemma-4-E4B LiteRT (5.2GB) refused in a loop even with
nothing else resident (`residents=[]`), so "remove other models" did nothing. Root cause: the override
ceiling used raw Android `availMem` (~4.5GB) instead of the reclaimable-aware physical budget — a
FOREGROUND app's LMK reclaims background apps for real physical RAM (dirty models can use it; unlike
the reverted swap-credit). Fix: Android override ceiling = `modelMemoryBudgetMB` (~70% of total).
iOS unchanged. Commit c02c5452.
Evidence (device log 09:24): `OVERRIDE OK - post-evict free ~2673MB (effectiveAvail=7908)` →
`LiteRT loaded on gpu` → `sendMessage complete` ×2 → `session end reason=done`. No SIGKILL.

### B2 — Voice-mode thinking / enhanced-prompt block full-width (iOS + Android, audio mode)
**FIXED-PENDING-RECHECK.** In voice mode the "Thought process" + "Enhanced prompt" accordions rendered
full-bleed, wider than the AI audio bubbles. Fix: audio-mode thinking wrapper matches the assistant
audio-bubble width (88%, left-aligned); shared `ASSISTANT_AUDIO_BUBBLE_WIDTH`. Pro commit b8a6a4f7
(branch fix/audio-thinking-block-width) — rebuild pro to confirm.

### B3 — Pre-tool-call thinking box full-width / lost left alignment (text + voice)
**FIXED-PENDING-RECHECK.** A tool-call reply's thinking box + pre-text + tool cards rendered via
ChatMessage's `ToolCallWithThinking` into `systemInfoContainer` (centered) + `alignSelf:'stretch'` →
full-bleed, unlike a normal reply's bubble-width thinking box. Both text AND voice route through this
shared path. Fix: left-aligned assistant container + bubble-width (85%) content column. Commit a0142d48.

### B4 — Resend on an image turn generated TEXT instead of re-drawing (iOS)
**FIXED-PENDING-RECHECK.** Hitting Resend on an image message loaded gemma4 and answered with text
instead of re-drawing. Root cause: an image turn emits an "Enhanced prompt" assistant message (no
image) BEFORE the image-result message; `recordedTurnKind` checked only the FIRST reply → 'text' →
text pipeline. Fix: scan the WHOLE turn (until the next user message) — any image reply → 'image';
both resend entry points (user-msg + assistant-msg) unified through it.
Evidence (iOS log 09:41): `retry user msg ... recordedKind=text` on a "Draw a dog" turn. (Note the
09:40 assistant-msg resend correctly got `recordedKind=image` — the hole was the user-msg path.)

### B5 — Voice note in text mode → "Failed to load media" [FIX #1 DONE]
**ROOT-CAUSED (fix pending).** Two compounding issues:
1. **The turn-breaker:** the DESIGN (voiceNoteSend.ts) is "whisper transcript → message.content (text);
   the audio attachment is display-only." But `formatLlamaMessages` (llmMessages.ts:15-18) ALSO injects
   the voice-note audio as a `<__media__>` marker + passes its uri as media whenever the model reports
   `supportsAudio`. gemma-4-E4B-it-GGUF's mmproj then tries to load the audio file and throws — surfaced
   as `[GenerationService] Tool generation error: Failed to load media` → `[ChatGen] Generation failed`
   (iOS log 09:42:33 / 09:43:27), hard-failing the whole turn. A transcribed voice note should be sent
   as its TEXT transcript only, never re-sent as audio media in the chat/text path.
2. **The empty transcript:** this voice note attached with NO textContent (transcription produced nothing
   — whisper not ready / failed / empty capture). Needs the [STT]/whisper-readiness trace; separate from #1.
FIX DIRECTION: (a) don't send a voice-note audio attachment as LLM media when it carries a transcription
(the transcript in message.content is the input) — likely never in the chat text path; (b) don't hard-fail
the turn on a media-load error — fall back to text-only generation; (c) chase the empty-transcript cause.

---

### B6 — Retry on an image download that failed at EXTRACTION throws "Download not found" (Android)
**ROOT-CAUSED (fix in this PR).** Refined from the fuller trace:
- STT + text downloads DID recover/resume after the network drops (`stt:small.en → completed` 09:46,
  `stt:medium.en → completed` 09:51, `SmolLM3 → completed` 09:48) — so resume works for those. The
  IMG_0108/0109 red-X rows were mostly mid-recovery, not permanently dead.
- The genuinely-broken case is the QNN image model `anythingv5_npu_min`: its bytes finished (100%,
  994513330/995100213) but EXTRACTION failed — `Image model files are incomplete (missing: unet.bin /
  clip_v2.mnn.weight). The download was corrupted or interrupted.` The native download row is then gone
  (download completed), so Retry → imageProvider.resumeImageDownload → looks up the row → throws
  `Download not found` every time (log 09:45, 09:52, repeatedly). Retry on an EXTRACTION failure is
  hunting a download-to-resume that no longer exists.
FIX: when an image entry's error is an incomplete/corrupt extraction (ImageModelIncompleteError, no
resumable native row), Retry must DELETE + RE-DOWNLOAD from scratch, not resume. (Also relates to the
QNN over-recommendation backlog item — anythingv5_npu_min is the non-flagship QNN model that arguably
shouldn't be offered on this SoC.)
SUB-ITEM (auto-retry): a transient net drop shows "connection dropped, please try again" (IMG_0108)
without auto-resume — consider auto-retry with backoff (backlog OD5).

## Verified passing (tested on device this session)
- Gemma-4 LiteRT load + generate (Android) — B1.
- Gemma-4 GGUF load + generate (iOS).
- TTS + STT.
- Remote / Off Grid AI Gateway (GW).
- Message queues.
- Downloads.
- Regenerate image (iOS) — worked when tapping the image-result message (B4 was the user-message path).
- Tool calling.
