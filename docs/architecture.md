# Architecture (intended)

This document describes the model abstractCORE is being built around. Parts marked *(prototype)* are demonstrated in the HTML prototypes; everything else is design, not implementation.

## 1. The layered graph

A project is a single graph of **nodes** arranged in **layers of abstraction**. A node can contain a sub-graph, so any node can be opened to reveal the more specific nodes that make it up.

| Layer | Answers | Example (stem separation tool) |
|---|---|---|
| L0 – Idea | What is this for? | "A stem separation tool" |
| L1 – Core parts | What are the major capabilities and how do they relate? | Load a song → Split into stems → Listen / Save |
| L2 – Behaviour | How does each part work, and what flows between parts? | Send song to a separation service → Get four stems back |
| L3 – Functions | What code does the work? | `runModel(audio)`, `writeWav(stem, name)` |

Two kinds of relationship exist:

- **Containment** (parent → child): a node is made of its children. Gives the tree / nesting. *(prototype)*
- **Flow edges** (node → node, labelled): data or control passing between siblings, e.g. `split → save : "Four stems"`. *(prototype)*

## 2. Node model (draft)

```jsonc
{
  "id": "split",
  "parent": "tool",            // containment
  "layer": 1,
  "title": "Split into stems",
  "description": "Vocals, drums, bass and everything else, as separate tracks.",
  "author": "user" | "ai",     // who created the node
  "decision": {                // present when the AI chose something on the user's behalf
    "state": "open" | "accepted" | "overridden",
    "text": "Uses an online separation service.",
    "why": "Fastest to build. Trade-offs: cost per song, needs internet.",
    "alternatives": [{ "label": "Run it on the user's computer" }]
  },
  "questions": [{ "kind": "must" | "ask", "text": "...", "default": "..." }],
  "needs": ["A payment provider account"],   // requirements implied by choices
  "code": { "lang": "cpp", "source": "..." } // leaf / function level only
}
```

Edges: `{ "from": "split", "to": "save", "label": "Four stems" }`.

## 3. Two lenses on one graph *(prototype)*

- **Ideas lens** – only what the person described. Sparse and in their words.
- **System lens** – a complete, buildable version the AI maintains in the background, filling every gap. Each gap-fill is tagged as an AI decision with reasoning and alternatives. As the person gets more specific, AI-filled nodes are replaced by theirs.

## 4. Decision ownership *(prototype)*

Every open point is classified:

- **Must decide** – product, business or legal choices the AI must not make (returns policy, data deletion, pricing). Building does not proceed around them.
- **Question** – helps the AI; skipping applies a stated default, recorded as such.
- **Suggestion** – optional additions the AI noticed.

## 5. Planned components

1. **Graph core** – typed node/edge store, layering rules, validation, JSON serialization, change history.
2. **Editor** – canvas for nesting, zooming between layers and editing flow edges.
3. **Intent → graph** – an LLM turns natural-language descriptions into nodes at the right layer, asking instead of guessing on must-decide points.
4. **Code ↔ graph** – generate code from function-level nodes; and the reverse, read an existing codebase into a layered graph.
5. **Change propagation** – when a higher-layer node changes, mark and regenerate affected nodes beneath it, with a reviewable diff.
6. **Audit trail** – log of every AI decision, override and default, exportable with the project.
