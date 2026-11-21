/**
 * abstractCORE project model.
 *
 * A project is one graph of nodes nested in layers of abstraction
 * (idea → core parts → behaviour → functions), connected by labelled
 * flow edges. Some nodes are conditional: they only exist once a choice
 * "spawns" them (an answer, an accepted suggestion, or an AI decision).
 */

export const FORMAT = "abstractcore/0.1" as const;

/** Who put something into the graph. */
export type Author = "user" | "ai" | "doc";

/** What a node stands for. */
export type NodeKind =
  | "idea"       // something the person described
  | "component"  // a part of the system
  | "external"   // someone else's service or library: we only see what it offers
  | "function";  // a unit that does work, usually with code

export interface Project {
  format: typeof FORMAT;
  name: string;
  /** Display names for each depth, broad to specific. */
  layers: string[];
  root: string;
  nodes: Record<string, GraphNode>;
  edges: Edge[];
  /** Append-only record of every change of ownership: answers, skips, overrides. */
  log: LogEntry[];
}

export interface GraphNode {
  id: string;
  parent: string | null;
  title: string;
  description?: string;
  author: Author;
  kind?: NodeKind;
  /** An AI decision made on the person's behalf, which they can accept or override. */
  decision?: Decision;
  questions?: Question[];
  suggestions?: Suggestion[];
  /** Requirements this node brings with it just by existing. */
  needs?: string[];
  code?: { lang: string; source: string };
  /** For parts the AI added: the architect has looked at it and kept it. */
  reviewed?: boolean;
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
}

/**
 * "must" – only the person can answer; nothing is built around the gap.
 * "ask"  – helps the AI; skipping applies `default` and records it.
 */
export type QuestionKind = "must" | "ask";
export type QuestionType = "single" | "multi" | "text";

export type Answer = string | string[] | { skipped: true };

export interface Question {
  id: string;
  kind: QuestionKind;
  type: QuestionType;
  text: string;
  hint?: string;
  /** Why this belongs to the person rather than the AI. */
  why?: string;
  /** What the AI uses if the question is skipped ("ask" only). */
  default?: string;
  options?: Option[];
  /** Only shown once this sibling question has a real (non-skipped) answer. */
  showIf?: string;
  answer?: Answer;
}

export interface Option {
  value: string;
  label: string;
  note?: string;
  /** Requirements that follow from choosing this. */
  needs?: string[];
  /** Node ids that come into existence when this is chosen. */
  spawns?: string[];
}

export type SuggestionState = "open" | "accepted" | "dismissed";

export interface Suggestion {
  id: string;
  text: string;
  why: string;
  needs?: string[];
  spawns?: string[];
  state?: SuggestionState;
}

/**
 * "open"       – the AI chose; the person hasn't looked yet.
 * "accepted"   – the person agreed with the AI's choice.
 * "overridden" – the person picked an alternative.
 */
export type DecisionState = "open" | "accepted" | "overridden";

export interface Decision {
  state: DecisionState;
  /** The AI's choice. */
  text: string;
  /** The AI's reasoning, including trade-offs. */
  why: string;
  /** Nodes that exist while the AI's choice stands. */
  spawns?: string[];
  alternatives: Alternative[];
  /** Index into `alternatives` when overridden. */
  chosen?: number;
}

export interface Alternative {
  label: string;
  text?: string;
  spawns?: string[];
  needs?: string[];
}

export interface LogEntry {
  at: string;
  node: string;
  action: "answer" | "skip" | "unanswer" | "accept-suggestion" | "dismiss-suggestion"
        | "accept-decision" | "override-decision" | "reopen-decision" | "review-part";
  detail: string;
}
