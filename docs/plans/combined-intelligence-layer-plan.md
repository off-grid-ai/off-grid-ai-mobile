# Combined Intelligence Layer — build plan

Status: figuring out. Plan only, not implemented. Spans three repos:
`off-grid-mobile-ai` (mobile), `~/Desktop/desktop` (Off Grid AI Desktop, Electron),
`~/Desktop/sync` (easy-android-to-mac, becoming "Off Grid Sync").

## The one-line picture

Two strong intelligence stacks already exist independently. **Nothing connects
them.** The work is the bridge, not the brains.

- **Mobile** already: transcribe, summarize, RAG "Ask your recordings", attach
  transcript to chat, keyword search, calendar labeling. All on-device, wired.
- **Desktop** already: local LLM chat, Projects RAG, universal hybrid search
  (FTS5 + LanceDB, RRF), and an **ask-across-everything** pipeline
  (`universalSearch → ragChat` with citations). Meeting + dictation recorders
  with their own tables. All local.
- **Sync** already: LAN-only device-to-device transport (TCP + HTTP for big
  files), mDNS discovery, passphrase pairing — **working Android↔macOS**.
- **Gap:** mobile sends *nothing* to desktop; desktop has *no inbound ingest*;
  sync's transport is welded into app UIs, not embeddable.

## Enabling facts (these make it much cheaper than it looks)

- **Same embedding model both ends: MiniLM, 384-dim.** Mobile:
  `all-MiniLM-L6-v2-Q8_0.gguf` via llama.rn (bundled, not gated). Desktop:
  `Xenova/all-MiniLM-L6-v2`. Same space, same dims → embeddings are portable
  (compute on phone, reuse on desktop). Verify GGUF-vs-ONNX numeric parity; if
  it drifts, desktop can cheaply re-embed the synced transcript.
- **Desktop's ask-across-everything already works.** Once synced recordings land
  in desktop's indexed tables, the existing `universalSearch → ragChat`
  (`desktop/src/main/ipc.ts:884-918`) answers over them for free.
- **Sync already pairs + auto-accepts.** `autoAcceptFromPaired` defaults true
  (`sync/packages/desktop/src/main/storage.ts:24`); pairing/discovery/framing all
  built in `sync/packages/shared`.
- **Desktop gateway already binds LAN** (`0.0.0.0:7878`) for the mobile app — but
  it's inference-only, no data-write. Not the ingest path.

## What to build — the bridge (3 workstreams)

### WS1 — Embeddable sync transport (the gating piece)
Sync's transport is trapped in a RN hook (`sync/packages/mobile/src/hooks/
useConnection.ts`) and an Electron `ConnectionManager`
(`sync/packages/desktop/src/main/connection.ts`). Neither is importable.
- Extract a framework-agnostic client (connect / pair / sendText / sendFile /
  receive callbacks) — promote into `sync/packages/shared` or a new
  `packages/client-rn`. Pure logic (framing, pairing FSM, chunking, crypto,
  mDNS constants) is already reusable; only the socket glue needs lifting.
- Add programmatic sync: auto-connect to a known paired device, a send
  queue + retry, and content-addressed IDs for idempotency/dedup.
- **iOS: no transport exists in sync (Android-only).** If mobile targets iOS,
  that's net-new work.
- **Encryption: not wired on the live path** — sync currently sends plaintext
  framed JSON. NaCl `encryptMessage`/secretbox exists but is unused for bodies.
  Wire it before syncing transcript content (even on LAN).

### WS2 — Mobile export + manifest (what to send)
- Define a per-recording **manifest** (JSON): `id, title, startedAt, endedAt,
  durationMs, transcriptSegments[{startMs,endMs,text}], summary, eventTitle,
  attendees[]`, optional `embeddings` + `audioFile`.
- Send over sync: manifest as a `.json` file (or `text` if <1MB); embeddings as
  a file; audio as a file (optional — desktop can transcribe/embed itself).
- Trigger: a "Sync to desktop" toggle or on-finalize; incremental (only
  new/changed). Source of truth is `recordingsStore.ts`; embeddings live in the
  RAG SQLite store.

### WS3 — Desktop ingest + fold into intelligence (what receives it)
- Add a **desktop ingest hook**: a receive callback / watch on the sync save dir
  keyed off the manifest → map to existing primitives:
  - `saveMeetingFromFile(srcPath, {startedAt,endedAt,ext}, preTranscript)` —
    **passing the transcript skips whisper** (`desktop pro/main/meetings.ts:103`).
  - or `recordObservation({surface:'Meeting', ...})` — the canonical
    fold-into-timeline+search primitive.
- Add **provenance columns** (`origin='mobile'`, `deviceId`, `externalId`) to the
  target table for dedup/attribution (prevents re-ingest loops).
- Make it searchable: add the row source to `desktop/src/main/search.ts`
  `SOURCES_SQL` + trigger `indexBatch` — or write the mobile 384-dim embeddings
  straight into LanceDB.
- Then desktop's existing ask-across-everything answers over synced recordings
  with no further work.

## Sequencing
1. **WS1 first** — it gates everything. Prove: RN app connects + pairs + sends a
   file to desktop programmatically.
2. **WS3 in parallel** against a mock manifest — prove desktop ingests a manifest
   into `meetings` and it shows up in ask/search.
3. **WS2 connects them.**
4. **Thinnest end-to-end slice:** one recording → manifest+transcript over sync →
   desktop ingests as a meeting → appears in desktop "ask across everything."
   Then layer on embeddings reuse, audio, incremental sync, encryption.

## On-device (mobile) intelligence — wired vs left to improve

**Wired (works today):**
- Chat-with-transcripts ✅ (`AttachToChatSheet` → `chatAttachmentInbox` →
  composer; whole/range; auto-condense when long).
- Summarize ✅ (map-reduce, multi-backend, meeting-shaped prompts).
- Ask-across-recordings ✅ (project-scoped chat + `search_knowledge_base` tool →
  semantic retrieval over MiniLM embeddings) — but **manual-scoped**.
- Keyword transcript search ✅ (all recordings, with seek-to-moment).
- Calendar labeling ✅ (best-effort, on-device).
- KB embeddings ✅ (MiniLM bundled, not gated).

**Left to improve (independent of sync — worth doing regardless):**
- **Ask coverage:** only recordings the user manually "Sync to KB"'d are
  Ask-able. No bulk "sync all", no auto-index on transcribe → recordings get
  silently missed. Add bulk/auto-index (guarding the no-embedding-model case).
- **Retrieval quality:** `topK=5` + coarse char budget
  (`src/services/rag/retrieval.ts:82-85` returns the full contextLength). Tune.
- **Metadata filtering + citations:** chunks store `recordingId`/`startMs`/
  `eventTitle` but Ask doesn't filter by date/person/meeting or render clickable
  citations back into the player. Add filtered retrieval + tap-to-seek citations.
- **Re-embedding/versioning** if the bundled embedding model ever changes.

## Important flags
- 🚩 **Embeddings are portable (MiniLM 384-dim both ends)** — biggest cost saver;
  verify runtime parity, else re-embed cheaply on desktop.
- 🚩 **Sync payload encryption is NOT wired** (plaintext today) — turn it on for
  transcript content.
- 🚩 **iOS sync transport is missing** (Android-only) — extra work if iOS matters.
- 🚩 **Desktop has no peer/auth/provenance/dedup model** — must add device
  identity + external-id dedup or you get re-ingest loops.
- 🚩 **Desktop has two recording tables** (`meetings` vs `voice_recordings`) and
  `voice_recordings` isn't even in universal search — **ingest into `meetings`**
  (it's searchable and supports a pre-supplied transcript).
- 🚩 **Privacy stance is emphatic on both repos: on-device / no cloud.** Keep the
  bridge LAN-only (sync already is). No cloud relay.

## Reusable building blocks (don't rebuild)
- Mobile source of truth: `pro/locket/stores/recordingsStore.ts`; RAG store
  `src/services/rag/database.ts`.
- Sync protocol/crypto/pairing: `sync/packages/shared/src/{protocol,crypto,pairing,discovery}`.
- Desktop ingest primitives: `desktop pro/main/meetings.ts` (`saveMeetingFromFile`),
  `desktop pro/main/crm/observations.ts` (`recordObservation`); search hook
  `desktop/src/main/search.ts`; ask pipeline `desktop/src/main/ipc.ts:884-918`.
</content>
