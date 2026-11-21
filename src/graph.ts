import type { Answer, GraphNode, Option, Project, Question } from "./model.js";

/** Where a conditional node gets its existence from. */
export type SpawnSource =
  | { type: "option"; node: string; question: string; value: string }
  | { type: "suggestion"; node: string; suggestion: string }
  | { type: "decision"; node: string; alternative: number | null }; // null = the AI's own choice

/** Map of node id → every choice that can bring it into existence. */
export function spawnSources(p: Project): Map<string, SpawnSource[]> {
  const out = new Map<string, SpawnSource[]>();
  const add = (target: string, s: SpawnSource) => {
    const list = out.get(target);
    if (list) list.push(s); else out.set(target, [s]);
  };
  for (const n of Object.values(p.nodes)) {
    for (const q of n.questions ?? [])
      for (const o of q.options ?? [])
        for (const t of o.spawns ?? []) add(t, { type: "option", node: n.id, question: q.id, value: o.value });
    for (const s of n.suggestions ?? [])
      for (const t of s.spawns ?? []) add(t, { type: "suggestion", node: n.id, suggestion: s.id });
    if (n.decision) {
      for (const t of n.decision.spawns ?? []) add(t, { type: "decision", node: n.id, alternative: null });
      n.decision.alternatives.forEach((a, i) => {
        for (const t of a.spawns ?? []) add(t, { type: "decision", node: n.id, alternative: i });
      });
    }
  }
  return out;
}

export const isSkipped = (a: Answer | undefined): a is { skipped: true } =>
  typeof a === "object" && a !== null && !Array.isArray(a) && a.skipped === true;

/** True when the question has a real answer or was deliberately skipped. */
export function isAnswered(q: Question): boolean {
  const a = q.answer;
  if (a === undefined) return false;
  if (isSkipped(a)) return true;
  if (Array.isArray(a)) return a.length > 0;
  return a.trim().length > 0;
}

export function isVisible(node: GraphNode, q: Question): boolean {
  if (!q.showIf) return true;
  const dep = node.questions?.find(x => x.id === q.showIf);
  return !!dep && isAnswered(dep) && !isSkipped(dep.answer);
}

/** The options currently chosen for a question (empty when skipped or text). */
export function chosenOptions(q: Question): Option[] {
  const a = q.answer;
  if (!q.options || a === undefined || isSkipped(a)) return [];
  const vals = Array.isArray(a) ? a : [a];
  return q.options.filter(o => vals.includes(o.value));
}

/** Does this one source currently fire? (Ignores whether its owner node is active.) */
function fires(p: Project, s: SpawnSource): boolean {
  const owner = p.nodes[s.node];
  if (!owner) return false;
  switch (s.type) {
    case "option": {
      const q = owner.questions?.find(x => x.id === s.question);
      return !!q && isVisible(owner, q) && chosenOptions(q).some(o => o.value === s.value);
    }
    case "suggestion":
      return owner.suggestions?.find(x => x.id === s.suggestion)?.state === "accepted";
    case "decision": {
      const d = owner.decision;
      if (!d) return false;
      return s.alternative === null
        ? d.state !== "overridden"
        : d.state === "overridden" && d.chosen === s.alternative;
    }
  }
}

/**
 * The set of nodes that currently exist. A node exists when its parent exists
 * and, if it is conditional, at least one choice that spawns it is in effect
 * on a node that itself exists.
 */
export function activeIds(p: Project): Set<string> {
  const sources = spawnSources(p);
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const active = (id: string): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const n = p.nodes[id];
    if (!n || visiting.has(id)) return false; // missing or cyclic: never active
    visiting.add(id);
    let ok = id === p.root || (n.parent !== null && active(n.parent));
    const src = sources.get(id);
    if (ok && src) ok = src.some(s => fires(p, s) && active(s.node));
    visiting.delete(id);
    memo.set(id, ok);
    return ok;
  };
  const out = new Set<string>();
  for (const id of Object.keys(p.nodes)) if (active(id)) out.add(id);
  return out;
}

/** Active children of a node, in file order. */
export function children(p: Project, id: string, active = activeIds(p)): string[] {
  return Object.values(p.nodes).filter(n => n.parent === id && active.has(n.id)).map(n => n.id);
}

/** Ancestors from the root down to (not including) the node. */
export function pathTo(p: Project, id: string): string[] {
  const out: string[] = [];
  let cur = p.nodes[id]?.parent ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) { seen.add(cur); out.unshift(cur); cur = p.nodes[cur]?.parent ?? null; }
  return out;
}

export const depth = (p: Project, id: string): number => pathTo(p, id).length;

export function layerName(p: Project, id: string): string {
  const d = depth(p, id);
  return p.layers[Math.min(d, p.layers.length - 1)] ?? `Layer ${d}`;
}

/** Active nodes depth-first from the root, with their depth. */
export function walk(p: Project, active = activeIds(p)): { id: string; depth: number }[] {
  const out: { id: string; depth: number }[] = [];
  const go = (id: string, d: number) => { out.push({ id, depth: d }); for (const c of children(p, id, active)) go(c, d + 1); };
  if (active.has(p.root)) go(p.root, 0);
  return out;
}

/** Flow edges whose two ends both exist. */
export function activeEdges(p: Project, active = activeIds(p)) {
  return p.edges.filter(e => active.has(e.from) && active.has(e.to));
}
