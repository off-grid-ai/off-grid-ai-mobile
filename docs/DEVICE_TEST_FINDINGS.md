# Device test findings — Android from-device wire-capture run (2026-07-11)

Device: OPPO CPH2707, **Snapdragon 8s Gen 3 (SM8635)**, qnnVariant `min`, hasNPU `true`, Android 16,
**11.8GB total / ~4.8GB available** at launch. Build: `ai.offgridmobile.dev` (debug, all `[WIRE-*]` loggers).

Evidence lives in `docs/wire-captures/` (timestamped `wire-*.log` + `debug-*.log` snapshots).
User's verbatim commentary in `DEVICE_SESSION_COMMENTARY.md` (gitignored).

---

## BUGS (confirmed with device evidence)

### B1 — Whisper STT model leaks resident; eject-all can't clear it *(TOP PRIORITY)*
**The headline bug.** Chain of three defects, all confirmed from `[MEM-SM]`/`[MODEL-SM]` traces + code:

1. **Whisper auto-loads resident the instant it finishes downloading** — not on first transcription.
   Trace: `[Whisper] Downloaded → makeRoomFor whisper sizeMB=1500 → Loading model → Model loaded successfully`
   at 07:20. It should not load into RAM until the user actually transcribes.
2. **`makeRoomFor` counts it in the budget but never evicts it.** When loading gemma (text, 5854MB) with
   `residents=[text:1055, whisper:1500]`, it returned `fits=true evict=[]` while `os_procAvailMB=1662` —
   i.e. it green-lit a 5854MB load into 1.6GB of real free RAM.
3. **`ejectAll` doesn't know whisper exists.** After eject-all: `[MODEL-SM] ejectAll → done count=1`, and the
   next load shows `residents=[whisper:1500]` — the chat model ejected, **whisper survived**.
   Code: `activeModelService.unloadAllModels()` returns only `{textUnloaded, imageUnloaded}`; STT/whisper is
   absent from the unload set (`activeModelService/index.ts:394,428`). So the user's only manual escape hatch
   structurally cannot free whisper — app-kill is the sole recourse.

**User symptom (their words):** "this gemma4 e2b is struggling on my phone. I'm pretty sure its some coresident
bullshit in the ram" / "cause normally its super fast." Exactly right — 1.5GB whisper squatter → thrash.

**Fix directions:** (a) don't load whisper resident on download; (b) `makeRoomFor` must gate on physical
`os_procAvail`, not just the soft budget, AND treat an idle STT model as evictable; (c) `unloadAllModels`/
`ejectAll` must include the STT/whisper residency.

**Test (writable from this trace):** residency-invariant — after downloading an STT model it must NOT be
resident; loading a chat model must evict an idle whisper; eject-all must clear ALL heavy residents (assert
`getResidents()==[]`, not `count`). Reproduce budget: `budgetMB=7908`, sizes text:1055/1500/5854 from the log.

### B2 — Budget (soft) vs physical-available RAM divergence
`makeRoomFor` decides `fits=true` against `budgetMB=7908` while `os_procAvailMB=1662`. Loading a model larger
than physical-available thrashes/swaps → the slowness. The gate trusts the soft budget over the OS's real
figure. (Overlaps B1 but is its own defect — the physical-RAM number is captured and ignored.)

### B3 — gemma-4-E2B estimated at 5854MB (absurd for a 2B model)
`makeRoomFor text sizeMB=5854` for a ~2GB 2B model. Almost certainly the **mmproj (vision) inflating the
estimate** with a large multiplier. Consequences: trips the "may be too big" select-time warning, and forces
**CPU fallback** (`[WIRE-LLAMA-LOAD] nGpuLayers:0`) → slow generation. Estimator for vision-capable gguf needs
review.

### B4 — Premature "downloaded successfully" notification (fires before extraction)
The bottom-sheet "downloaded successfully" fires at **native download-complete**, but image-model **zip
extraction is deferred** to the next `syncCompletedImageDownloads` (image-tab visit / relaunch). Confirmed on
**AnythingV5** and **Absolute Reality** (consistent, not a one-off). So a model reports "ready" while it's only
downloaded-not-extracted. `downloadHydration.ts` comment corroborates: "native finished but JS finalization
(unzip+register)". `[WIRE-UNZIP]` had NOT fired for either image model at snapshot time — extraction pending.
**Open:** does selecting + generating with such a model immediately work (on-demand extract) or fail? (Not yet
tested — the "select image model → generate" step.)

### B5 — Thinking stream leaks into the answer bubble at stream start
**User's words:** "in the beginning the chat doesn't know its a thinking stream, and therefore is adding
everuything in the message like its the final response. then when the thinking stops it realises that it was
thinking." Mechanism (confirmed via wire capture): **local models deliver thinking as inline `<think>` tags**
in the content stream; the parser lags recognizing the opening `<think>` mid-stream, so the first tokens
mis-route into the answer bubble before it detects the think block. Thinking-OFF streams clean (no opener to
detect). **Test:** with thinking on, tokens before the delimiter is recognized must NOT render in the answer.

### B6 — Empty `<think></think>` emitted even with thinking OFF (Qwen3.5)
Bare baseline (thinking off, tools off) final content began: `<think>\n\n</think>\n\nHere are the answers...`.
Qwen3.5 emits an empty think block even when thinking is disabled; the parser must strip it or the user sees
literal `<think></think>` atop the answer. Captured in `[WIRE-LLAMA]`.

### B7 — Download counter transient off-by-one (vision-model mmproj)
Single-instant contradiction observed: download-manager list showed 4 running + 7 queued (=11) while the icon
badge showed 10. Root cause from `getActiveDownloads`: a vision model's **mmproj is a separate download row**,
so the list counts files while the badge counts models — they diverge by one **while the mmproj is in-flight**.
Steady-state is correct (user later confirmed solid number = 14 downloaded). Scoped claim: transient
off-by-one during active vision-model download, NOT a persistent counter break.
**Note:** user also reported "massive sync issues between this and the download manager icon notification" —
badge-vs-count divergence may be larger than one in some states; needs the exact numbers next session to pin.

### B8 — "No servers found" while the server is simultaneously added to the list
Network scan reported "no servers found" but OGAD appeared in the server list at the same time. State desync
between the scan-result toast and the server-list state. (Pure UI state — testable in jest.)

---

## UX FINDINGS (product, not crashes)

- **No remote indicator in the model modality selector.** A remote (Qwen3.5-2B / OGAD) model looks identical
  to a local one. User suggests a small cloud icon. ("There is no way to know that this is a remote model.")
- **"Text says 0" on home while a remote model is active + selected.** Likely "0 local text models" (correct
  literal) but reads as a desync next to an active remote model. Confirm the chat works despite the 0.
- **Notification consistency — CORRECTED finding.** Initially looked like "image models notify, text don't,"
  but SmolLM3 (text) DID notify. Real variable is likely **foreground/timing**, not model type. (Self-corrected
  from device evidence — don't encode the wrong "image vs text" rule.)

## CONFIRMED-WORKING (happy paths worth locking as regression tests)

- **Onboarding skipped** when a server + model are already configured ("hit continue, it skipped onboarding —
  good UX").
- **Lazy model loading** — model loads on first send, not on select ("exactly the lazy model loading I wanted").
- **Queue-while-generating** — sending a 2nd prompt mid-stream queues it and processes in order after the
  current completes. No collision/drop.
- **Stop-mid-stream** — stop halts generation cleanly and the queue advances to the next prompt.
- **Support-sheet dismissal** — the "support open source AI" share sheet dismisses correctly after returning
  from X (doesn't re-nag).
- **Reasoning + tool render** — pre-tool thinking → tool call → post-tool thinking → answer render as four
  distinct sections in order.

---

## WIRE-FORMAT GROUND TRUTH (the fixtures — captured, not guessed)

### Thinking is delivered THREE different ways (parser must handle all)
1. **Local (llama.rn):** inline `<think>...</think>` tags in the token stream; fields `{content, token}` only.
   Even thinking-OFF emits an empty `<think></think>` (B6).
2. **Remote OGAD (OpenAI-compatible SSE):** a separate **`reasoning_content`** field, streamed token-by-token,
   then switches to `content` for the answer. NOT `<think>` tags.
3. **Remote Ollama (native NDJSON):** a `thinking` field (to be captured — not run yet).

### Tool calls
- **Remote OGAD:** structured `tool_calls`, but **arguments stream as partial-JSON fragments** across many
  deltas; must accumulate `tool_calls[index].function.arguments` by `index`.
- **Parallel tools:** emitted as `index:0` AND `index:1` in the **same** round (accumulate by index — not one
  call, not serial rounds).
- **Reasoning + tool = TWO round-trips:** round 1 `reasoning_content* → tool_calls* → done`; then the app runs
  the tool and injects the result; round 2 `reasoning_content* → content* → done` (the model reasons in BOTH
  rounds).
- **Local (llama.rn):** captured via `[WIRE-LLAMA-TOOL]` (input+output). CAPS advertise
  `tools/toolCalls/parallelToolCalls: true, toolUse: false` (Qwen0.8B and gemma-4-E2B identical).
- **Gemma tool format:** thinking+tools turn captured but not yet decoded — the open question is structured
  `tool_calls` vs messy ` ```json `/`[tool_call]` markers (Q2/Q3 territory).

### Three distinct memory gates (do NOT conflate)
1. **Download-time:** "may not run comfortably on your device, sure you want to download?" (seen on E4B).
2. **Select-time:** "may be too big" advisory in the model-selector bottom sheet (informational, non-blocking).
3. **Load/generation-time:** `ModelFailureCard` "Not Enough Memory" + "Load Anyway" (residency `makeRoomFor`).

### Device / load facts
- SoC `[WIRE-DEVICE-SOC]`: `{vendor: qualcomm, hasNPU: true, qnnVariant: "min"}` → qnn image backend IS
  available on this device.
- gemma-4-E2B gguf load `[WIRE-LLAMA-LOAD]`: `contextLength 4096, nGpuLayers 0 (CPU), n_threads 6`.
- Several gguf models ship an **mmproj = vision-capable**: gemma-4-E2B, Qwen3.5-0.8B, SmolVLM, Qwen3.5-2B.

---

## CAPTURE STATUS (what's in the logs vs still to run)

**Captured:** device/SoC/RAM; downloads (parallel/queued, 14 models); 3 memory gates; OGAD remote (plain,
tool, reasoning, reasoning+tool, parallel-tools); Qwen3.5-0.8B local (bare baseline, thinking, tools, parallel,
queue, stop); gemma-4-E2B gguf (load+caps; thinking+tools turn pending decode); the B1 coresidency trace.

**Still to run (next session, after an app restart to clear whisper):**
- gemma-4-E2B **litert** (Android-only engine — does it use a `litert_thinking` channel? zero captures yet)
- **Vision** — attach a photo + ask (`[WIRE-VISION]` + response)
- **Image gen** — select AnythingV5/Absolute Reality → generate → `[WIRE-UNZIP]` (MNN/QNN extract, B4) +
  `[WIRE-IMAGE]` (also tests whether the "ready" image model actually works — B4 open question)
- **STT** — record a voice note + a silent clip (`[WIRE-STT]`)
- **TTS** — tap Speak on a reply (`[WIRE-TTS]`, kokoro)
- **RAG** — project + PDF in KB + ask (`[WIRE-EMBED]` + `[WIRE-PDF]`)
- **Remote:** LM Studio (gemma-4-E2B) + Ollama (minimax-m3:cloud), 2 samples each (thinking/tools on/off)
- **iOS** — repeat the native-divergent seams (image Core ML, STT, one gguf turn) for platform parity
