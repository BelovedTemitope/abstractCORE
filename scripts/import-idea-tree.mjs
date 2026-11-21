#!/usr/bin/env node
// Converts the idea-tree prototype's built-in sample (the DEF table inside
// prototype/idea-tree/index.html) into an abstractCORE project file.
//
//   node scripts/import-idea-tree.mjs prototype/idea-tree/index.html > examples/clothing-store.acore.json
//
// The prototype is our own file; its DEF block is a plain object literal.
import { readFileSync } from "node:fs";

const html = readFileSync(process.argv[2], "utf8");
const start = html.indexOf("const DEF = ");
const end = html.indexOf("/* ---------- State", start);
if (start < 0 || end < 0) throw new Error("Could not find the DEF table in the prototype");
const DEF = new Function(html.slice(start, end).replace("const DEF = ", "return ").trim().replace(/;$/, ""))();

// Who spawns whom: the owner of the question or suggestion becomes the parent.
const parentOf = { idea: null }, spawnedBySuggestion = new Set();
for (const [key, d] of Object.entries(DEF)) {
  for (const q of d.questions) for (const o of q.options ?? []) for (const s of o.spawn ?? []) parentOf[s] ??= key;
  for (const s of d.suggestions ?? []) for (const t of s.spawn ?? []) { parentOf[t] ??= key; spawnedBySuggestion.add(t); }
}

const nodes = {};
for (const [key, d] of Object.entries(DEF)) {
  nodes[key] = {
    id: key,
    parent: parentOf[key] ?? null,
    title: d.title ?? "Where it lives",
    description: d.sub,
    author: spawnedBySuggestion.has(key) ? "ai" : "user",
    kind: d.level === 0 ? "idea" : "component",
    questions: d.questions.map(q => ({
      id: q.id, kind: q.kind, type: q.type, text: q.text,
      ...(q.hint && { hint: q.hint }), ...(q.why && { why: q.why }), ...(q.default && { default: q.default }),
      ...(q.showIf && { showIf: q.showIf }),
      ...(q.options && { options: q.options.map(o => ({
        value: o.v, label: o.label, ...(o.note && { note: o.note }),
        ...(o.needs && { needs: o.needs }), ...(o.spawn && { spawns: o.spawn }),
      })) }),
    })),
    ...(d.suggestions && { suggestions: d.suggestions.map(s => ({
      id: s.id, text: s.text, why: s.why, ...(s.needs && { needs: s.needs }), ...(s.spawn && { spawns: s.spawn }), state: "open",
    })) }),
  };
}

const project = {
  format: "abstractcore/0.1",
  name: "An online clothing store",
  layers: ["The idea", "Where it lives", "What it does", "The details"],
  root: "idea",
  nodes,
  // The prototype had no data-flow edges; these three show how parts connect.
  edges: [
    { from: "admin", to: "browse", label: "New clothes" },
    { from: "browse", to: "buy", label: "Items in the cart" },
    { from: "buy", to: "track", label: "Paid order" },
  ],
  log: [],
};
process.stdout.write(JSON.stringify(project, null, 2) + "\n");
