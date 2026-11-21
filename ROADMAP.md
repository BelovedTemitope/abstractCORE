# Roadmap

## Exists today (v0.1 – prototypes)

- [x] Hierarchical idea tree, broad to specific, with answers growing child nodes (`prototype/idea-tree`)
- [x] Decision ownership: must-decide / question-with-default / suggestion
- [x] Requirements ("what it needs") derived from choices
- [x] Node graph studio with Ideas and System lenses (`prototype/idea-graph-studio`)
- [x] AI decisions labelled with reasoning and alternatives; overrides reshape the graph
- [x] Nested nodes opening down to code sketches

The AI in both prototypes is scripted for one sample project each.

## Next

- [ ] Extract a standalone graph core (node/edge model, layers, JSON schema, tests)
- [ ] Load/save projects as JSON; import/export between the two prototypes' models
- [ ] Merge the two prototypes into one editor
- [ ] Live LLM integration for intent → graph, behind a provider-agnostic interface
- [ ] Function-level nodes that generate real, runnable code

## Later

- [ ] Code → graph: read an existing repository into a layered graph
- [ ] Change propagation across layers with reviewable diffs
- [ ] Exportable audit trail of AI decisions and overrides
- [ ] Plugin points for languages and frameworks
