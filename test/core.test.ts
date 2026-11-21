import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acceptDecision, acceptSuggestion, activeEdges, activeIds, answer, dismissSuggestion, load, nextQuestion,
  ledger, OpError, overrideDecision, reopenDecision, reviewPart, save, skip, status, toggle, toMermaid, toTree, validate,
  ValidationError, type Project,
} from "../src/index.js";

const now = () => "2026-01-01T00:00:00.000Z";
const example = (name: string) => load(readFileSync(new URL(`../../examples/${name}.acore.json`, import.meta.url), "utf8"));
const store = () => example("clothing-store");
const stems = () => example("stem-splitter");

test("examples load with no validation errors", () => {
  for (const p of [store(), stems()]) assert.deepEqual(validate(p).filter(i => i.level === "error"), []);
});

test("conditional nodes exist only once a choice spawns them", () => {
  let p = store();
  assert.deepEqual([...activeIds(p)], ["idea"]);
  p = answer(p, "idea", "platform", "web", { now });
  assert.ok(activeIds(p).has("site"));
  assert.ok(!activeIds(p).has("browse"));
  p = answer(p, "site", "features", ["browse", "buy"], { now });
  const a = activeIds(p);
  assert.ok(a.has("browse") && a.has("buy") && !a.has("account"));
  assert.ok(!a.has("delivery"), "delivery waits on the 'where' answer one level down");
});

test("removing a choice removes the whole branch beneath it", () => {
  let p = answer(store(), "idea", "platform", "web");
  p = answer(p, "site", "features", ["buy"]);
  p = answer(p, "buy", "where", "city");
  assert.ok(activeIds(p).has("delivery"));
  p = answer(p, "idea", "platform", []); // clear the top-level answer
  assert.deepEqual([...activeIds(p)], ["idea"]);
});

test("must-decide questions cannot be skipped; ordinary ones fall back to a recorded default", () => {
  let p = answer(store(), "idea", "platform", "app");
  assert.throws(() => skip(p, "idea", "platform"), OpError);
  p = skip(p, "site", "buyers", { now });
  const s = status(p);
  assert.equal(s.defaults.length, 1);
  assert.equal(s.defaults[0].question.default, "Everyday shoppers buying one or two items.");
  assert.equal(p.log.at(-1)?.action, "skip");
});

test("status tracks progress and derives needs from choices", () => {
  let p = answer(store(), "idea", "platform", "both");
  let s = status(p);
  assert.equal(s.made.length, 1);
  assert.equal(s.ready, true);
  assert.ok(s.needs.some(n => n.need.startsWith("Apple and Google developer accounts")));
  p = answer(p, "site", "features", ["buy"]);
  s = status(p);
  assert.equal(s.ready, false);
  assert.deepEqual(s.openMust.map(r => r.question.id), ["pay", "where", "fail"]);
  assert.equal(s.progress, 1 / 4);
});

test("needs are de-duplicated across nodes", () => {
  let p = answer(store(), "idea", "platform", "web");
  p = answer(p, "site", "features", ["track", "buy"]);
  p = answer(p, "track", "notify", ["email"]);
  p = acceptSuggestion(p, "buy", "receipt");
  const needs = status(p).needs.map(n => n.need);
  assert.equal(needs.length, new Set(needs).size);
});

test("showIf hides a follow-up until its question has a real answer", () => {
  let p = answer(store(), "idea", "platform", "web");
  p = answer(p, "site", "features", ["buy"]);
  p = answer(p, "buy", "where", "country");
  assert.throws(() => answer(p, "delivery", "feeq", "before"), OpError);
  p = answer(p, "delivery", "fee", "Free over 50, otherwise 5.");
  p = answer(p, "delivery", "feeq", "after");
  assert.equal(status(p).openMust.filter(r => r.node === "delivery").length, 0);
});

test("next question goes broad to specific", () => {
  let p = answer(store(), "idea", "platform", "web");
  assert.equal(nextQuestion(p)?.question.id, "buyers");
  p = answer(p, "site", "buyers", "retail");
  p = answer(p, "site", "features", ["browse"]);
  assert.equal(nextQuestion(p)?.node, "browse");
});

test("suggestions can add and remove whole parts", () => {
  let p = answer(store(), "idea", "platform", "web");
  p = acceptSuggestion(p, "site", "admin");
  assert.ok(activeIds(p).has("admin"));
  p = dismissSuggestion(p, "site", "admin");
  assert.ok(!activeIds(p).has("admin"));
});

test("overriding an AI decision swaps the nodes it implied", () => {
  let p = stems();
  assert.ok(activeIds(p).has("s-up"));
  assert.equal(status(p).openDecisions.length, 4);
  p = overrideDecision(p, "split", 0, { now });
  const a = activeIds(p);
  assert.ok(!a.has("s-up") && !a.has("s-back"));
  for (const id of ["s-model", "s-lib", "l1", "l2", "l3", "s-run"]) assert.ok(a.has(id), id);
  assert.deepEqual(status(p).overridden, ["split"]);
  assert.equal(status(p).openMust[0].question.id, "delivery");
  p = reopenDecision(p, "split");
  assert.ok(activeIds(p).has("s-up"));
  p = acceptDecision(p, "split");
  assert.equal(p.nodes.split.decision?.state, "accepted");
});

test("edges only exist while both ends exist", () => {
  let p = acceptSuggestion(stems(), "split", "bleed");
  assert.ok(activeEdges(p).some(e => e.from === "s-back" && e.to === "bleed"));
  p = overrideDecision(p, "split", 0);
  const e = activeEdges(p);
  assert.ok(!e.some(x => x.from === "s-back"));
  assert.ok(e.some(x => x.from === "s-back2" && x.to === "bleed"));
});

test("ownership counts who contributed each existing node", () => {
  const o = status(overrideDecision(stems(), "split", 0)).ownership;
  assert.deepEqual(o, { user: 9, ai: 1, doc: 3 });
});

test("toggle adds and removes options of a multi-choice question", () => {
  let p = answer(store(), "idea", "platform", "web");
  const before = save(p);
  p = toggle(p, "site", "features", "fav");
  p = toggle(p, "site", "features", "reviews");
  p = toggle(p, "site", "features", "fav");
  assert.deepEqual(p.nodes.site.questions?.find(q => q.id === "features")?.answer, ["reviews"]);
  assert.equal(p.log.length, 4);
  assert.notEqual(save(p), before);
  assert.throws(() => toggle(p, "idea", "platform", "app"), OpError);
});

test("invalid answers are rejected", () => {
  const p = store();
  assert.throws(() => answer(p, "idea", "platform", "fax"), OpError);
  assert.throws(() => answer(p, "idea", "platform", ["web", "app"]), OpError);
  assert.throws(() => answer(p, "nope", "platform", "web"), OpError);
});

test("validation catches structural problems", () => {
  const p = structuredClone(store()) as Project;
  p.nodes.site.parent = "missing";
  p.nodes.buy.questions![0].answer = "bitcoin";
  p.edges.push({ from: "buy", to: "buy" });
  p.nodes.browse.suggestions![0].spawns = ["ghost"];
  const msgs = validate(p).filter(i => i.level === "error").map(i => i.message);
  assert.ok(msgs.includes('Parent "missing" does not exist'));
  assert.ok(msgs.includes('Answer "bitcoin" is not an option'));
  assert.ok(msgs.includes("An edge cannot connect a node to itself"));
  assert.ok(msgs.includes('Spawns unknown node "ghost"'));
  assert.throws(() => load(p), ValidationError);
});

test("parent cycles are caught and never treated as active", () => {
  const p = structuredClone(store()) as Project;
  p.nodes.site.parent = "browse";
  p.nodes.browse.parent = "site";
  assert.ok(validate(p).some(i => i.message.includes("loops")));
  assert.ok(!activeIds(p).has("site"));
});

test("save/load round-trip preserves the project exactly", () => {
  let p = answer(store(), "idea", "platform", "web", { now });
  p = skip(p, "site", "buyers", { now });
  assert.equal(save(load(save(p))), save(p));
});

test("renderers include the right nodes", () => {
  const p = overrideDecision(stems(), "split", 0);
  const tree = toTree(p);
  assert.match(tree, /Run the model on some audio \(docs\)/);
  assert.match(tree, /your change/);
  assert.doesNotMatch(tree, /Send the song/);
  const m = toMermaid(p);
  assert.match(m, /^flowchart TB/);
  assert.match(m, /subgraph n_s_lib\["Model runtime library"\]/);
  assert.match(m, /n_l1 -->\|"Loaded model"\| n_l2/);
});

test("the decision ledger lists every AI choice with its review state", () => {
  let p = acceptSuggestion(stems(), "split", "bleed");
  p = overrideDecision(p, "split", 0);
  p = acceptDecision(p, "load");
  const L = ledger(p);
  const byNode = (id: string) => L.find(e => e.node === id && e.type === "decision");
  assert.equal(byNode("split")?.review, "overridden");
  assert.equal(byNode("load")?.review, "accepted");
  assert.equal(byNode("save")?.review, "open");
  assert.equal(L.find(e => e.type === "addition" && e.node === "bleed")?.review, "accepted", "accepted suggestion counts as reviewed");
  assert.equal(L.find(e => e.node === "s-lib")?.review, "open");
  assert.equal(ledger(reviewPart(p, "s-lib")).find(e => e.node === "s-lib")?.review, "accepted");
  assert.throws(() => reviewPart(p, "load"), OpError);
  assert.ok(!L.some(e => e.node === "s-up"), "choices on parts that no longer exist drop out");

  let q = answer(store(), "idea", "platform", "web");
  q = skip(q, "site", "buyers");
  assert.ok(ledger(q).some(e => e.type === "default" && e.what.includes("Everyday shoppers")));
});

test("level of detail folds deeper layers so you never have to reach code", () => {
  const p = overrideDecision(stems(), "split", 0);
  const top = toTree(p, { maxDepth: 1 });
  assert.match(top, /Split into stems .*\(\+8 more detailed\)/);
  assert.doesNotMatch(top, /Run the model on some audio/);
  const m = toMermaid(p, { maxDepth: 1 });
  assert.doesNotMatch(m, /n_l1/);
  assert.doesNotMatch(m, /n_split -->\|"Model file"\| n_split/, "edges inside a folded node disappear");
  assert.match(m, /n_load -->\|"The song"\| n_split/);
});
