# abstractCORE

**Node-based, layered AI development: see what you are building, from the core idea down to the code.**

abstractCORE is an early-stage project exploring a more transparent way to build software with AI. Instead of treating an AI-generated codebase as a pile of files to read after the fact, abstractCORE expresses development as **nested node graphs**, in layers of abstraction:

1. **The idea** – what the system is for.
2. **Core functionality and relationships** – the major parts and how they connect.
3. **Behaviour and flow** – what each part does and how data moves between them.
4. **Functions** – the units that actually do things, with code inside.

A developer can describe intent in plain language and have it laid out as nodes, or let the AI express its current implementation as a graph that can be opened, questioned and changed at any level. The aim is **responsible AI development**: decisions are visible, the AI's assumptions are labelled as the AI's, and the person stays in charge of the choices that are theirs to make.

> **Status:** foundations / prototype stage. What exists today is two interactive HTML prototypes of the interaction model. The graph engine, AI integration and code round-tripping are planned, not built. See [ROADMAP.md](ROADMAP.md).

## Prototypes

Both are single self-contained HTML files. Open them in any modern browser; nothing to install. The AI behaviour in them is scripted to demonstrate the interaction model, not live model calls.

| Prototype | What it shows |
|---|---|
| [`prototype/idea-tree`](prototype/idea-tree/index.html) | Describing a product **from broad to specific** as a tree. Each answer can grow a more detailed child node. Questions are split into *"You must decide"* (the AI will not guess), *questions* with stated defaults, and optional *AI suggestions*. A "What it needs" view turns answers into the concrete requirements they imply. Sample: an online clothing store. |
| [`prototype/idea-graph-studio`](prototype/idea-graph-studio/index.html) | A **node graph studio** with two lenses: **Ideas** (the nodes you described, nested and connected by data-flow edges) and **System** (a complete version the AI keeps in the background, filling every gap and labelling each AI decision with its reasoning and alternatives). Overriding a decision re-shapes the graph; nodes open down to readable code sketches. Sample: an audio stem separation tool. |

## Principles

- **Abstraction first.** Every level of the graph should be understandable on its own, without reading the level below.
- **Show who decided what.** Your nodes, AI-filled nodes and AI decisions are visibly distinct.
- **Don't guess what isn't the AI's to decide.** Business, legal and product choices are surfaced as questions, not silently defaulted.
- **Everything is changeable at the level it was made.** Change an idea node and the layers beneath follow.
- **Stop anywhere, keep what you have.** The graph is always a coherent, exportable whole.

## Documentation

- [docs/architecture.md](docs/architecture.md) – the layered graph model and intended architecture.
- [ROADMAP.md](ROADMAP.md) – what exists, what is next.
- [CONTRIBUTING.md](CONTRIBUTING.md) – how to get involved.

## License

[Apache License 2.0](LICENSE) © 2026 Beloved Temitope
