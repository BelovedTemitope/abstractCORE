// abstractCORE architect demo. Every state change goes through the real engine
// in ../src; this file only draws it. Built with `npm run demo` into app.js.
import * as A from "../src/index.js";
import type { GraphNode, Project, Question } from "../src/index.js";
import storeJson from "../examples/clothing-store.acore.json";
import stemsJson from "../examples/stem-splitter.acore.json";

const EXAMPLES: Record<string, { label: string; data: unknown }> = {
  stems: { label: "Stem separation tool", data: stemsJson },
  store: { label: "Online clothing store", data: storeJson },
};

let exampleKey = new URLSearchParams(location.search).get("example") === "store" ? "store" : "stems";
let history: Project[] = [];
let P: Project;
let sel: string;
let tab: "node" | "ledger" | "needs" = "node";
let detail = 1;          // how deep the architect is looking: 0 = idea … layers.length-1 = functions/code
let showCode = false;    // code is opt-in, never the default
let ledgerFilter: "open" | "all" = "open";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const WHO: Record<string, string> = { user: "You", ai: "AI", doc: "Docs" };

function start(key: string) {
  exampleKey = key;
  P = A.load(EXAMPLES[key].data);
  history = [];
  sel = P.root;
  detail = 1; showCode = false; tab = "node";
  render();
}

function apply(fn: (p: Project) => Project) {
  try {
    const next = fn(P);
    history.push(P);
    P = next;
    if (!A.activeIds(P).has(sel)) sel = P.root;
    render();
  } catch (e) {
    toast((e as Error).message);
  }
}

function toast(msg: string) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout((toast as any).h); (toast as any).h = setTimeout(() => (t.hidden = true), 3200);
}

/* ---------------- Graph (left) ---------------- */
function graphHTML(): string {
  const active = A.activeIds(P);
  const edges = A.activeEdges(P, active);
  const max = detail;
  const count = (id: string): number => A.children(P, id, active).reduce((n, c) => n + 1 + count(c), 0);
  const nodeHTML = (id: string, d: number): string => {
    const n = P.nodes[id];
    const kids = A.children(P, id, active);
    const folded = d >= max && kids.length ? count(id) : 0;
    const mustOpen = (n.questions ?? []).filter(q => q.kind === "must" && A.isVisible(n, q) && !A.isAnswered(q)).length;
    const dec = n.decision;
    const chips: string[] = [];
    if (mustOpen) chips.push(`<span class="chip must">${mustOpen} to decide</span>`);
    if (dec) chips.push(dec.state === "open" ? `<span class="chip dec">AI decision · review</span>`
      : dec.state === "accepted" ? `<span class="chip ok">AI decision ✓</span>` : `<span class="chip mine">Your change</span>`);
    if (n.code && showCode && d <= max) chips.push(`<span class="chip code">has code</span>`);
    const out = edges.filter(e => e.from === id).map(e =>
      `<span class="flow">→ ${esc(P.nodes[e.to].title)}${e.label ? ` <i>${esc(e.label)}</i>` : ""}</span>`).join("");
    let h = `<div class="gnode d${Math.min(d, 3)} by-${n.author}${sel === id ? " sel" : ""}">
      <button class="gcard" data-act="sel" data-id="${id}">
        <span class="meta">${esc(A.layerName(P, id))} · ${WHO[n.author]}</span>
        <span class="ttl">${esc(n.title)}</span>
        ${dec && d <= max ? `<span class="dtext">${esc(A.decisionText(n))}</span>` : ""}
        ${chips.length ? `<span class="chips">${chips.join("")}</span>` : ""}
        ${out ? `<span class="flows">${out}</span>` : ""}
      </button>`;
    if (folded) h += `<button class="fold" data-act="deeper">+ ${folded} more detailed part${folded > 1 ? "s" : ""} — look deeper</button>`;
    else if (kids.length) h += `<div class="kids">${kids.map(k => nodeHTML(k, d + 1)).join("")}</div>`;
    return h + "</div>";
  };
  return nodeHTML(P.root, 0);
}

/* ---------------- Panel (right) ---------------- */
function qHTML(n: GraphNode, q: Question): string {
  const done = A.isAnswered(q), skipped = A.isSkipped(q.answer);
  let h = `<section class="q ${q.kind}${done ? " done" : ""}" id="q-${q.id}"><div class="qlabel">${q.kind === "must"
    ? `<span class="pill must">You must decide</span>` : `<span class="pill">Question</span>`}${done && !skipped ? `<span class="okt">✓ Answered</span>` : ""}</div>
    <h3>${esc(q.text)}</h3>${q.hint ? `<p class="muted">${esc(q.hint)}</p>` : ""}
    ${q.why ? `<p class="muted"><b class="mustc">Why it is yours to decide:</b> ${esc(q.why)}</p>` : ""}`;
  if (q.type === "text") {
    h += `<textarea id="ta-${q.id}" rows="3">${esc(typeof q.answer === "string" ? q.answer : "")}</textarea>
      <button class="btn" data-act="text" data-id="${n.id}" data-q="${q.id}">${done ? "Update" : "Save"}</button>`;
  } else {
    const vals = Array.isArray(q.answer) ? q.answer : typeof q.answer === "string" ? [q.answer] : [];
    h += `<div class="opts">${q.options!.map(o => `<button class="opt ${q.type}" aria-pressed="${vals.includes(o.value)}"
      data-act="pick" data-id="${n.id}" data-q="${q.id}" data-v="${esc(o.value)}"><span class="mark"></span>
      <span><b>${esc(o.label)}</b>${o.note ? `<small>${esc(o.note)}</small>` : ""}${o.spawns?.length
        ? `<small class="grows">Adds ${o.spawns.length} part${o.spawns.length > 1 ? "s" : ""} to the graph</small>` : ""}</span></button>`).join("")}</div>`;
    const needs = A.chosenOptions(q).flatMap(o => o.needs ?? []);
    if (needs.length) h += `<div class="needsbox"><b>This means you will need</b><ul>${needs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  }
  if (q.kind === "ask") h += skipped
    ? `<p class="muted">Skipped. The AI uses: ${esc(q.default)} <button class="link" data-act="unskip" data-id="${n.id}" data-q="${q.id}">Answer instead</button></p>`
    : !done ? `<p class="muted">If you skip: ${esc(q.default)} <button class="link" data-act="skip" data-id="${n.id}" data-q="${q.id}">Skip and let the AI use this</button></p>` : "";
  return h + "</section>";
}

function decisionHTML(n: GraphNode): string {
  const d = n.decision!;
  const label = d.state === "open" ? "AI decision · not reviewed" : d.state === "accepted" ? "AI decision · you accepted" : "You changed the AI's decision";
  let h = `<section class="dcard ${d.state}"><div class="qlabel"><span class="pill dec">${label}</span></div>
    <h3>${esc(A.decisionText(n))}</h3>`;
  if (d.state === "overridden") h += `<p class="muted">The AI had proposed: ${esc(d.text)}</p>`;
  h += `<p class="muted"><b>AI's reasoning:</b> ${esc(d.why)}</p><div class="dbtns">`;
  if (d.state !== "accepted") h += `<button class="btn" data-act="accept" data-id="${n.id}">${d.state === "overridden" ? "Go back to the AI's choice" : "Accept"}</button>`;
  d.alternatives.forEach((a, i) => {
    if (d.state === "overridden" && d.chosen === i) return;
    h += `<button class="btn ghost" data-act="override" data-id="${n.id}" data-i="${i}">${esc(a.label)}${a.spawns?.length ? ` <small>(reshapes ${a.spawns.length} parts)</small>` : ""}</button>`;
  });
  if (d.state !== "open") h += `<button class="link" data-act="reopen" data-id="${n.id}">Mark as not reviewed</button>`;
  return h + "</div></section>";
}

function nodePanel(): string {
  const n = P.nodes[sel], active = A.activeIds(P);
  const path = A.pathTo(P, sel);
  let h = `<nav class="crumbs">${path.map(id => `<button class="link" data-act="sel" data-id="${id}">${esc(P.nodes[id].title)}</button> › `).join("")}</nav>
    <span class="meta">${esc(A.layerName(P, sel))} · added by ${WHO[n.author]}${n.kind ? ` · ${n.kind}` : ""}</span>
    <h2>${esc(n.title)}</h2><p class="muted">${esc(n.description)}</p>`;
  if (n.author === "ai") {
    const r = A.ledger(P).find(e => e.node === sel && e.type === "addition");
    h += `<div class="ainote">The AI added this part, so it is in your decision ledger. ${r?.review === "accepted"
      ? `<b>You kept it.</b>${n.reviewed ? ` <button class="link" data-act="review" data-id="${sel}" data-v="0">Mark as not reviewed</button>` : ""}`
      : `<button class="btn" data-act="review" data-id="${sel}" data-v="1">Keep it</button>`}</div>`;
  }
  if (n.needs?.length) h += `<div class="needsbox"><b>This part needs</b><ul>${n.needs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  if (n.decision) h += decisionHTML(n);
  (n.questions ?? []).forEach(q => { if (A.isVisible(n, q)) h += qHTML(n, q); });
  const sgs = (n.suggestions ?? []).filter(s => s.state !== "dismissed");
  if (sgs.length) {
    h += `<div class="sec">Ideas the AI noticed</div>`;
    sgs.forEach(s => {
      const acc = s.state === "accepted";
      h += `<section class="sg${acc ? " acc" : ""}"><div class="qlabel"><span class="pill sug">Suggestion · optional</span></div>
        <h3>${esc(s.text)}</h3><p class="muted">${esc(s.why)}</p>${acc
        ? `<p class="okt">✓ Added to your plan</p><button class="link" data-act="sugg" data-id="${n.id}" data-s="${s.id}" data-v="open">Remove it</button>`
        : `<div class="dbtns"><button class="btn" data-act="sugg" data-id="${n.id}" data-s="${s.id}" data-v="accepted">Add it</button>
           <button class="btn ghost" data-act="sugg" data-id="${n.id}" data-s="${s.id}" data-v="dismissed">No thanks</button></div>`}</section>`;
    });
  }
  const kids = A.children(P, sel, active);
  if (kids.length) h += `<div class="sec">Parts inside this</div><div class="parts">${kids.map(k =>
    `<button data-act="sel" data-id="${k}">${esc(P.nodes[k].title)}</button>`).join("")}</div>`;
  const nx = A.nextQuestion(P);
  const rv = nx ? undefined : A.ledger(P).find(e => e.review === "open");
  h += `<div class="nextbar"><button class="next" data-act="next">${nx
    ? `Next question${nx.node !== sel ? ` · ${esc(P.nodes[nx.node].title)}` : ""}`
    : rv ? `Review the next AI choice${rv.node !== sel ? ` · ${esc(P.nodes[rv.node].title)}` : ""}`
    : "Everything is answered and reviewed. See what it needs"}</button></div>`;
  if (n.code) {
    h += `<div class="sec">Code</div>`;
    h += showCode
      ? `<pre class="code"><code>${esc(n.code.source)}</code></pre><button class="link" data-act="code" data-v="0">Hide code</button>`
      : `<p class="muted">This part has code. You don't need to read it to make decisions here. <button class="link" data-act="code" data-v="1">Show code</button></p>`;
  }
  return h;
}

function ledgerPanel(): string {
  const L = A.ledger(P);
  const open = L.filter(e => e.review === "open");
  const list = ledgerFilter === "open" ? open : L;
  const typeLabel = { decision: "Decision", default: "Default", addition: "Added part" } as const;
  const rev = { open: "To review", accepted: "Accepted", overridden: "You changed it" } as const;
  let h = `<h2>Decision ledger</h2><p class="muted">Every choice the AI made on your behalf, in one place. You stay the architect:
    review any of them, change them, or leave them.</p>
    <div class="stat"><b>${L.length}</b> AI choices · <b>${L.length - open.length}</b> reviewed · <b>${open.length}</b> to review</div>
    <div class="seg"><button aria-pressed="${ledgerFilter === "open"}" data-act="lf" data-v="open">To review</button>
    <button aria-pressed="${ledgerFilter === "all"}" data-act="lf" data-v="all">All</button></div>`;
  if (!list.length) return h + `<p class="muted">${ledgerFilter === "open" ? "Nothing left to review." : "The AI has made no choices yet."}</p>`;
  return h + `<ul class="ledger">${list.map(e => `<li class="${e.review}"><button data-act="sel" data-id="${e.node}">
    <span class="lrow"><span class="pill ${e.type === "decision" ? "dec" : e.type === "addition" ? "sug" : ""}">${typeLabel[e.type]}</span>
    <span class="rv">${rev[e.review]}</span></span>
    <b>${esc(P.nodes[e.node].title)}</b><span>${esc(e.what)}</span>${e.why ? `<small>${esc(e.why)}</small>` : ""}</button></li>`).join("")}</ul>`;
}

function needsPanel(): string {
  const s = A.status(P);
  let h = `<h2>What it needs</h2><p class="muted">Everything your choices add up to, in plain language.</p>`;
  h += s.openMust.length
    ? `<div class="status red"><strong>${s.openMust.length} decision${s.openMust.length > 1 ? "s" : ""} still need you</strong>
       <p>Nothing gets built around a gap. These are the answers the AI will not guess.</p><ul class="jl">${s.openMust.map(r =>
       `<li><button data-act="sel" data-id="${r.node}">${esc(r.question.text)}<small>${esc(P.nodes[r.node].title)}</small></button></li>`).join("")}</ul></div>`
    : `<div class="status ok"><strong>Every must-decide question is answered.</strong><p>The plan is ready to build.</p></div>`;
  h += `<div class="sec">You will need</div>`;
  h += s.needs.length ? `<ul class="plain">${s.needs.map(n => `<li>${esc(n.need)} <small>${esc(P.nodes[n.node].title)}</small></li>`).join("")}</ul>`
    : `<p class="muted">Nothing yet. Make a few decisions and this fills in.</p>`;
  h += `<div class="sec">Who shaped the graph</div><p>${s.ownership.user} parts from you · ${s.ownership.ai} from the AI · ${s.ownership.doc} from library docs</p>`;
  h += `<div class="sec">Project file</div><p class="muted">The whole graph, every decision and the audit log are one JSON file.</p>
    <button class="btn ghost" data-act="download">Download .acore.json</button>`;
  return h;
}

/* ---------------- Frame ---------------- */
function render() {
  const s = A.status(P), L = A.ledger(P);
  const total = s.made.length + s.openMust.length;
  const toReview = L.filter(e => e.review === "open").length;
  $("#progress").innerHTML = (total ? `<b>${s.made.length}/${total}</b> your decisions` : "No decisions waiting on you")
    + ` · <b>${toReview}</b> AI choice${toReview === 1 ? "" : "s"} to review`;
  $("#undo").toggleAttribute("disabled", !history.length);
  $("#levels").innerHTML = P.layers.map((l, i) =>
    `<button aria-pressed="${i === detail}" data-act="level" data-v="${i}">${esc(l)}</button>`).join("");
  $("#codeToggle").setAttribute("aria-pressed", String(showCode));
  (document.getElementById("example") as HTMLSelectElement).value = exampleKey;
  const gs = $("#graph").scrollTop, ps = $("#panel").scrollTop;
  $("#graph").innerHTML = graphHTML();
  document.querySelectorAll<HTMLElement>(".tabs [data-v]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === tab)));
  $("#cMust").textContent = s.openMust.length ? String(s.openMust.length) : "";
  $("#cLedger").textContent = toReview ? String(toReview) : "";
  $("#panelBody").innerHTML = tab === "node" ? nodePanel() : tab === "ledger" ? ledgerPanel() : needsPanel();
  $("#graph").scrollTop = gs; $("#panel").scrollTop = ps;
}

document.addEventListener("click", e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!t) return;
  const { act, id = "", q = "", v = "" } = t.dataset;
  switch (act) {
    case "sel": sel = id; tab = "node"; render(); $("#panel").scrollTop = 0; break;
    case "tab": tab = v as typeof tab; render(); break;
    case "level": detail = Number(v); if (detail < P.layers.length - 1) showCode = false; render(); break;
    case "deeper": detail = Math.min(detail + 1, P.layers.length - 1); render(); break;
    case "code": showCode = v === "1"; if (showCode) detail = P.layers.length - 1; render(); break;
    case "pick": {
      const qq = P.nodes[id].questions!.find(x => x.id === q)!;
      if (qq.type === "multi") apply(p => A.toggle(p, id, q, v));
      else apply(p => (qq.answer === v ? A.unanswer(p, id, q) : A.answer(p, id, q, v)));
      break;
    }
    case "text": apply(p => A.answer(p, id, q, (document.getElementById("ta-" + q) as HTMLTextAreaElement).value)); break;
    case "skip": apply(p => A.skip(p, id, q)); break;
    case "unskip": apply(p => A.unanswer(p, id, q)); break;
    case "accept": apply(p => A.acceptDecision(p, id)); break;
    case "override": apply(p => A.overrideDecision(p, id, Number(t.dataset.i))); break;
    case "reopen": apply(p => A.reopenDecision(p, id)); break;
    case "sugg": apply(p => v === "accepted" ? A.acceptSuggestion(p, id, t.dataset.s!)
      : v === "dismissed" ? A.dismissSuggestion(p, id, t.dataset.s!) : A.resetSuggestion(p, id, t.dataset.s!)); break;
    case "codeToggle": showCode = !showCode; if (showCode) detail = P.layers.length - 1; render(); break;
    case "next": {
      const nx = A.nextQuestion(P);
      const rv = A.ledger(P).find(e => e.review === "open");
      if (nx) { sel = nx.node; tab = "node"; render(); document.getElementById("q-" + nx.question.id)?.scrollIntoView({ block: "center" }); }
      else if (rv) { sel = rv.node; tab = "node"; render(); $("#panel").scrollTop = 0; }
      else { tab = "needs"; render(); }
      break;
    }
    case "review": apply(p => A.reviewPart(p, id, v === "1")); break;
    case "lf": ledgerFilter = v as typeof ledgerFilter; render(); break;
    case "undo": if (history.length) { P = history.pop()!; if (!A.activeIds(P).has(sel)) sel = P.root; render(); } break;
    case "reset": start(exampleKey); break;
    case "download": {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([A.save(P)], { type: "application/json" }));
      a.download = exampleKey + ".acore.json"; a.click(); URL.revokeObjectURL(a.href);
      break;
    }
  }
});
document.getElementById("example")!.addEventListener("change", e => start((e.target as HTMLSelectElement).value));
start(exampleKey);
