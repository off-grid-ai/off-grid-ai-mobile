# Residency test mismatches — for review

When a residency/co-residency/auto-eviction/budget test (T115–T120 and beyond) **cannot reproduce** what the
device evidence says (`DEVICE_TEST_FINDINGS.md`, `DEVICE_SESSION_COMMENTARY.md`, `docs/wire-captures/`, the
prior conversation summary), it is logged HERE rather than forced to a false green or a wrong-reason red.

Each entry: what the finding/log expected, what the test actually observed, the trace evidence
(`DEBUG_LOGS=1`), and the hypothesis (device-only behavior / stale finding / harness gap / real code
divergence). Nothing here is "done" — each is a question for the human to resolve on return.

Format:
- **[Txxx] <one-line>** — Expected (from <source>): … · Observed (test): … · Trace: … · Hypothesis: … · Status: OPEN

---

- **[T119] whisper blocked→free→retry — DEFERRED (harness gap, not a device mismatch)** —
  Expected (from `DEVICE_TEST_FINDINGS.md` B1 + `ensureWhisperForTranscription.ts`): on a tight device where a
  heavy text model owns RAM, recording a voice note makes `whisperStore.loadModel` return `'blocked'` (the
  sidecar rule won't evict the heavy), so `ensureWhisperForTranscription` calls `freeGenerationModels()` then
  retries → whisper loads, the transcript reaches the model. · Observed (test): not yet built — reproducing the
  `'blocked'` verdict needs (a) whisper **downloaded but NOT resident** (the harness `setupWhisperModel` both
  downloads AND selects+loads, so there's no "downloaded-only" state), and (b) a `setBudgetOverrideMB` tuned so
  the text model fills the budget and the small STT sidecar can't co-reside — plus confirming the AUDIO-mode
  voice path actually calls `ensureWhisperForTranscription` (it may warm whisper eagerly, in which case the
  blocked path is chat-mode-only). · Trace: n/a (not run). · Hypothesis: harness needs a
  `downloadWhisperOnly()` helper (download gesture, no select) + a budget knob; the code path itself is real
  and unit-tested (`ensureWhisperForTranscription`). · Status: OPEN — needs a focused session + a small harness
  addition. Not a device-behavior mismatch; a test-infra gap.
- **[T118] embedding sidecar lazy-load on first RAG query — DEFERRED (harness gap)** —
  Expected (from `embedding.ts:85` + `searchKnowledgeBaseRoundtrip`): the embedding model loads on the first
  real `embed()` (indexing a KB doc, or a doc-question → `search_knowledge_base` → embed), registers as
  `type:'embedding'`, co-resides as a sidecar → In Memory should list `resident-item-embedding` with its RAM. ·
  Observed (test): not built — reaching a REAL `embed()` via UI needs either a KB **doc-attach** gesture or a
  full **project + KB + doc-question** chat round-trip; the existing project UI tests seed via
  `useProjectStore.setState` (no doc-attach gesture) and every RAG test (`ragFlow`/`embeddingFlow`/
  `searchKnowledgeBaseRoundtrip`) is service-level with NO mounted screen. · Trace: n/a. · Hypothesis: needs a
  RAG UI harness (mount the project/KB screen + a real attach-document gesture, or a chat harness that files a
  chat under a project with a seeded-but-embeddable doc). The embedding residency registration itself is real
  and service-covered. · Status: OPEN — needs a RAG UI harness. Not a device mismatch; a test-infra gap.
