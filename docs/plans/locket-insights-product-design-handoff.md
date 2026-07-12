# Locket Insights - Product & Design Handoff

A synthesis of a long working session on the Off Grid "insights" experience: the
product philosophy, the design decisions, the metadata/context strategy, the
transcript-quality findings, and what got built. Written so a fresh Claude chat
or agent can pick up the thinking without re-deriving it.

**How to use this doc:** this is the WHY and the design direction. For the HOW,
read the sibling docs it points to. Read this first, then dive where needed.

Sibling docs (all in `docs/plans/`):
- `locket-insights-handoff-v2.md` - the built pipeline, file map, reliability layer, conventions.
- `locket-insights-handoff.md` - v1: algorithm depth + the sim harness + real-data method.
- `insights-page-design-brief.md` - the design brief to hand a design agent (all screen states).
- `transcript-quality-experiment.md` - the research prompt for transcript quality + diarization.
- `transcript-quality-findings.md` - the research results (living log from the experiment agent).
- `redesing.md` - the original "one design, capability tiers, never fakes intelligence" idea.

> Layout: public `@offgrid/core` in `src/`; the private `pro` submodule holds the
> recorder + insights feature (`pro/locket/...`). Feature code lives in pro; only
> seams + shared services live in core.

---

## 1. The product in one paragraph

An always-on recorder captures conversations through the day. An on-device
pipeline turns each into insights - a short gist, discrete key points, and action
items - fully offline, on a tiny model, without draining the battery. The hard
truth shaping everything: **ambient transcripts are noisy** (loops, mishearings,
non-English), so the product's job is not "perfect notes" but "trustworthy notes
despite imperfect input." That constraint is the source of the whole design.

---

## 2. Product philosophy (the spine)

**Never fake intelligence it doesn't have.** When the model can't tell what
happened, the UI says so - it never bluffs a confident summary of garbage. This
is the single principle everything else follows from.

**Definitive facts vs. interpretation - always separated.** Two kinds of insight:
- DEFINITIVE (cannot be wrong, needs no model): when, how long, how many
  conversations, calendar match, voice/attendee count, mentioned names/numbers.
- INTERPRETIVE (the model's read, only as good as the transcript): the gist,
  key points, decisions, actions.
The UI LEADS with definitive facts (the trust anchor) and layers interpretation
on top, clearly marked as "what we think," not "what we know."

**Confidence drives the wording.** Confidence is computed from measurable
transcript-quality signals (avg_logprob, uniqueRatio, repetition, no_speech_prob,
VAD alignment) - NOT the model's own bravado. The tier picks the phrasing:
- High: state it plainly.
- Medium: hedge honestly ("sounds like...; audio was patchy").
- Low: do NOT summarize - show facts + a specific reason ("too noisy",
  "mostly non-English") + a way to help.
- None: "No clear speech detected."
Rule: the model may only assert when the signals support it. On low confidence,
show NO action items rather than invented ones.

**Tiered capability (from `redesing.md`).** One design, three tiers of richness
that appear only as the capability behind them is present: calendar + clock (a
device API, always available) is the backbone; Whisper adds transcripts; an LLM
adds gist/points/actions. When a tier's model isn't there, the UI shows less - it
never pretends.

**Give the user the wheel.** When inference is unreliable, turn "unknown" into
user-provided truth with a light, optional prompt ("Tag what this was", "Who was
this with?"). This is both the cheapest quality lever and the most honest UX. It
must never nag - it is an ambient recorder.

---

## 3. The insights screen design (decisions made this session)

**Interaction model: compact feed -> unified detail.** The feed is scannable
cards; tapping opens a detail that combines the audio player, the insights, and
the transcript in one place.

**The atomic unit is a verifiable CLAIM, not a paragraph.** Key points,
decisions, and actions are discrete claims - each links cleanly to the transcript
line(s) it came from. The prose "gist" is a scannable header only; it is NOT
presented as line-traceable, because a summary sentence synthesizes many scattered
lines and pointing at one would be a quiet bluff. So: the gist is the scan, the
points are the proof. This also plays to the small model's strength (extract +
attribute discrete points is easier than coherent prose over a garbled 30 min).

**Line-level provenance is the trust mechanism.** Every claim carries its source
transcript line + audio timestamp; tapping it scrolls/highlights the line and lets
the player jump to that moment. So every assertion is traceable to the exact
spoken words - which is what makes a noisy-transcript summary survivable and is
the thing competitors can't cheaply copy. Action items already carry
`sourceText` + `sourceStartMs` + tap-to-play; the enhancement is extending the
same to key points. Aim for one-way (claim -> source) first; two-way (line ->
which claim used it) is a nice-to-have.

**Feed cards lead with facts.** Headline = definitive facts (time, duration,
people, calendar title); interpretation (a one-line gist + counts) rides
underneath. Facts never embarrass us; if the gist is weak, the card still stands.

**Temporal model: a rolling, day-grouped feed - not "today only."** Insights
process LATER than they're recorded (batched when charging/idle or on tap), so
today is often all-pending while yesterday's just finished. The feed is grouped
Today / Yesterday / earlier, newest first, showing whatever is READY:
- Today = the raw-capture tier ("3 captured, not yet processed" + a calm
  "process now"), not an error.
- Yesterday and earlier = finished insights, where real review happens.
- Freshly-processed items surface with a "new" marker regardless of record day.
- Backlog collapses older days gracefully.

**Day digest wording** (definitive, human, points you at what matters):
`Yesterday: 2 conversations, 47 min. The longer one was your 1pm Product sync.`
Edge cases stay honest: zero -> "nothing worth surfacing, 4 short clips, no clear
speech"; one -> "one 31-min conversation, your 1pm Product sync".

**States to design for every card/screen:** rich, partial (hedged), low-confidence
(facts only + reason + tag CTA), no-model (facts + extractive basics, calm
"load a model" affordance), no-speech, empty. Every sparse state routes to the
enrichment screen, never a dead end.

**Enrichment screen ("Help it understand more").** Opt-in cards to grant context,
ordered cheapest/highest-value first: Calendar (match meetings, titles,
attendees), Contacts (real names, on-device match only), Location (label where -
honest that it needs a permission, optional), Connect tools/MCP (email/notes so a
recap can reference the thread - online, advanced, clearly separate from the
offline core). Granting one visibly improves the next insight (close the loop).

---

## 4. Metadata & context strategy (verdicts)

The reliable context is IDENTITY (calendar + contacts) and one optional user tap -
NOT sensors. Findings:

- **Calendar** - strongest signal, already used (event title + attendees). Gives
  who/what/when definitively when a recording overlaps an event.
- **Contacts** - valuable, local-only: resolve attendee emails/names, or a name
  heard in the transcript, to a real contact. Never sync to a server.
- **Ask the user** - a single "who / what" tag replaces diarization for owner
  attribution and trains the funnel over time. Highest ROI, must not nag.
- **Location: not reliable, and we don't have permission.** Background GPS on an
  always-on recorder is permission-gated, battery-heavy, and throttled. The
  "Scan Network" feature we ship only reads the device IP to scan the subnet for
  remote servers (needs `ACCESS_WIFI_STATE`, which we have) - it does NOT read the
  WiFi SSID. Reading SSID needs a LOCATION permission (Android `ACCESS_FINE_LOCATION`
  + `NEARBY_WIFI_DEVICES`; iOS location + "Access WiFi Information" entitlement),
  which we do NOT declare. Verdict: don't add a location permission just to label
  home/office. If pursued later, cluster networks as opaque "same place" tokens,
  infer home/office from time patterns (hedge it), and only ASSERT a named place
  if the user confirmed it.
- **Battery/charging** - captured today (zero-permission), useful for "docked at
  desk" and for scheduling processing.
- **MCP / connected tools** - powerful but online + auth-gated, so it breaks the
  offline core. Keep it a tier-3, opportunistic enrichment, never required.

**Diarization ("how many people / who spoke"):**
- VAD (Silero, shipped) does NOT count speakers - it detects speech vs non-speech.
  It gives turn structure, not identity.
- Cheapest count: calendar attendee count, or ask the user.
- Cheapest real turn detection: whisper tinydiarize (`small.en-tdrz`, en-only) -
  rides the whisper pass, emits `[SPEAKER_TURN]`; tiny/base have no tdrz variant.
- Real identity/count: layer a SEPARATE speaker-embedding + clustering pass
  (whisperX-style / sherpa-onnx) on top of any whisper transcript with word
  timestamps - so tiny/base CAN be diarized without tdrz. The research found
  AUTO speaker-count FAILS on noisy audio (fragments into phantom speakers); it
  needs a fixed/known count - which loops back to "get it from calendar or ask."

---

## 5. Transcript quality - the bottleneck (research verdict)

Transcript quality, not the LLM, is what limits insight quality. An experiment
agent swept params/models/preprocessing/diarization on the real 28.5-min meeting
(`sim/insights/realdata/dl-1312.wav`). Result (see `transcript-quality-findings.md`):

**Recommended config (expressible via whisper.rn):**
```
base.en + maxContext:0 + suppressNonSpeechTokens:true + entropyThold:2.6 + VAD(silero)
   (keep beam 5 + temperature fallback at defaults)
```
- `maxContext:0` (condition-on-previous-text OFF) is the loop killer - a control
  looped a phrase x173; this cut repetition dramatically. Must be a hard 0
  (partial context was worse).
- Never disable temperature fallback (catastrophic without it - the loop-escape
  ladder).
- `suppressNonSpeechTokens` removes the "(foreign language)"/music-marker class.
- base is the sweet spot: right params matter more than model size; tiny/small
  don't beat base-with-right-params.
- Preprocessing (denoise/gain/loudnorm, incl. RMS) HURTS - feed raw 16 kHz.

**Limitation to close:** all conclusions come from ONE file (the meeting). The
missing test: confirm the winning config kills loops on the OTHER clip types
(the July 9 repetition-loop clips, foreign clips, short low-signal clips) so it
generalizes. That is the gap between "done" and "trustworthy."

**Truth blockers no config fixes:** non-English stretches, overlapping speech,
very low-signal clips. The product routes around these via the confidence tiers
(skip / mark "too noisy" / ask the user), not by pretending.

---

## 6. What got built this session (in `pro/locket` + `src` seams)

- **Streaming insights** - `generateInsights` streams tokens into the card live
  (copied the detail-screen summary streamer), with `Reading part X of N` on long
  clips and grammar-scaffold stripping while streaming.
- **Inline player on the detail screen** - reuses `useRecordingPlayer`; tap a
  provenance snippet to play that moment in place (no navigation).
- **Model-lock reliability** - one native context = one `isGenerating` lock. Added
  `transcriptSummarizer.abort()` (interrupts + clears a wedged flag); the hub Stop
  now aborts the in-flight clip; Regenerate PREEMPTS (stops batch + aborts + takes
  over) instead of failing "busy"; auto-run suppressed while busy; and it
  AUTO-LOADS a model (via `activeModelService`) when none is resident instead of
  just prompting.
- **Dev testing UX** - a `__DEV__` toolbar (model/lock status + force-unlock +
  re-analyze + jump-to-logs), a score breakdown (every funnel term's
  contribution + gate), a "Next up" queue inspector (what the pass will process,
  in order), a collapsible transcript (verify audio -> transcript -> AI).
- **Diagnostic logging** throughout (queue, abort, busy-flag dump, per-clip
  start/done/fail) - visible in the Debug Logs screen.
- **Commits landed** (nothing pushed): 3 pro commits (pipeline; hub+detail
  screens; recorder infra) + 8 core commits (constrained-decoding/insights
  grammar; dev grammar harness; iOS CoreML whisper encoder; hexagon+silero
  assets; iOS Metal cap removal; locket tests; gitignore; pro bump). Docs +
  `sim/` (incl. private real recordings) are deliberately NOT committed.

---

## 7. Open threads / next steps (priority order)

1. **Funnel `uniqueRatio` fix** - repetition-loop clips still pass the gate (real
   bug, proven on the July 9 data). Small change to `fullScore`; watch it land in
   the new score breakdown.
2. **Apply the transcript config** (`maxContext:0` etc.) and validate it on the
   OTHER real clips (the generalization test).
3. **Claim-level provenance** - extend source attribution from actions to key
   points (generation + data-model change; UI pattern exists).
4. **Build the insights page** per `insights-page-design-brief.md` (feed + card ->
   detail + provenance + confidence states + enrichment).
5. **Confidence model** - calibrate the metric thresholds that separate
   "summarize" from "too noisy" on real clips; that powers the honest wording.
6. **Part-level checkpoint** for long-clip resume; **root-cause** the wedged
   `isGenerating` (reset on teardown so chat/batch self-heal, not just Regenerate).
7. Later tiers: contacts, calendar enrichment UI, diarization (fixed-count),
   op-sqlite migration, on-device whisper speed/GPU experiment, model fine-tune.

Ready-to-run prompts exist for: transcript-quality research
(`transcript-quality-experiment.md`), the insights page design
(`insights-page-design-brief.md`). An on-device whisper speed/GPU experiment
prompt is still to be written (separate from accuracy; needs a connected phone).

---

## 8. Conventions (carry over)

- Pro code stays in the `pro/` submodule on its own branch + PR; nothing pro leaks
  into core `src/`/docs.
- Never commit or push without explicit instruction; "build it" authorizes coding
  only. Co-author `Dishit Karia <hanmadishit74@gmail.com>`; no AI attribution.
- Never auto-delete user data; surface, let the user decide.
- Design tokens (TYPOGRAPHY/COLORS/SPACING), weights <=400, Feather icons, no
  emojis. Brand voice: proof-first, no em dashes, no curly quotes, no exclamation,
  no forbidden words, no slop.
- Reuse before building; design to abstractions (no backend-type branching in UI).
- One model lock - check `isSummarizing`/`isCurrentlyGenerating` or preempt with
  `abort()` before generating. Do not raise threads to fix latency.
- Docs + `sim/` (private recordings) stay out of git; only app code + tests are
  committed.
```
