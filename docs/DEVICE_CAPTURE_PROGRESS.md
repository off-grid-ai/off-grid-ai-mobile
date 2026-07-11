# Device wire-capture — progress & resume checklist

Android run, 2026-07-11. Full analysis in `DEVICE_TEST_FINDINGS.md`; raw commentary in
`DEVICE_SESSION_COMMENTARY.md` (gitignored); logs in `docs/wire-captures/`.

**Latest snapshot:** `wire-android-20260711-final.log` (2294 lines, 0 malformed) +
`debug-android-20260711-final.log` (12164 lines). Lossless append-only sink — pulling never loses anything.

Pull command (Android, dev build):
```sh
adb exec-out run-as ai.offgridmobile.dev cat files/offgrid-wire.log  > /tmp/wire-android.log
adb exec-out run-as ai.offgridmobile.dev cat files/offgrid-debug.log > /tmp/debug-android.log
```

---

## DONE (captured & in the logs)

- ✅ Device / SoC / RAM — `[WIRE-DEVICE]` `[WIRE-DEVICE-SOC]` `[WIRE-RAM]` (SM8635, qnn `min`, 11.8GB)
- ✅ Downloads — 14 models; parallel + queued rows captured `[WIRE-DOWNLOAD]` (205 events)
- ✅ 3 memory gates identified (download-time / select-time / load-time)
- ✅ **Remote OGAD** — plain, single tool, reasoning, reasoning+tool, parallel-tools `[WIRE-REMOTE]` (1910)
- ✅ **Qwen3.5-0.8B local** — bare baseline, thinking, tool, thinking+tool, parallel, queue-while-busy, stop
- ✅ **gemma-4-E2B gguf** — load + caps `[WIRE-LLAMA-LOAD]` `[WIRE-CAPS]`; bare `[WIRE-LLAMA]`; thinking+tools
      turn captured `[WIRE-LLAMA-TOOL]` (decode pending)
- ✅ **B1 coresidency bug** — full trace captured (whisper leak + eject-all can't clear it)
- ✅ Vision init flags `[WIRE-VISION]` fired (3×) — need a real photo turn to pair with response

## NOT DONE YET (do these when back)

**First, before anything: fully RESTART the app** (force-quit + reopen) — clears the leaked whisper model so
gemma isn't crawling. Then:

- [ ] **gemma-4-E2B litert** — load it, 2 prompts (bare baseline / thinking+tools). *Zero litert captures yet —
      highest priority text one.* Watch: does thinking come on a `litert_thinking` channel (3rd mechanism)?
- [ ] **Vision** — load a vision model (gemma-4-E2B or SmolVLM), attach a photo, ask "what's in this image?"
- [ ] **Image gen** — select **AnythingV5** (or Absolute Reality) → try to generate.
      Captures `[WIRE-UNZIP]` (the MNN/QNN extract — known bug) + `[WIRE-IMAGE]`.
      Also answers B4: does a "downloaded successfully" image model actually work, or fail because it wasn't
      extracted yet? Narrate what happens.
- [ ] **STT** — record a voice note (let it transcribe) + one **silent/short** clip. `[WIRE-STT]`
- [ ] **TTS** — tap **Speak** on any assistant reply (kokoro). `[WIRE-TTS]`
- [ ] **RAG** — create a project → add a **PDF** to its knowledge base → chat a question from it.
      `[WIRE-EMBED]` + `[WIRE-PDF]`
- [ ] **Remote LM Studio** — connect, load gemma-4-E2B, 2 samples (thinking/tools on/off). `[WIRE-REMOTE]`
- [ ] **Remote Ollama** — connect, minimax-m3:cloud, 2 samples. `[WIRE-OLLAMA]` (native NDJSON — different)
- [ ] *(optional, lower priority)* Mistral / Llama / SmolLM3 local — distinct tool formats, 2 prompts each
- [ ] **iOS run** — repeat native-divergent seams (image Core ML, STT, one gguf turn) for platform parity

## Per-model recipe (the efficient 2-prompt pattern)
1. **Bare baseline:** thinking OFF + tools OFF → `What is 47*89 and what is 30% of 400?`
2. **Combined:** thinking ON + tools ON → same prompt (+ "reason step by step")

## Ping me to pull after each subsystem — or just run it all and I'll pull once at the end (log is lossless).
