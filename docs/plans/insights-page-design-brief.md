# Insights Page — Design Brief

Paste the block below into a design agent. It designs the insights page (all its
states) and the "help the app understand more" enrichment screen, grounded in the
existing design system and the never-bluff principle.

---

```
You are designing the Insights experience for "Off Grid", an offline, on-device
AI app. An always-on recorder captures conversations; an on-device pipeline turns
each into insights (a summary, key points, action items). Your job: design the
Insights PAGE and its every state, plus a second screen where the user can give
the app more context to make insights better. Produce a concrete design spec
(layouts, states, component reuse, and exact copy), not vague ideas.

## Read first (do not invent a new visual language)
- `docs/design/VISUAL_HIERARCHY_STANDARD.md` — the type/spacing/color system.
- `docs/brand_tone_voice.md` — the copy rules (follow them in every string).
- `redesing.md` — the guiding product idea: ONE design, capability TIERS, and it
  NEVER fakes intelligence it doesn't have.
- The current implementation to evolve, not restart: `pro/locket/screens/
  LocketInsightsScreen.tsx` (per-recording detail) and
  `LocketInsightsHubScreen.tsx` (the hub). Reuse existing components
  (Card, ModelCard, shared search/list styles) rather than making new ones.

## The one principle everything follows: definitive first, never bluff
There are two kinds of insight:
- DEFINITIVE facts (cannot be wrong, no model needed): when, how long, how many
  conversations, calendar match, voices/attendees, mentioned names/numbers.
- INTERPRETIVE (the model's read): what was discussed, decisions, actions. Only
  as good as the transcript, which for ambient audio is often noisy.
Design so the page LEADS with definitive facts (trust anchor) and layers
interpretation on top, clearly separated as "what we know" vs "what we think".
The model may only ASSERT when confident; otherwise it hedges or stops. Never
show a confident summary the audio can't back, and never invent action items.

Wording is driven by a confidence tier (derived from transcript-quality signals):
- High: state plainly. "About retention and emailing recaps after meetings."
- Medium: hedge honestly. "Sounds like a discussion about retention; audio was
  patchy, so some may be off."
- Low: do NOT summarize. Show facts + an honest, specific reason. "12 min at 3pm,
  2 voices. Too noisy to make out the topic."
- None: "No clear speech detected."
When unsure, offer the user a way to help instead of shrugging (see screen 2).

## Temporal model — design the FEED across days, not one day
Do NOT design a "today only" page. Insights process LATER than they're recorded
(transcription + LLM run batched when charging/idle or on tap), so today is often
all-pending while yesterday's insights just finished. The page is a rolling,
reverse-chronological feed GROUPED BY DAY (Today / Yesterday / earlier dates),
newest first, showing whatever is READY:
  - Today = mostly the raw-capture tier: "N conversations captured, not yet
    processed" (definitive count) + a calm "process now" affordance. Not an error.
  - Yesterday and earlier = finished insights (where real review happens).
  - Freshly-processed insights surface / get a "new" marker regardless of their
    recording day, so nothing that just completed is missed.
  - Backlog: if unopened for days, show "N days of unreviewed conversations"
    gracefully (collapse older days) rather than a flat dump.
Design decisions to make explicit: the default landing view (most recent ready
day vs a "since you last checked" digest); ordering key (group by recording day,
but surface fresh/unreviewed on top); how today's pending state reads without
feeling broken; "new since last visit" markers; how far back the feed goes before
it becomes search-only. The existing day-chip stays as a focus-one-day filter.

## Interaction model — compact feed -> unified detail with line-level provenance
The feed is COMPACT, tappable cards (title + definitive facts + a one-line "what
this was" — scannable across many conversations, not a wall of text). Tapping a
card opens a UNIFIED detail that combines, in one place:
  - the audio player,
  - the summary / key points / action items,
  - the full transcript (collapsible),
  - and LINE-LEVEL PROVENANCE: every insight element (each summary sentence, key
    point, action item) links to the transcript line(s) it was derived from.
    Tapping an insight scrolls the transcript to and highlights the source
    line(s) AND lets the player jump to that audio moment.
This provenance is the product's trust mechanism: every claim is traceable to the
exact spoken moment, so even a noisy-transcript summary is verifiable ("agreed to
email recaps" -> tap -> see the line -> hear it). Action items already carry
source text + start-ms + tap-to-play; design the SAME treatment extended to
summary sentences and key points. Decide: provenance granularity (per-sentence /
per-point / per-action - aim for all three), and whether it's one-way (insight ->
source) or also two-way (tap a transcript line -> which insight used it).

## Screen 1 — the Insights page (design ALL these states)
Structure: a DAY-LEVEL digest per day section, then per-conversation cards.

Day digest (mostly definitive, always present, needs no model):
  e.g. "Yesterday: 2 conversations, 47 min. Longest 31 min at 1pm (Product sync).
  1 short call at 4pm." Design how this reads when there's 0, 1, or many.

Per-conversation card layers:
  1. Facts header (definitive): time · duration · calendar event · voice/attendee
     count · "mentioned: X, Y". Design this as the always-present, trustworthy row.
  2. "What this was" (1-2 sentences, confidence-gated).
  3. Key points (optional — only if present).
  4. Action items (optional — only real commitments; owner only if known).
  5. Decisions / open questions (optional — for real meetings).
  Sections are ADAPTIVE: a casual chat shows facts + one line; a meeting shows
  everything. Nothing empty is ever rendered.

States to design fully:
  - Rich: clean transcript + model present (all layers).
  - Partial: noisy transcript, hedged wording, some layers missing.
  - Low-confidence: facts only + honest "too noisy / non-English" note + a way to
    help.
  - No model loaded: definitive facts + extractive basics only, with a calm
    "load a model for full summaries" affordance (not an error).
  - No speech / junk clip.
  - Empty (nothing recorded yet).
  Every low/empty state must feel intentional and honest, and must surface the
  "help the app understand more" entry point (a button/CTA), not a dead end.

## Screen 2 — "Help the app understand you" (context + permissions hub)
Reached from a button on the Insights page (especially the sparse states). A calm,
opt-in hub where the user can grant the app more context to sharpen insights. Each
option is a card with: what it unlocks (concrete, proof-first), a privacy line
(everything stays on device unless stated), and an enable action. Design these:
  - Contacts: "Put real names on calls and mentions." (on-device match only)
  - Calendar: "Match recordings to your meetings, pull titles + attendees."
    (per connected account)
  - Location: "Label where a conversation happened." Be honest that this needs a
    location permission and is optional; frame as a bigger ask.
  - Connect your tools (MCP): "Link email / notes so a recap can reference the
    thread it was about." Frame as advanced + online-only, clearly separate from
    the offline core.
Design the ordering (cheapest/highest-value first: calendar + contacts before
location + MCP), the enabled vs not-enabled card states, and how granting one
visibly improves the next Insights view (close the loop, show the payoff).

## Design system + copy constraints (non-negotiable)
- Use TYPOGRAPHY / COLORS / SPACING tokens only. No hardcoded sizes/colors/spacing.
- Font weights <= 400 (no bold). Icons: react-native-vector-icons (Feather
  default). No emojis in UI.
- Follow the 5-category text hierarchy: TITLE -> BODY -> SUBTITLE/DESCRIPTION ->
  META.
- Copy: proof over adjectives; no exclamation marks; no em dashes; no curly quotes;
  no forbidden words (revolutionary, seamless, leverage, robust, comprehensive,
  enhance, showcase, ...); no "serves as / represents a" slop. Plain and specific.
- Reuse existing components; only propose a new one if nothing fits, and say so.

## Deliverables
1. Annotated layout for the Insights page in EVERY state above (rich, partial,
   low, no-model, no-speech, empty), with the day digest.
2. The per-conversation card component spec (the adaptive layers) + which existing
   components it reuses.
3. The "help the app understand you" screen: card specs, ordering, enabled/empty
   states, and the enrichment -> better-insight payoff loop.
4. Exact COPY for every state and every enrichment card, following the brand voice.
5. A short note on what a build agent must implement vs what already exists in the
   two current screens.
Keep it concrete enough to build from.
```
