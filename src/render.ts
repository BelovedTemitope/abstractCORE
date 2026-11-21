import { activeEdges, activeIds, children, walk } from "./graph.js";
import type { GraphNode, Project } from "./model.js";
import { decisionText } from "./ops.js";
import { ledger, status } from "./status.js";

/**
 * Level of detail. maxDepth 0 shows only the idea; 1 adds the core parts; and
 * so on. Anything deeper is folded into its ancestor, so the architect can
 * work at the level they choose and never has to reach the code.
 */
export interface ViewOptions { maxDepth?: number }

const AUTHOR_MARK = { user: "you", ai: "AI", doc: "docs" } as const;

function badges(n: GraphNode): string {
  const b: string[] = [];
  const must = (n.questions ?? []).filter(q => q.kind === "must" && q.answer === undefined).length;
  if (must) b.push(`${must} to decide`);
  if (n.decision) b.push(n.decision.state === "overridden" ? "your change" : n.decision.state === "accepted" ? "AI decision ✓" : "AI decision");
  return b.length ? `  [${b.join(", ")}]` : "";
}

/** An indented outline of the layered graph, broad to specific. */
export function toTree(p: Project, view: ViewOptions = {}): string {
  const max = view.maxDepth ?? Infinity;
  const active = activeIds(p);
  return walk(p, active).filter(x => x.depth <= max).map(({ id, depth }) => {
    const n = p.nodes[id];
    const pad = depth === 0 ? "" : "  ".repeat(depth - 1) + "└ ";
    const dec = n.decision ? `\n${"  ".repeat(depth + 1)}↳ ${decisionText(n)}` : "";
    const hidden = foldedNote(p, id, depth, max, active);
    return `${pad}${n.title} (${AUTHOR_MARK[n.author]})${badges(n)}${hidden}${dec}`;
  }).join("\n");
}

/** "  (+3 more detailed)" when a node's children are folded away by the level of detail. */
function foldedNote(p: Project, id: string, depth: number, max: number, active: Set<string>): string {
  if (depth < max) return "";
  let count = 0;
  const go = (n: string) => children(p, n, active).forEach(c => { count++; go(c); });
  go(id);
  return count ? `  (+${count} more detailed)` : "";
}

const mq = (s: string) => s.replace(/"/g, "#quot;").replace(/[\[\]{}<>]/g, " ");

/**
 * Mermaid flowchart: nodes with children become nested subgraphs (layers of
 * abstraction), labelled arrows are data flow. Renders on GitHub as-is.
 */
export function toMermaid(p: Project, view: ViewOptions = {}): string {
  const active = activeIds(p);
  const max = view.maxDepth ?? Infinity;
  // Fold: anything deeper than max is represented by its ancestor at depth max.
  const shown = new Map<string, string>();
  for (const { id, depth } of walk(p, active)) {
    const n = p.nodes[id];
    shown.set(id, depth <= max ? id : shown.get(n.parent!)!);
  }
  const lines = ["flowchart TB"];
  const id = (s: string) => "n_" + s.replace(/[^A-Za-z0-9_]/g, "_");
  const emit = (nid: string, ind: string, d: number) => {
    const n = p.nodes[nid];
    const kids = d < max ? children(p, nid, active) : [];
    if (kids.length) {
      lines.push(`${ind}subgraph ${id(nid)}["${mq(n.title)}"]`);
      kids.forEach(k => emit(k, ind + "  ", d + 1));
      lines.push(`${ind}end`);
    } else {
      lines.push(`${ind}${id(nid)}["${mq(n.title)}"]`);
    }
    lines.push(`${ind}class ${id(nid)} ${n.author}`);
  };
  emit(p.root, "  ", 0);
  const seen = new Set<string>();
  for (const e of activeEdges(p, active)) {
    const from = shown.get(e.from)!, to = shown.get(e.to)!;
    const key = `${from}>${to}>${e.label ?? ""}`;
    if (from === to || seen.has(key)) continue; // folded inside one node
    seen.add(key);
    lines.push(`  ${id(from)} -->${e.label ? `|"${mq(e.label)}"|` : ""} ${id(to)}`);
  }
  lines.push("  classDef user fill:#E1ECE7,stroke:#2F5D50,color:#1F2A24");
  lines.push("  classDef ai fill:#ECEDFB,stroke:#4B55C4,stroke-dasharray:4 3,color:#1F2A24");
  lines.push("  classDef doc fill:#F5F7F4,stroke:#9DAAA2,color:#1F2A24");
  return lines.join("\n");
}

/** Every choice the AI made, grouped by whether the architect has reviewed it. */
export function toLedgerText(p: Project): string {
  const L = ledger(p);
  if (!L.length) return "The AI has made no choices in this graph.";
  const mark = { open: "○ to review", accepted: "✓ accepted", overridden: "↺ you changed it" } as const;
  const type = { decision: "Decision", default: "Default", addition: "Added part" } as const;
  return L.map(e => {
    const lines = [`${mark[e.review].padEnd(17)} ${type[e.type]} · ${p.nodes[e.node].title}`, `    ${e.what}`];
    if (e.why) lines.push(`    why: ${e.why}`);
    if (e.alternatives?.length) lines.push(`    alternatives: ${e.alternatives.join(" | ")}`);
    return lines.join("\n");
  }).join("\n");
}

/** A plain-language summary of where the project stands. */
export function toStatusText(p: Project): string {
  const s = status(p);
  const title = (id: string) => p.nodes[id].title;
  const out: string[] = [];
  out.push(`${p.name}`);
  out.push(`${s.made.length} of ${s.made.length + s.openMust.length} decisions made` + (s.ready ? " – ready to build" : ""));
  out.push(`Nodes: ${s.ownership.user} yours, ${s.ownership.ai} filled in by the AI, ${s.ownership.doc} from docs`);
  if (s.openMust.length) {
    out.push("", "Still needs you (the AI will not guess these):");
    s.openMust.forEach(r => out.push(`  • ${r.question.text}  — ${title(r.node)}`));
  }
  if (s.openDecisions.length) {
    out.push("", "AI decisions to review:");
    s.openDecisions.forEach(id => out.push(`  • ${title(id)}: ${p.nodes[id].decision!.text}`));
  }
  const L = ledger(p);
  const reviewed = L.filter(e => e.review !== "open").length;
  out.push("", `Decision ledger: ${L.length} AI choices, ${reviewed} reviewed by you (acore ledger for details)`);
  if (s.defaults.length) {
    out.push("", "Left to the AI's defaults:");
    s.defaults.forEach(r => out.push(`  • ${r.question.text} → ${r.question.default}`));
  }
  out.push("", "You will need:");
  if (s.needs.length) s.needs.forEach(n => out.push(`  • ${n.need}  (${title(n.node)})`));
  else out.push("  nothing yet");
  return out.join("\n");
}
