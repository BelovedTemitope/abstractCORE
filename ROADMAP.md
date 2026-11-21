# Roadmap

## v0.1: foundations (done)

- [x] Prototype: idea tree, broad to specific, with must-decide / question / suggestion
- [x] Prototype: idea graph studio, with Ideas and System lenses and labelled AI decisions
- [x] **Graph core** (`src/`): layered nodes, flow edges, conditional parts, pure operations, audit log
- [x] **Decision ledger**: every AI choice, default and AI-added part, with review state
- [x] **Level of detail**: fold any view to a chosen layer; code is opt-in
- [x] Needs derived from choices; broadest-first next question
- [x] File format v0.1 with JSON Schema and validation
- [x] `acore` CLI and Mermaid export
- [x] Architect-view web demo on the real engine; both prototypes' samples as example files
- [x] Test suite and CI

## Next

- [ ] **Live AI**: intent → graph through a provider-agnostic interface; the model must emit `must` questions instead of guessing, and a `why` plus alternatives for every decision
- [ ] Architect edits in the demo: add, rename, move and connect parts directly
- [ ] Open and save local `.acore.json` files in the demo
- [ ] Publish the core to npm

## Later

- [ ] Graph → code for function-level nodes, traceable to the decisions above them
- [ ] Code → graph: read an existing repository into layers, with implicit decisions in the ledger
- [ ] Change propagation: regenerate only the affected branch and show it as a ledger diff
- [ ] Multi-person review: who accepted which AI decision, and when
