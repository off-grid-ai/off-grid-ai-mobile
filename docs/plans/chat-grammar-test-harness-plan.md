# Chat Grammar Test Harness (Dev) — Implementation Plan

A **developer test tool** in the chat interface: a button that opens a modal to paste a **GBNF grammar** (plus optional temperature + assistant prefill), which then gets applied to the next chat completion(s). Lets us test grammar-constrained / prefill / temp=0 output on the **real on-device model** without leaving the app. Dev-only, not shipped to users.

Written so another agent can build it directly. Read `locket-llm-insights-plan.md` §"small-model reliability" for the why.

---

## 0. Goal

Type a message in chat, but constrain the model's response with a pasted GBNF grammar (and optional temp / assistant prefill). See exactly how the on-device model behaves under grammar + prefill, so we can nail the insights recipe before wiring it into the recorder.

The capability already exists: the app uses **llama.rn** and **already passes a `grammar` to `completion(...)` for tool-calling**. This harness just lets a human paste one at runtime and route it into that same call.

---

## 1. Scope

- **Dev-only.** Gate the button behind `__DEV__` (or a debug/settings flag) so it never appears in a user build.
- Applies to **chat** completions only (not the recorder).
- Works on the **llama.rn (llama.cpp / GGUF)** backend only — GBNF is a llama.cpp sampler feature. If the active model runs on **LiteRT/executorch**, disable the button with a note ("grammar needs a GGUF/llama.cpp model").

---

## 2. The integration point (find this first)

Locate where chat sends a turn to the model — the generation service that calls llama.rn `context.completion(...)`. Tool-calling already sets a `grammar` there (search for `grammar` in the generation path, e.g. `src/services/generationToolLoop.ts` / `src/services/llm.ts`). That call is where the pasted grammar/temperature/prefill get injected.

---

## 3. Dev override store

New lightweight store (or a slice), `devInferenceStore`:
```ts
interface DevInference {
  enabled: boolean;          // master toggle
  grammar?: string;          // raw GBNF pasted by the user
  temperature?: number;      // e.g. 0 for deterministic
  assistantPrefix?: string;  // prefill, e.g. "TITLE: "
  lastError?: string;        // GBNF parse / apply error to show in the modal
  setGrammar / setTemperature / setAssistantPrefix / setEnabled / clear
}
```
Not persisted (transient dev state), or persist if convenient.

---

## 4. UI — button + modal

- **Button:** a small dev affordance in the chat header or input row (e.g. a `code`/`terminal` Feather icon), visible only when `__DEV__`. Shows an "active" dot when `enabled && grammar`.
- **Modal** (`Modal`, matching the app's existing modal/`CenteredAlert` styling, design tokens):
  - Multiline `TextInput` — paste the **GBNF grammar** (monospace, scrollable).
  - Optional fields: **temperature** (number), **assistant prefill** (short text, e.g. `TITLE: `).
  - **Enable** toggle (master on/off).
  - Buttons: **Apply** (save to the store), **Clear** (reset), **Close**.
  - If `lastError` is set (invalid GBNF from the last run), show it in red.
- A visible **"grammar active"** chip somewhere in the chat while enabled, so it's obvious the next reply is constrained.

---

## 5. Applying it in the generation path

At the completion call (from §2), when `devInferenceStore.enabled`:
- pass `grammar: devInference.grammar` (if set),
- pass `temperature: devInference.temperature` (if set),
- apply `assistantPrefix` as a **prefill** — either append a trailing partial assistant message, or set the raw prompt to end with the prefix (whichever llama.rn build supports; the `messages` + partial-assistant approach is cleanest).
- Wrap in try/catch: if llama.rn rejects the grammar (invalid GBNF), catch it, write `lastError` to the store, and fall back to a normal (ungrammared) completion so chat doesn't break.

**Tool-calling conflict:** the chat's normal grammar is for tools. A custom grammar can't coexist with the tool grammar. So while the dev grammar is enabled, **disable tool-calling** for that turn (skip attaching tools), and note this in the modal ("tools are off while a custom grammar is active").

---

## 6. Backend + safety

- **llama.rn only.** Detect the active backend; if it's LiteRT/executorch, disable the button + show why. (Grammar is llama.cpp-specific.)
- **`__DEV__`-gated** so it never ships. (Or behind an existing hidden debug flag.)
- Fallback on grammar error so a bad paste never bricks chat.

---

## 7. File-by-file

| File | Change |
|---|---|
| `src/stores/devInferenceStore.ts` (new) | grammar / temperature / assistantPrefix / enabled / lastError + setters |
| chat generation path (e.g. `src/services/generationToolLoop.ts` or `llm.ts`) | when `devInference.enabled`, inject `grammar` + `temperature` + prefill into the llama.rn `completion(...)`; skip tools; try/catch → `lastError` + fallback |
| chat header / input (e.g. `src/components/ChatInput` or the chat screen) | `__DEV__` button → opens the modal; "grammar active" indicator |
| `src/components/DevGrammarModal.tsx` (new) | the paste modal (GBNF textarea + temp + prefill + enable + apply/clear + error) |

Keep everything token/style-compliant (design tokens, Feather icons, weights <=400).

---

## 8. Testing

- Paste the insights GBNF (below), enable, send a transcript in chat → the reply is forced into `TITLE:/SUMMARY:/ACTIONS:` and does **not** start with a preamble.
- Set temperature 0 + assistant prefill `TITLE: ` → reply starts mid-format, deterministic.
- Paste **invalid** GBNF → `lastError` shows in the modal, chat still replies (ungrammared fallback).
- On a LiteRT model → button disabled with the note.
- Toggle off → chat returns to normal (tools back on).

Starter GBNF to paste:
```gbnf
root  ::= "TITLE: " line "\nSUMMARY: " line "\nACTIONS:\n" acts
acts  ::= "none\n" | item+
item  ::= "- " line "\n"
line  ::= [^\n]+
```

---

## 9. Guardrails / cleanup

- Dev-only; do not surface in production builds.
- Never persist a grammar into normal chat behavior — it's an explicit, visible override that the user enables/clears.
- Fallback on any grammar/apply error; never break chat.
- This is a **throwaway test harness** — fine to keep behind `__DEV__`, or remove once the insights recipe is locked. Note it in the PR so it isn't mistaken for a user feature.

---

*Purpose: validate the "grammar + prefill + temp 0" recipe on the real on-device model, in-app, before wiring GBNF into the recorder's insights generation (`transcriptSummarizer` / insights service). Once the recipe is proven here, port the grammar + prefill + temp into the insights completion call.*
