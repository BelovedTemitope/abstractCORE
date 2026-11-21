import { isVisible } from "./graph.js";
import type { GraphNode, LogEntry, Project, Question } from "./model.js";

/**
 * Every operation returns a new project and never mutates its input, so a
 * history of projects is a free undo stack. Each change is also logged, so
 * the project carries an audit trail of who decided what.
 */
export interface OpOptions { now?: () => string }

export class OpError extends Error {}

function edit(p: Project, nodeId: string, opts: OpOptions, action: LogEntry["action"], detail: string,
              fn: (n: GraphNode) => void): Project {
  if (!p.nodes[nodeId]) throw new OpError(`Unknown node "${nodeId}"`);
  const next = structuredClone(p);
  fn(next.nodes[nodeId]);
  next.log.push({ at: (opts.now ?? (() => new Date().toISOString()))(), node: nodeId, action, detail });
  return next;
}

function getNode(p: Project, id: string): GraphNode {
  const n = p.nodes[id];
  if (!n) throw new OpError(`Unknown node "${id}"`);
  return n;
}

function findQ(n: GraphNode, qid: string): Question {
  const q = n.questions?.find(x => x.id === qid);
  if (!q) throw new OpError(`Node "${n.id}" has no question "${qid}"`);
  if (!isVisible(n, q)) throw new OpError(`Question "${qid}" is not shown yet (it depends on "${q.showIf}")`);
  return q;
}

/**
 * Answer a question. Single: an option value. Multi: an array of option values.
 * Text: any string. An empty answer clears the question.
 */
export function answer(p: Project, nodeId: string, qid: string, value: string | string[], opts: OpOptions = {}): Project {
  const empty = Array.isArray(value) ? value.length === 0 : value.trim() === "";
  if (empty) return unanswer(p, nodeId, qid, opts);
  const q = findQ(getNode(p, nodeId), qid);
  if (q.type === "text") {
    if (typeof value !== "string") throw new OpError(`"${qid}" takes text`);
  } else {
    const vals = Array.isArray(value) ? value : [value];
    if (q.type === "single" && vals.length !== 1) throw new OpError(`"${qid}" takes exactly one option`);
    const bad = vals.filter(v => !q.options?.some(o => o.value === v));
    if (bad.length) throw new OpError(`"${qid}" has no option ${bad.map(b => `"${b}"`).join(", ")}`);
  }
  const stored = q.type === "multi" ? [...new Set(Array.isArray(value) ? value : [value])] : (Array.isArray(value) ? value[0] : value.trim());
  return edit(p, nodeId, opts, "answer", `${qid} = ${JSON.stringify(stored)}`, n => { findQ(n, qid).answer = stored; });
}

/** Toggle one option of a multi-choice question. */
export function toggle(p: Project, nodeId: string, qid: string, value: string, opts: OpOptions = {}): Project {
  const q = findQ(getNode(p, nodeId), qid);
  if (q.type !== "multi") throw new OpError(`"${qid}" is not multi-choice`);
  const cur = Array.isArray(q.answer) ? q.answer : [];
  return answer(p, nodeId, qid, cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value], opts);
}

/** Skip an ordinary question: the AI's stated default applies, and that is recorded. */
export function skip(p: Project, nodeId: string, qid: string, opts: OpOptions = {}): Project {
  const q = findQ(getNode(p, nodeId), qid);
  if (q.kind === "must") throw new OpError(`"${qid}" is yours to decide; it cannot be skipped`);
  return edit(p, nodeId, opts, "skip", `${qid} → default: ${q.default ?? ""}`, n => { findQ(n, qid).answer = { skipped: true }; });
}

export function unanswer(p: Project, nodeId: string, qid: string, opts: OpOptions = {}): Project {
  return edit(p, nodeId, opts, "unanswer", qid, n => { delete findQ(n, qid).answer; });
}

function sugg(p: Project, nodeId: string, sid: string, state: "accepted" | "dismissed" | "open", opts: OpOptions) {
  const action = state === "accepted" ? "accept-suggestion" : "dismiss-suggestion";
  return edit(p, nodeId, opts, action, `${sid} → ${state}`, n => {
    const s = n.suggestions?.find(x => x.id === sid);
    if (!s) throw new OpError(`Node "${nodeId}" has no suggestion "${sid}"`);
    s.state = state;
  });
}
export const acceptSuggestion = (p: Project, node: string, sid: string, o: OpOptions = {}) => sugg(p, node, sid, "accepted", o);
export const dismissSuggestion = (p: Project, node: string, sid: string, o: OpOptions = {}) => sugg(p, node, sid, "dismissed", o);
export const resetSuggestion = (p: Project, node: string, sid: string, o: OpOptions = {}) => sugg(p, node, sid, "open", o);

function needDecision(n: GraphNode) {
  if (!n.decision) throw new OpError(`Node "${n.id}" has no AI decision`);
  return n.decision;
}

/** Agree with the AI's choice. */
export function acceptDecision(p: Project, nodeId: string, opts: OpOptions = {}): Project {
  return edit(p, nodeId, opts, "accept-decision", p.nodes[nodeId]?.decision?.text ?? "", n => {
    const d = needDecision(n); d.state = "accepted"; delete d.chosen;
  });
}

/** Replace the AI's choice with one of its alternatives. Nodes it spawned give way to the alternative's. */
export function overrideDecision(p: Project, nodeId: string, alternative: number, opts: OpOptions = {}): Project {
  const alt = p.nodes[nodeId]?.decision?.alternatives[alternative];
  return edit(p, nodeId, opts, "override-decision", alt?.label ?? "", n => {
    const d = needDecision(n);
    if (!d.alternatives[alternative]) throw new OpError(`Decision on "${nodeId}" has no alternative ${alternative}`);
    d.state = "overridden"; d.chosen = alternative;
  });
}

/** Put a decision back to the AI's original, unreviewed choice. */
export function reopenDecision(p: Project, nodeId: string, opts: OpOptions = {}): Project {
  return edit(p, nodeId, opts, "reopen-decision", "", n => { const d = needDecision(n); d.state = "open"; delete d.chosen; });
}

/** The text that currently stands for a decision: the AI's, or the person's chosen alternative. */
export function decisionText(n: GraphNode): string | undefined {
  const d = n.decision;
  if (!d) return undefined;
  if (d.state === "overridden" && d.chosen !== undefined) {
    const a = d.alternatives[d.chosen];
    return a?.text ?? a?.label;
  }
  return d.text;
}

/** Mark a part the AI added as reviewed (kept by the architect), or undo that. */
export function reviewPart(p: Project, nodeId: string, reviewed = true, opts: OpOptions = {}): Project {
  return edit(p, nodeId, opts, "review-part", reviewed ? "kept" : "unreviewed", n => {
    if (n.author !== "ai") throw new OpError(`"${nodeId}" was not added by the AI`);
    if (reviewed) n.reviewed = true; else delete n.reviewed;
  });
}
