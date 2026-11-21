import { activeIds, chosenOptions, isAnswered, isSkipped, isVisible, spawnSources, walk } from "./graph.js";
import type { Author, Project, Question } from "./model.js";

export interface QuestionRef { node: string; question: Question }
export interface NeedRef { node: string; need: string }

export interface Status {
  /** Must-decide questions still waiting for the person. Nothing is built around these. */
  openMust: QuestionRef[];
  /** Must-decide questions the person has answered. */
  made: QuestionRef[];
  /** Ordinary questions not yet answered or skipped. */
  openAsk: QuestionRef[];
  /** Questions the person skipped, so the AI's stated default applies. */
  defaults: QuestionRef[];
  /** AI decisions nobody has reviewed yet. */
  openDecisions: string[];
  /** AI decisions the person overrode. */
  overridden: string[];
  openSuggestions: { node: string; suggestion: string }[];
  /** Everything the current choices add up to, de-duplicated, in graph order. */
  needs: NeedRef[];
  /** How many existing nodes each author contributed. */
  ownership: Record<Author, number>;
  /** Share of must-decide questions answered, 0..1 (1 when there are none). */
  progress: number;
  /** True when no must-decide question is open: safe to build. */
  ready: boolean;
}

export function status(p: Project): Status {
  const active = activeIds(p);
  const s: Status = {
    openMust: [], made: [], openAsk: [], defaults: [], openDecisions: [], overridden: [],
    openSuggestions: [], needs: [], ownership: { user: 0, ai: 0, doc: 0 }, progress: 1, ready: true,
  };
  const seen = new Set<string>();
  const need = (node: string, n: string) => { if (!seen.has(n)) { seen.add(n); s.needs.push({ node, need: n }); } };

  for (const { id } of walk(p, active)) {
    const n = p.nodes[id];
    s.ownership[n.author]++;
    (n.needs ?? []).forEach(x => need(id, x));
    for (const q of n.questions ?? []) {
      if (!isVisible(n, q)) continue;
      const ref = { node: id, question: q };
      if (q.kind === "must") (isAnswered(q) ? s.made : s.openMust).push(ref);
      else if (isSkipped(q.answer)) s.defaults.push(ref);
      else if (!isAnswered(q)) s.openAsk.push(ref);
      chosenOptions(q).forEach(o => (o.needs ?? []).forEach(x => need(id, x)));
    }
    for (const sg of n.suggestions ?? []) {
      const st = sg.state ?? "open";
      if (st === "open") s.openSuggestions.push({ node: id, suggestion: sg.id });
      if (st === "accepted") (sg.needs ?? []).forEach(x => need(id, x));
    }
    const d = n.decision;
    if (d) {
      if (d.state === "open") s.openDecisions.push(id);
      if (d.state === "overridden") {
        s.overridden.push(id);
        const alt = d.chosen !== undefined ? d.alternatives[d.chosen] : undefined;
        (alt?.needs ?? []).forEach(x => need(id, x));
      }
    }
  }
  const total = s.made.length + s.openMust.length;
  s.progress = total ? s.made.length / total : 1;
  s.ready = s.openMust.length === 0;
  return s;
}

/** One thing the AI chose on the architect's behalf. */
export interface LedgerEntry {
  node: string;
  /**
   * "decision" – the AI picked an approach (reviewable, overridable).
   * "default"  – the person skipped a question, so the AI's default applies.
   * "addition" – the AI added a part the person never described.
   */
  type: "decision" | "default" | "addition";
  what: string;
  why?: string;
  /** "open" = not reviewed yet; "accepted"/"overridden" = the architect has ruled on it. */
  review: "open" | "accepted" | "overridden";
  alternatives?: string[];
}

/**
 * The decision ledger: every choice the AI has made in the current graph, in
 * one place, with its reasoning and whether the architect has reviewed it.
 * This is the high-level overview that lets a person stay in charge of a
 * system without reading its code.
 */
export function ledger(p: Project): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const sources = spawnSources(p);
  // A part that exists because the architect accepted a suggestion was already reviewed.
  const viaAcceptedSuggestion = (id: string) => (sources.get(id) ?? []).some(s =>
    s.type === "suggestion" && p.nodes[s.node]?.suggestions?.find(x => x.id === s.suggestion)?.state === "accepted");
  for (const { id } of walk(p)) {
    const n = p.nodes[id];
    if (n.author === "ai")
      out.push({ node: id, type: "addition", what: `Added "${n.title}"`, why: n.description,
                 review: n.reviewed || viaAcceptedSuggestion(id) ? "accepted" : "open" });
    for (const q of n.questions ?? [])
      if (isVisible(n, q) && isSkipped(q.answer))
        out.push({ node: id, type: "default", what: `${q.text} → ${q.default ?? "AI default"}`, review: "accepted" });
    const d = n.decision;
    if (d)
      out.push({ node: id, type: "decision", why: d.why, review: d.state,
                 what: d.state === "overridden" && d.chosen !== undefined
                   ? `AI proposed: ${d.text} → you chose: ${d.alternatives[d.chosen]?.label}`
                   : d.text,
                 alternatives: d.alternatives.map(a => a.label) });
  }
  return out;
}

/**
 * The next question to put to the person: broadest layer first, so each
 * answer can open up the more specific parts beneath it.
 */
export function nextQuestion(p: Project): QuestionRef | null {
  const order = walk(p).map((x, i) => ({ ...x, i })).sort((a, b) => a.depth - b.depth || a.i - b.i);
  for (const { id } of order) {
    const n = p.nodes[id];
    for (const q of n.questions ?? []) if (isVisible(n, q) && !isAnswered(q)) return { node: id, question: q };
  }
  return null;
}
