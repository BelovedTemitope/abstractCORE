# Architecture

## Principle

The person is the **architect**; the AI is the **assistant**. The architect works at high levels of abstraction and keeps a high-level overview of every decision the AI takes. Code is the lowest level of detail: available, never required. Everything below serves that.

## 1. The layered graph

A project is one graph of **nodes**. Containment (`parent`) makes a tree: a node is made of its children, and depth is the level of abstraction. Each project names its layers, for example `["The idea", "Core parts", "How it works", "Functions"]`.

**Flow edges** (`{from, to, label}`) connect parts that pass data or control, at any depth: `load → split : "The song"`.

**Level of detail.** Every view takes a `maxDepth`. Parts deeper than it fold into their ancestor ("+8 more detailed"), and edges between folded parts are lifted to the visible ancestors or dropped when both ends fold into the same one. The architect chooses how deep to look. Code lives on function-level nodes and is shown only on request.

## 2. Conditional parts

A part can exist only because of a choice. Options, suggestions and AI decisions can list `spawns: [nodeIds]`:

| Source | The spawned parts exist while… |
|---|---|
| A question option | that option is chosen (and the question is visible) |
| A suggestion | the suggestion is accepted |
| An AI decision (`decision.spawns`) | the AI's choice stands (not overridden) |
| An alternative (`alternatives[i].spawns`) | the architect overrode the decision with that alternative |

A node is **active** when its parent is active and, if it is conditional, at least one source fires on an active owner. Undoing a choice removes the whole branch beneath it. Overriding a decision swaps one branch for another. Nothing is deleted from the file, so going back is lossless. Flow edges are active only when both ends are.

## 3. Who decides what

| Element | Meaning |
|---|---|
| `question.kind = "must"` | Only the architect can answer, with a `why`. Cannot be skipped. `status().ready` is false while any are open. |
| `question.kind = "ask"` | Helps the AI. Skipping applies `default`, and that is recorded. |
| `decision` | The AI's choice, its `why`, and `alternatives`. State: `open → accepted / overridden`. |
| `suggestion` | Optional idea from the AI: `open → accepted / dismissed`. |
| `author` | `user`, `ai` or `doc` (taken from a library's documentation). |

## 4. The decision ledger

`ledger(project)` walks the active graph and returns every choice the AI made on the architect's behalf:

- **decision**: an approach the AI picked. Overridden entries keep the AI's original proposal next to the architect's choice.
- **default**: a skipped question, with the default the AI applied.
- **addition**: a part the AI added that the architect never described. It counts as reviewed once the architect keeps it (`reviewPart`) or accepted the suggestion that created it.

Each entry carries `review: "open" | "accepted" | "overridden"`. This is the overview that makes abstention safe: you don't read the code, but nothing the AI chose is invisible.

## 5. Status and needs

`status(project)` gives open and answered must-decide questions, defaults, open decisions, open suggestions, ownership counts (`user` / `ai` / `doc`), progress, and **needs**: the plain-language requirements implied by current choices ("A payment provider account"), de-duplicated in graph order. `nextQuestion` asks broadest-first, so each answer can open the more specific parts beneath it.

## 6. Operations and audit

Every operation (`answer`, `toggle`, `skip`, `unanswer`, `acceptSuggestion`, `dismissSuggestion`, `acceptDecision`, `overrideDecision`, `reopenDecision`, `reviewPart`) is pure: it returns a new project and appends a `log` entry. A list of past projects is a free undo stack. The log is a durable audit trail inside the project file.

## 7. File format

One JSON file per project (`.acore.json`), `format: "abstractcore/0.1"`, described by [`schema/abstractcore.schema.json`](../schema/abstractcore.schema.json). `validate()` adds structural checks the schema can't express: parent cycles, dangling spawns and edges, answers that aren't options, a must-decide question marked skipped.

## 8. Code layout

```
src/model.ts     types: Project, GraphNode, Question, Decision, Suggestion, Edge, LogEntry
src/graph.ts     activation (conditional parts), children, paths, layers, walk, active edges
src/status.ts    status, needs, ownership, nextQuestion, ledger
src/ops.ts       pure operations with audit log
src/validate.ts  validate, load, save
src/render.ts    text tree, Mermaid (both level-of-detail aware), ledger and status text
src/cli.ts       acore command
demo/app.ts      architect view, drawing only; all state changes go through src/
```

## 9. Next: where the AI plugs in

The engine is deliberately model-agnostic. The planned AI layer produces and edits the same structures:

1. **Intent → graph**: from a description, propose nodes at the right layer. Must-decide points become `must` questions instead of guesses, and every choice becomes a `decision` with `why` and `alternatives`.
2. **Graph → code**: generate function-level code from the nodes above it, so code is always traceable to an architect-level decision.
3. **Code → graph**: read an existing codebase into a layered graph with its implicit decisions surfaced in the ledger.
4. **Change propagation**: when the architect changes a high-level node, regenerate only the affected branch and show the change as a ledger diff.
