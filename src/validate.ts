import { isSkipped, spawnSources } from "./graph.js";
import { FORMAT, type Project } from "./model.js";

export interface Issue {
  level: "error" | "warning";
  at: string;
  message: string;
}

/** Structural checks. A project with no "error" issues is safe for every other function. */
export function validate(p: Project): Issue[] {
  const out: Issue[] = [];
  const err = (at: string, message: string) => out.push({ level: "error", at, message });
  const warn = (at: string, message: string) => out.push({ level: "warning", at, message });

  if (p.format !== FORMAT) err("format", `Expected "${FORMAT}", got "${p.format}"`);
  if (!p.name) warn("name", "Project has no name");
  if (!Array.isArray(p.layers) || p.layers.length === 0) err("layers", "At least one layer name is required");
  if (!p.nodes || typeof p.nodes !== "object") { err("nodes", "Missing nodes"); return out; }
  if (!Array.isArray(p.edges)) err("edges", "Missing edges array");
  if (!Array.isArray(p.log)) err("log", "Missing log array");

  const root = p.nodes[p.root];
  if (!root) err("root", `Root "${p.root}" is not a node`);
  else if (root.parent !== null) err(`nodes.${p.root}`, "The root node must have parent null");

  for (const [key, n] of Object.entries(p.nodes)) {
    const at = `nodes.${key}`;
    if (n.id !== key) err(at, `Node id "${n.id}" does not match its key`);
    if (!n.title) err(at, "Node has no title");
    if (!["user", "ai", "doc"].includes(n.author)) err(at, `Unknown author "${n.author}"`);
    if (key !== p.root) {
      if (n.parent === null) err(at, "Only the root may have no parent");
      else if (!p.nodes[n.parent]) err(at, `Parent "${n.parent}" does not exist`);
    }
    // Containment must be a tree.
    const seen = new Set([key]);
    for (let c = n.parent; c; c = p.nodes[c]?.parent ?? null) {
      if (seen.has(c)) { err(at, "Parent chain loops back on itself"); break; }
      seen.add(c);
    }

    const qids = new Set<string>();
    for (const q of n.questions ?? []) {
      const qa = `${at}.questions.${q.id}`;
      if (qids.has(q.id)) err(qa, "Duplicate question id");
      qids.add(q.id);
      if (q.kind === "ask" && !q.default) warn(qa, "An ordinary question should say what the AI does if skipped (default)");
      if (q.kind === "must" && !q.why) warn(qa, "A must-decide question should say why it is the person's call (why)");
      if (q.type !== "text" && !q.options?.length) err(qa, "Choice question has no options");
      if (q.type === "text" && q.options?.length) warn(qa, "Text question has options; they are ignored");
      const vals = new Set<string>();
      for (const o of q.options ?? []) { if (vals.has(o.value)) err(qa, `Duplicate option "${o.value}"`); vals.add(o.value); }
      if (q.showIf && !(n.questions ?? []).some(x => x.id === q.showIf)) err(qa, `showIf refers to unknown question "${q.showIf}"`);
      const a = q.answer;
      if (a !== undefined) {
        if (isSkipped(a)) { if (q.kind === "must") err(qa, "A must-decide question cannot be skipped"); }
        else if (q.type === "text") { if (typeof a !== "string") err(qa, "Text answer must be a string"); }
        else {
          const arr = Array.isArray(a) ? a : [a];
          if (q.type === "single" && Array.isArray(a)) err(qa, "Single-choice answer must be one value");
          arr.filter(v => !vals.has(v)).forEach(v => err(qa, `Answer "${v}" is not an option`));
        }
      }
    }
    const sids = new Set<string>();
    for (const s of n.suggestions ?? []) {
      if (sids.has(s.id)) err(`${at}.suggestions.${s.id}`, "Duplicate suggestion id");
      sids.add(s.id);
    }
    const d = n.decision;
    if (d) {
      if (!d.why) warn(`${at}.decision`, "An AI decision should explain itself (why)");
      if (d.state === "overridden" && (d.chosen === undefined || !d.alternatives[d.chosen]))
        err(`${at}.decision`, "Overridden decision must point at an existing alternative (chosen)");
    }
  }

  for (const [target, srcs] of spawnSources(p)) {
    if (!p.nodes[target]) srcs.forEach(s => err(`nodes.${s.node}`, `Spawns unknown node "${target}"`));
    if (target === p.root) err(`nodes.${target}`, "The root cannot be spawned");
  }

  (p.edges ?? []).forEach((e, i) => {
    if (!p.nodes[e.from]) err(`edges.${i}`, `Unknown node "${e.from}"`);
    if (!p.nodes[e.to]) err(`edges.${i}`, `Unknown node "${e.to}"`);
    if (e.from === e.to) err(`edges.${i}`, "An edge cannot connect a node to itself");
  });
  return out;
}

export class ValidationError extends Error {
  constructor(public issues: Issue[]) {
    super("Invalid abstractCORE project:\n" + issues.map(i => `  ${i.at}: ${i.message}`).join("\n"));
  }
}

/** Parse and validate a project from JSON text or a plain object. Throws on errors. */
export function load(input: string | unknown): Project {
  const p = (typeof input === "string" ? JSON.parse(input) : structuredClone(input)) as Project;
  p.edges ??= [];
  p.log ??= [];
  const errors = validate(p).filter(i => i.level === "error");
  if (errors.length) throw new ValidationError(errors);
  return p;
}

export const save = (p: Project): string => JSON.stringify(p, null, 2) + "\n";
