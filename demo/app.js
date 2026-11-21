"use strict";
(() => {
  // src/model.ts
  var FORMAT = "abstractcore/0.1";

  // src/graph.ts
  function spawnSources(p) {
    const out = /* @__PURE__ */ new Map();
    const add = (target, s) => {
      const list = out.get(target);
      if (list) list.push(s);
      else out.set(target, [s]);
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
  var isSkipped = (a) => typeof a === "object" && a !== null && !Array.isArray(a) && a.skipped === true;
  function isAnswered(q) {
    const a = q.answer;
    if (a === void 0) return false;
    if (isSkipped(a)) return true;
    if (Array.isArray(a)) return a.length > 0;
    return a.trim().length > 0;
  }
  function isVisible(node, q) {
    if (!q.showIf) return true;
    const dep = node.questions?.find((x) => x.id === q.showIf);
    return !!dep && isAnswered(dep) && !isSkipped(dep.answer);
  }
  function chosenOptions(q) {
    const a = q.answer;
    if (!q.options || a === void 0 || isSkipped(a)) return [];
    const vals = Array.isArray(a) ? a : [a];
    return q.options.filter((o) => vals.includes(o.value));
  }
  function fires(p, s) {
    const owner = p.nodes[s.node];
    if (!owner) return false;
    switch (s.type) {
      case "option": {
        const q = owner.questions?.find((x) => x.id === s.question);
        return !!q && isVisible(owner, q) && chosenOptions(q).some((o) => o.value === s.value);
      }
      case "suggestion":
        return owner.suggestions?.find((x) => x.id === s.suggestion)?.state === "accepted";
      case "decision": {
        const d = owner.decision;
        if (!d) return false;
        return s.alternative === null ? d.state !== "overridden" : d.state === "overridden" && d.chosen === s.alternative;
      }
    }
  }
  function activeIds(p) {
    const sources = spawnSources(p);
    const memo = /* @__PURE__ */ new Map();
    const visiting = /* @__PURE__ */ new Set();
    const active = (id) => {
      const cached = memo.get(id);
      if (cached !== void 0) return cached;
      const n = p.nodes[id];
      if (!n || visiting.has(id)) return false;
      visiting.add(id);
      let ok = id === p.root || n.parent !== null && active(n.parent);
      const src = sources.get(id);
      if (ok && src) ok = src.some((s) => fires(p, s) && active(s.node));
      visiting.delete(id);
      memo.set(id, ok);
      return ok;
    };
    const out = /* @__PURE__ */ new Set();
    for (const id of Object.keys(p.nodes)) if (active(id)) out.add(id);
    return out;
  }
  function children(p, id, active = activeIds(p)) {
    return Object.values(p.nodes).filter((n) => n.parent === id && active.has(n.id)).map((n) => n.id);
  }
  function pathTo(p, id) {
    const out = [];
    let cur = p.nodes[id]?.parent ?? null;
    const seen = /* @__PURE__ */ new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.unshift(cur);
      cur = p.nodes[cur]?.parent ?? null;
    }
    return out;
  }
  var depth = (p, id) => pathTo(p, id).length;
  function layerName(p, id) {
    const d = depth(p, id);
    return p.layers[Math.min(d, p.layers.length - 1)] ?? `Layer ${d}`;
  }
  function walk(p, active = activeIds(p)) {
    const out = [];
    const go = (id, d) => {
      out.push({ id, depth: d });
      for (const c of children(p, id, active)) go(c, d + 1);
    };
    if (active.has(p.root)) go(p.root, 0);
    return out;
  }
  function activeEdges(p, active = activeIds(p)) {
    return p.edges.filter((e) => active.has(e.from) && active.has(e.to));
  }

  // src/status.ts
  function status(p) {
    const active = activeIds(p);
    const s = {
      openMust: [],
      made: [],
      openAsk: [],
      defaults: [],
      openDecisions: [],
      overridden: [],
      openSuggestions: [],
      needs: [],
      ownership: { user: 0, ai: 0, doc: 0 },
      progress: 1,
      ready: true
    };
    const seen = /* @__PURE__ */ new Set();
    const need = (node, n) => {
      if (!seen.has(n)) {
        seen.add(n);
        s.needs.push({ node, need: n });
      }
    };
    for (const { id } of walk(p, active)) {
      const n = p.nodes[id];
      s.ownership[n.author]++;
      (n.needs ?? []).forEach((x) => need(id, x));
      for (const q of n.questions ?? []) {
        if (!isVisible(n, q)) continue;
        const ref = { node: id, question: q };
        if (q.kind === "must") (isAnswered(q) ? s.made : s.openMust).push(ref);
        else if (isSkipped(q.answer)) s.defaults.push(ref);
        else if (!isAnswered(q)) s.openAsk.push(ref);
        chosenOptions(q).forEach((o) => (o.needs ?? []).forEach((x) => need(id, x)));
      }
      for (const sg of n.suggestions ?? []) {
        const st = sg.state ?? "open";
        if (st === "open") s.openSuggestions.push({ node: id, suggestion: sg.id });
        if (st === "accepted") (sg.needs ?? []).forEach((x) => need(id, x));
      }
      const d = n.decision;
      if (d) {
        if (d.state === "open") s.openDecisions.push(id);
        if (d.state === "overridden") {
          s.overridden.push(id);
          const alt = d.chosen !== void 0 ? d.alternatives[d.chosen] : void 0;
          (alt?.needs ?? []).forEach((x) => need(id, x));
        }
      }
    }
    const total = s.made.length + s.openMust.length;
    s.progress = total ? s.made.length / total : 1;
    s.ready = s.openMust.length === 0;
    return s;
  }
  function ledger(p) {
    const out = [];
    const sources = spawnSources(p);
    const viaAcceptedSuggestion = (id) => (sources.get(id) ?? []).some((s) => s.type === "suggestion" && p.nodes[s.node]?.suggestions?.find((x) => x.id === s.suggestion)?.state === "accepted");
    for (const { id } of walk(p)) {
      const n = p.nodes[id];
      if (n.author === "ai")
        out.push({
          node: id,
          type: "addition",
          what: `Added "${n.title}"`,
          why: n.description,
          review: n.reviewed || viaAcceptedSuggestion(id) ? "accepted" : "open"
        });
      for (const q of n.questions ?? [])
        if (isVisible(n, q) && isSkipped(q.answer))
          out.push({ node: id, type: "default", what: `${q.text} \u2192 ${q.default ?? "AI default"}`, review: "accepted" });
      const d = n.decision;
      if (d)
        out.push({
          node: id,
          type: "decision",
          why: d.why,
          review: d.state,
          what: d.state === "overridden" && d.chosen !== void 0 ? `AI proposed: ${d.text} \u2192 you chose: ${d.alternatives[d.chosen]?.label}` : d.text,
          alternatives: d.alternatives.map((a) => a.label)
        });
    }
    return out;
  }
  function nextQuestion(p) {
    const order = walk(p).map((x, i) => ({ ...x, i })).sort((a, b) => a.depth - b.depth || a.i - b.i);
    for (const { id } of order) {
      const n = p.nodes[id];
      for (const q of n.questions ?? []) if (isVisible(n, q) && !isAnswered(q)) return { node: id, question: q };
    }
    return null;
  }

  // src/ops.ts
  var OpError = class extends Error {
  };
  function edit(p, nodeId, opts, action, detail2, fn) {
    if (!p.nodes[nodeId]) throw new OpError(`Unknown node "${nodeId}"`);
    const next = structuredClone(p);
    fn(next.nodes[nodeId]);
    next.log.push({ at: (opts.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()))(), node: nodeId, action, detail: detail2 });
    return next;
  }
  function getNode(p, id) {
    const n = p.nodes[id];
    if (!n) throw new OpError(`Unknown node "${id}"`);
    return n;
  }
  function findQ(n, qid) {
    const q = n.questions?.find((x) => x.id === qid);
    if (!q) throw new OpError(`Node "${n.id}" has no question "${qid}"`);
    if (!isVisible(n, q)) throw new OpError(`Question "${qid}" is not shown yet (it depends on "${q.showIf}")`);
    return q;
  }
  function answer(p, nodeId, qid, value, opts = {}) {
    const empty = Array.isArray(value) ? value.length === 0 : value.trim() === "";
    if (empty) return unanswer(p, nodeId, qid, opts);
    const q = findQ(getNode(p, nodeId), qid);
    if (q.type === "text") {
      if (typeof value !== "string") throw new OpError(`"${qid}" takes text`);
    } else {
      const vals = Array.isArray(value) ? value : [value];
      if (q.type === "single" && vals.length !== 1) throw new OpError(`"${qid}" takes exactly one option`);
      const bad = vals.filter((v) => !q.options?.some((o) => o.value === v));
      if (bad.length) throw new OpError(`"${qid}" has no option ${bad.map((b) => `"${b}"`).join(", ")}`);
    }
    const stored = q.type === "multi" ? [...new Set(Array.isArray(value) ? value : [value])] : Array.isArray(value) ? value[0] : value.trim();
    return edit(p, nodeId, opts, "answer", `${qid} = ${JSON.stringify(stored)}`, (n) => {
      findQ(n, qid).answer = stored;
    });
  }
  function toggle(p, nodeId, qid, value, opts = {}) {
    const q = findQ(getNode(p, nodeId), qid);
    if (q.type !== "multi") throw new OpError(`"${qid}" is not multi-choice`);
    const cur = Array.isArray(q.answer) ? q.answer : [];
    return answer(p, nodeId, qid, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value], opts);
  }
  function skip(p, nodeId, qid, opts = {}) {
    const q = findQ(getNode(p, nodeId), qid);
    if (q.kind === "must") throw new OpError(`"${qid}" is yours to decide; it cannot be skipped`);
    return edit(p, nodeId, opts, "skip", `${qid} \u2192 default: ${q.default ?? ""}`, (n) => {
      findQ(n, qid).answer = { skipped: true };
    });
  }
  function unanswer(p, nodeId, qid, opts = {}) {
    return edit(p, nodeId, opts, "unanswer", qid, (n) => {
      delete findQ(n, qid).answer;
    });
  }
  function sugg(p, nodeId, sid, state, opts) {
    const action = state === "accepted" ? "accept-suggestion" : "dismiss-suggestion";
    return edit(p, nodeId, opts, action, `${sid} \u2192 ${state}`, (n) => {
      const s = n.suggestions?.find((x) => x.id === sid);
      if (!s) throw new OpError(`Node "${nodeId}" has no suggestion "${sid}"`);
      s.state = state;
    });
  }
  var acceptSuggestion = (p, node, sid, o = {}) => sugg(p, node, sid, "accepted", o);
  var dismissSuggestion = (p, node, sid, o = {}) => sugg(p, node, sid, "dismissed", o);
  var resetSuggestion = (p, node, sid, o = {}) => sugg(p, node, sid, "open", o);
  function needDecision(n) {
    if (!n.decision) throw new OpError(`Node "${n.id}" has no AI decision`);
    return n.decision;
  }
  function acceptDecision(p, nodeId, opts = {}) {
    return edit(p, nodeId, opts, "accept-decision", p.nodes[nodeId]?.decision?.text ?? "", (n) => {
      const d = needDecision(n);
      d.state = "accepted";
      delete d.chosen;
    });
  }
  function overrideDecision(p, nodeId, alternative, opts = {}) {
    const alt = p.nodes[nodeId]?.decision?.alternatives[alternative];
    return edit(p, nodeId, opts, "override-decision", alt?.label ?? "", (n) => {
      const d = needDecision(n);
      if (!d.alternatives[alternative]) throw new OpError(`Decision on "${nodeId}" has no alternative ${alternative}`);
      d.state = "overridden";
      d.chosen = alternative;
    });
  }
  function reopenDecision(p, nodeId, opts = {}) {
    return edit(p, nodeId, opts, "reopen-decision", "", (n) => {
      const d = needDecision(n);
      d.state = "open";
      delete d.chosen;
    });
  }
  function decisionText(n) {
    const d = n.decision;
    if (!d) return void 0;
    if (d.state === "overridden" && d.chosen !== void 0) {
      const a = d.alternatives[d.chosen];
      return a?.text ?? a?.label;
    }
    return d.text;
  }
  function reviewPart(p, nodeId, reviewed = true, opts = {}) {
    return edit(p, nodeId, opts, "review-part", reviewed ? "kept" : "unreviewed", (n) => {
      if (n.author !== "ai") throw new OpError(`"${nodeId}" was not added by the AI`);
      if (reviewed) n.reviewed = true;
      else delete n.reviewed;
    });
  }

  // src/validate.ts
  function validate(p) {
    const out = [];
    const err = (at, message) => out.push({ level: "error", at, message });
    const warn = (at, message) => out.push({ level: "warning", at, message });
    if (p.format !== FORMAT) err("format", `Expected "${FORMAT}", got "${p.format}"`);
    if (!p.name) warn("name", "Project has no name");
    if (!Array.isArray(p.layers) || p.layers.length === 0) err("layers", "At least one layer name is required");
    if (!p.nodes || typeof p.nodes !== "object") {
      err("nodes", "Missing nodes");
      return out;
    }
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
      const seen = /* @__PURE__ */ new Set([key]);
      for (let c = n.parent; c; c = p.nodes[c]?.parent ?? null) {
        if (seen.has(c)) {
          err(at, "Parent chain loops back on itself");
          break;
        }
        seen.add(c);
      }
      const qids = /* @__PURE__ */ new Set();
      for (const q of n.questions ?? []) {
        const qa = `${at}.questions.${q.id}`;
        if (qids.has(q.id)) err(qa, "Duplicate question id");
        qids.add(q.id);
        if (q.kind === "ask" && !q.default) warn(qa, "An ordinary question should say what the AI does if skipped (default)");
        if (q.kind === "must" && !q.why) warn(qa, "A must-decide question should say why it is the person's call (why)");
        if (q.type !== "text" && !q.options?.length) err(qa, "Choice question has no options");
        if (q.type === "text" && q.options?.length) warn(qa, "Text question has options; they are ignored");
        const vals = /* @__PURE__ */ new Set();
        for (const o of q.options ?? []) {
          if (vals.has(o.value)) err(qa, `Duplicate option "${o.value}"`);
          vals.add(o.value);
        }
        if (q.showIf && !(n.questions ?? []).some((x) => x.id === q.showIf)) err(qa, `showIf refers to unknown question "${q.showIf}"`);
        const a = q.answer;
        if (a !== void 0) {
          if (isSkipped(a)) {
            if (q.kind === "must") err(qa, "A must-decide question cannot be skipped");
          } else if (q.type === "text") {
            if (typeof a !== "string") err(qa, "Text answer must be a string");
          } else {
            const arr = Array.isArray(a) ? a : [a];
            if (q.type === "single" && Array.isArray(a)) err(qa, "Single-choice answer must be one value");
            arr.filter((v) => !vals.has(v)).forEach((v) => err(qa, `Answer "${v}" is not an option`));
          }
        }
      }
      const sids = /* @__PURE__ */ new Set();
      for (const s of n.suggestions ?? []) {
        if (sids.has(s.id)) err(`${at}.suggestions.${s.id}`, "Duplicate suggestion id");
        sids.add(s.id);
      }
      const d = n.decision;
      if (d) {
        if (!d.why) warn(`${at}.decision`, "An AI decision should explain itself (why)");
        if (d.state === "overridden" && (d.chosen === void 0 || !d.alternatives[d.chosen]))
          err(`${at}.decision`, "Overridden decision must point at an existing alternative (chosen)");
      }
    }
    for (const [target, srcs] of spawnSources(p)) {
      if (!p.nodes[target]) srcs.forEach((s) => err(`nodes.${s.node}`, `Spawns unknown node "${target}"`));
      if (target === p.root) err(`nodes.${target}`, "The root cannot be spawned");
    }
    (p.edges ?? []).forEach((e, i) => {
      if (!p.nodes[e.from]) err(`edges.${i}`, `Unknown node "${e.from}"`);
      if (!p.nodes[e.to]) err(`edges.${i}`, `Unknown node "${e.to}"`);
      if (e.from === e.to) err(`edges.${i}`, "An edge cannot connect a node to itself");
    });
    return out;
  }
  var ValidationError = class extends Error {
    constructor(issues) {
      super("Invalid abstractCORE project:\n" + issues.map((i) => `  ${i.at}: ${i.message}`).join("\n"));
      this.issues = issues;
    }
  };
  function load(input) {
    const p = typeof input === "string" ? JSON.parse(input) : structuredClone(input);
    p.edges ?? (p.edges = []);
    p.log ?? (p.log = []);
    const errors = validate(p).filter((i) => i.level === "error");
    if (errors.length) throw new ValidationError(errors);
    return p;
  }
  var save = (p) => JSON.stringify(p, null, 2) + "\n";

  // examples/clothing-store.acore.json
  var clothing_store_acore_default = {
    format: "abstractcore/0.1",
    name: "An online clothing store",
    layers: [
      "The idea",
      "Where it lives",
      "What it does",
      "The details"
    ],
    root: "idea",
    nodes: {
      idea: {
        id: "idea",
        parent: null,
        title: "An online clothing store",
        description: "Sell my own clothing designs online.",
        author: "user",
        kind: "idea",
        questions: [
          {
            id: "platform",
            kind: "must",
            type: "single",
            text: "Where will your customers use it?",
            why: "This shapes almost everything after it, including cost and time. The AI should not pick this for you.",
            options: [
              {
                value: "web",
                label: "A website",
                note: "Opens in any browser, on phones and computers.",
                needs: [
                  "A web address (domain name), renewed yearly",
                  "Web hosting to keep the site online"
                ],
                spawns: [
                  "site"
                ]
              },
              {
                value: "app",
                label: "A phone app",
                note: "Installed from the App Store or Google Play.",
                needs: [
                  "Apple and Google developer accounts (yearly fees)",
                  "App store review before each release"
                ],
                spawns: [
                  "site"
                ]
              },
              {
                value: "both",
                label: "Both",
                note: "Reaches the most people, costs the most.",
                needs: [
                  "A web address (domain name), renewed yearly",
                  "Web hosting to keep the site online",
                  "Apple and Google developer accounts (yearly fees)",
                  "Two things to build and keep updated"
                ],
                spawns: [
                  "site"
                ]
              }
            ]
          }
        ]
      },
      site: {
        id: "site",
        parent: "idea",
        title: "Where it lives",
        description: "Where your store lives",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "buyers",
            kind: "ask",
            type: "single",
            text: "Who will be buying?",
            default: "Everyday shoppers buying one or two items.",
            options: [
              {
                value: "retail",
                label: "Everyday shoppers"
              },
              {
                value: "bulk",
                label: "Shops buying in bulk",
                needs: [
                  "Bulk price lists and minimum order sizes"
                ]
              },
              {
                value: "both",
                label: "Both",
                needs: [
                  "Two price lists: regular and bulk",
                  "A way to mark some customers as bulk buyers"
                ]
              }
            ]
          },
          {
            id: "features",
            kind: "ask",
            type: "multi",
            text: "What should people be able to do?",
            hint: "Pick everything you want. Each one becomes its own part of your plan.",
            default: "Nothing gets planned until you pick at least one.",
            options: [
              {
                value: "browse",
                label: "Browse my clothes",
                spawns: [
                  "browse"
                ]
              },
              {
                value: "buy",
                label: "Buy and pay",
                spawns: [
                  "buy"
                ]
              },
              {
                value: "account",
                label: "Have an account",
                spawns: [
                  "account"
                ]
              },
              {
                value: "track",
                label: "Track their order",
                spawns: [
                  "track"
                ]
              },
              {
                value: "fav",
                label: "Save favourites",
                spawns: [
                  "fav"
                ]
              },
              {
                value: "reviews",
                label: "Leave reviews",
                spawns: [
                  "reviews"
                ]
              }
            ]
          }
        ],
        suggestions: [
          {
            id: "admin",
            text: "A place for you to add clothes and see orders",
            why: "Almost every store needs this. The AI flags it because it was not on your list.",
            spawns: [
              "admin"
            ],
            state: "open"
          }
        ]
      },
      browse: {
        id: "browse",
        parent: "site",
        title: "Browse my clothes",
        description: "How people look through what you sell",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "find",
            kind: "ask",
            type: "multi",
            text: "How should people find things?",
            default: "One list of everything, newest first.",
            options: [
              {
                value: "cat",
                label: "By category",
                note: "Dresses, shirts, trousers and so on.",
                needs: [
                  "Your list of categories"
                ]
              },
              {
                value: "search",
                label: "A search bar"
              },
              {
                value: "size",
                label: "Filter by size"
              },
              {
                value: "colour",
                label: "Filter by colour",
                needs: [
                  "Each item tagged with its colours"
                ]
              },
              {
                value: "price",
                label: "Filter by price"
              }
            ]
          },
          {
            id: "photos",
            kind: "ask",
            type: "single",
            text: "How much should people see of each item?",
            default: "A few photos from different angles.",
            options: [
              {
                value: "one",
                label: "One photo",
                needs: [
                  "One good photo per item"
                ]
              },
              {
                value: "few",
                label: "A few photos from different angles",
                needs: [
                  "Three to five photos per item"
                ]
              },
              {
                value: "video",
                label: "Photos and a short video",
                needs: [
                  "A short video per item",
                  "Video hosting (pages load slower on weak connections)"
                ]
              }
            ]
          },
          {
            id: "soldout",
            kind: "must",
            type: "single",
            text: "What happens when a size sells out?",
            why: "This is a business choice about your stock, not a technical one.",
            options: [
              {
                value: "hide",
                label: "Hide that size"
              },
              {
                value: "show",
                label: "Show it as sold out"
              },
              {
                value: "notify",
                label: "Let people ask to be told when it is back",
                needs: [
                  "Emails or messages to say it is back"
                ]
              },
              {
                value: "pre",
                label: "Let people pre-order it",
                needs: [
                  "Taking payment now and delivering later",
                  "A clear waiting time for each pre-order"
                ]
              }
            ]
          }
        ],
        suggestions: [
          {
            id: "new",
            text: "A \u201CNew arrivals\u201D section",
            why: "Gives returning shoppers a reason to look again.",
            needs: [
              "A date on each item for when it was added"
            ],
            state: "open"
          },
          {
            id: "sizeguide",
            text: "A size guide",
            why: "Clothing stores get fewer returns when sizes are explained.",
            spawns: [
              "sizeguide"
            ],
            state: "open"
          }
        ]
      },
      sizeguide: {
        id: "sizeguide",
        parent: "browse",
        title: "Size guide",
        description: "Helping people pick the right size",
        author: "ai",
        kind: "component",
        questions: [
          {
            id: "std",
            kind: "ask",
            type: "single",
            text: "What sizes do you use?",
            default: "Letter sizes: S, M, L, XL.",
            options: [
              {
                value: "letters",
                label: "Letter sizes (S, M, L)"
              },
              {
                value: "num",
                label: "UK or US number sizes"
              },
              {
                value: "own",
                label: "My own measurements",
                needs: [
                  "A measurement chart for each type of item"
                ]
              }
            ]
          },
          {
            id: "how",
            kind: "ask",
            type: "single",
            text: "How should the guide help?",
            default: "A chart people can read.",
            options: [
              {
                value: "chart",
                label: "A chart people can read"
              },
              {
                value: "quiz",
                label: "Ask their height and fit, then suggest a size",
                needs: [
                  "Your rules for which size suits whom"
                ]
              }
            ]
          }
        ]
      },
      buy: {
        id: "buy",
        parent: "site",
        title: "Buy and pay",
        description: "Checkout, payment and delivery",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "pay",
            kind: "must",
            type: "multi",
            text: "How will you get paid?",
            why: "Each option changes your costs, your risk and who does the checking. Only you can weigh that.",
            options: [
              {
                value: "card",
                label: "Card payments online",
                needs: [
                  "A payment provider account (it takes a small fee per sale)"
                ]
              },
              {
                value: "transfer",
                label: "Bank transfer",
                needs: [
                  "Someone to check each transfer by hand before shipping"
                ]
              },
              {
                value: "cod",
                label: "Pay on delivery",
                needs: [
                  "Riders who can collect payment",
                  "A plan for deliveries that get refused"
                ]
              }
            ]
          },
          {
            id: "where",
            kind: "must",
            type: "single",
            text: "Where will you deliver?",
            why: "Your delivery area decides prices, partners and paperwork.",
            options: [
              {
                value: "city",
                label: "My city only",
                spawns: [
                  "delivery"
                ]
              },
              {
                value: "country",
                label: "Across the country",
                needs: [
                  "A courier that covers the whole country"
                ],
                spawns: [
                  "delivery"
                ]
              },
              {
                value: "intl",
                label: "Other countries too",
                needs: [
                  "An international courier",
                  "Customs forms for each parcel",
                  "Prices in more than one currency"
                ],
                spawns: [
                  "delivery"
                ]
              }
            ]
          },
          {
            id: "fail",
            kind: "must",
            type: "single",
            text: "If a payment fails, what should the customer see?",
            why: "The AI could guess, but a wrong guess loses sales or annoys customers.",
            options: [
              {
                value: "retry",
                label: "Try again, with the cart kept"
              },
              {
                value: "other",
                label: "Offer another way to pay"
              },
              {
                value: "remind",
                label: "Keep the cart and remind them later",
                needs: [
                  "Reminder emails or messages"
                ]
              }
            ]
          }
        ],
        suggestions: [
          {
            id: "codes",
            text: "Discount codes",
            why: "Useful for launches, sales and working with influencers.",
            spawns: [
              "codes"
            ],
            state: "open"
          },
          {
            id: "receipt",
            text: "Send a receipt after every order",
            why: "Customers expect proof of what they bought.",
            needs: [
              "An email service for receipts"
            ],
            state: "open"
          }
        ]
      },
      delivery: {
        id: "delivery",
        parent: "buy",
        title: "Delivery",
        description: "Getting orders to people",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "fee",
            kind: "must",
            type: "text",
            text: "Describe your delivery fee in your own words.",
            why: "Only you know your prices. Write it the way you would explain it to a customer."
          },
          {
            id: "feeq",
            kind: "must",
            type: "single",
            text: "Does the free-delivery amount count before or after discounts?",
            why: "Your description did not say, and each answer changes what customers pay.",
            showIf: "fee",
            options: [
              {
                value: "before",
                label: "Before discounts"
              },
              {
                value: "after",
                label: "After discounts"
              },
              {
                value: "na",
                label: "My fee has no free-delivery amount"
              }
            ]
          },
          {
            id: "who",
            kind: "ask",
            type: "single",
            text: "Who does the delivering?",
            default: "A courier company.",
            options: [
              {
                value: "me",
                label: "Me or my team"
              },
              {
                value: "courier",
                label: "A courier company",
                needs: [
                  "An account with a courier company"
                ]
              },
              {
                value: "pickup",
                label: "Customers pick up",
                needs: [
                  "A pickup address and opening hours"
                ]
              }
            ]
          }
        ]
      },
      codes: {
        id: "codes",
        parent: "buy",
        title: "Discount codes",
        description: "Money off at checkout",
        author: "ai",
        kind: "component",
        questions: [
          {
            id: "kinds",
            kind: "ask",
            type: "multi",
            text: "What kinds of discount?",
            default: "Percentage off only.",
            options: [
              {
                value: "pct",
                label: "Percentage off"
              },
              {
                value: "fixed",
                label: "A fixed amount off"
              },
              {
                value: "free",
                label: "Free delivery"
              }
            ]
          },
          {
            id: "stack",
            kind: "must",
            type: "single",
            text: "Can someone use more than one code at once?",
            why: "Combined codes can wipe out your profit. This is your call.",
            options: [
              {
                value: "no",
                label: "No, one code per order"
              },
              {
                value: "yes",
                label: "Yes, they can combine codes"
              }
            ]
          }
        ]
      },
      account: {
        id: "account",
        parent: "site",
        title: "Have an account",
        description: "Signing in and saved details",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "guest",
            kind: "must",
            type: "single",
            text: "Can people buy without making an account?",
            why: "Forcing sign-up gets you more contacts but loses some buyers. Only you can make that trade.",
            options: [
              {
                value: "yes",
                label: "Yes, guest checkout is fine"
              },
              {
                value: "no",
                label: "No, they must sign up first"
              }
            ]
          },
          {
            id: "signin",
            kind: "ask",
            type: "single",
            text: "How should people sign in?",
            default: "Email with a one-time code, so nobody needs a password.",
            options: [
              {
                value: "pw",
                label: "Email and password",
                needs: [
                  "A way to reset forgotten passwords"
                ]
              },
              {
                value: "code",
                label: "Email with a one-time code"
              },
              {
                value: "social",
                label: "Google or Apple sign-in",
                needs: [
                  "Setup with Google and Apple"
                ]
              }
            ]
          },
          {
            id: "delete",
            kind: "must",
            type: "single",
            text: "If someone asks you to delete their data, what do you keep?",
            why: "This depends on the rules where you operate and on your records. Check with someone qualified.",
            options: [
              {
                value: "all",
                label: "Delete everything"
              },
              {
                value: "orders",
                label: "Keep order records, delete the rest",
                needs: [
                  "A note of which records you keep, and why"
                ]
              }
            ]
          }
        ]
      },
      track: {
        id: "track",
        parent: "site",
        title: "Track their order",
        description: "After someone has paid",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "notify",
            kind: "ask",
            type: "multi",
            text: "How should they hear about updates?",
            default: "By email.",
            options: [
              {
                value: "email",
                label: "Email",
                needs: [
                  "An email service"
                ]
              },
              {
                value: "sms",
                label: "Text message",
                needs: [
                  "A text message service (costs per message)"
                ]
              },
              {
                value: "wa",
                label: "WhatsApp",
                needs: [
                  "A WhatsApp Business account"
                ]
              }
            ]
          },
          {
            id: "cancel",
            kind: "must",
            type: "single",
            text: "Can they cancel after paying?",
            why: "Cancellation rules affect refunds and your stock.",
            options: [
              {
                value: "no",
                label: "No"
              },
              {
                value: "ship",
                label: "Yes, until it ships"
              },
              {
                value: "time",
                label: "Yes, within a set time",
                needs: [
                  "Your cancellation time limit"
                ]
              }
            ]
          },
          {
            id: "returns",
            kind: "must",
            type: "single",
            text: "Do you accept returns?",
            why: "Your return policy is a promise to customers. It has to come from you.",
            options: [
              {
                value: "none",
                label: "No returns"
              },
              {
                value: "exchange",
                label: "Exchanges only"
              },
              {
                value: "refund",
                label: "Returns with a refund",
                needs: [
                  "A refund process with your payment provider",
                  "A written return policy"
                ]
              }
            ]
          }
        ]
      },
      fav: {
        id: "fav",
        parent: "site",
        title: "Save favourites",
        description: "A wishlist for later",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "acct",
            kind: "ask",
            type: "single",
            text: "Should saving favourites need an account?",
            default: "Saved on their device, no account needed.",
            options: [
              {
                value: "yes",
                label: "Yes, favourites need an account"
              },
              {
                value: "device",
                label: "No, save them on their device",
                note: "They lose them if they switch phones."
              }
            ]
          }
        ],
        suggestions: [
          {
            id: "sale",
            text: "Tell people when a favourite goes on sale",
            why: "Brings shoppers back at the right moment.",
            needs: [
              "Emails or messages for sale alerts"
            ],
            state: "open"
          }
        ]
      },
      reviews: {
        id: "reviews",
        parent: "site",
        title: "Leave reviews",
        description: "What other shoppers say",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "who",
            kind: "must",
            type: "single",
            text: "Who can leave a review?",
            why: "Open reviews bring more feedback, but also fake ones.",
            options: [
              {
                value: "any",
                label: "Anyone"
              },
              {
                value: "buyers",
                label: "Only people who bought the item"
              }
            ]
          },
          {
            id: "check",
            kind: "must",
            type: "single",
            text: "Do you check reviews before they appear?",
            why: "This is about your brand and your time.",
            options: [
              {
                value: "yes",
                label: "Yes, I approve each one",
                needs: [
                  "Time set aside to approve reviews"
                ]
              },
              {
                value: "no",
                label: "No, but I can remove them later"
              }
            ]
          }
        ],
        suggestions: [
          {
            id: "photos",
            text: "Photos in reviews",
            why: "Shoppers trust real photos of how clothes fit.",
            needs: [
              "Storage for customer photos"
            ],
            state: "open"
          }
        ]
      },
      admin: {
        id: "admin",
        parent: "site",
        title: "Manage my store",
        description: "Your side: stock and orders",
        author: "ai",
        kind: "component",
        questions: [
          {
            id: "who",
            kind: "ask",
            type: "single",
            text: "Who will manage the store?",
            default: "Just you.",
            options: [
              {
                value: "me",
                label: "Just me"
              },
              {
                value: "staff",
                label: "Me and staff",
                needs: [
                  "Staff logins that only see what they need"
                ]
              }
            ]
          },
          {
            id: "add",
            kind: "ask",
            type: "single",
            text: "How will you add new clothes?",
            default: "One at a time, with a simple form.",
            options: [
              {
                value: "one",
                label: "One at a time"
              },
              {
                value: "sheet",
                label: "Upload a spreadsheet",
                needs: [
                  "A spreadsheet template to fill in"
                ]
              }
            ]
          }
        ]
      }
    },
    edges: [
      {
        from: "admin",
        to: "browse",
        label: "New clothes"
      },
      {
        from: "browse",
        to: "buy",
        label: "Items in the cart"
      },
      {
        from: "buy",
        to: "track",
        label: "Paid order"
      }
    ],
    log: []
  };

  // examples/stem-splitter.acore.json
  var stem_splitter_acore_default = {
    format: "abstractcore/0.1",
    name: "A stem separation tool",
    layers: [
      "The idea",
      "Core parts",
      "How it works",
      "Functions"
    ],
    root: "tool",
    nodes: {
      tool: {
        id: "tool",
        parent: null,
        title: "A stem separation tool",
        description: "Split any song into separate parts: vocals, drums, bass and the rest.",
        author: "user",
        kind: "idea",
        suggestions: [
          {
            id: "plugin",
            text: "Make it work as a plugin inside music software",
            why: "Producers can split a track without leaving their session.",
            spawns: [
              "plugin"
            ],
            state: "open"
          }
        ]
      },
      load: {
        id: "load",
        parent: "tool",
        title: "Load a song",
        description: "Pick a song file to work on.",
        author: "user",
        kind: "component",
        decision: {
          state: "open",
          text: "Reads WAV, MP3 and FLAC files.",
          why: "Covers almost every song people have. Reading these comes built into the plugin toolkit.",
          alternatives: [
            {
              label: "WAV files only",
              text: "Reads WAV files only."
            },
            {
              label: "Any audio or video file",
              text: "Reads any audio or video file and pulls out the sound.",
              needs: [
                "An extra library to read video files"
              ]
            }
          ]
        }
      },
      split: {
        id: "split",
        parent: "tool",
        title: "Split into stems",
        description: "Vocals, drums, bass and everything else, as separate tracks.",
        author: "user",
        kind: "component",
        decision: {
          state: "open",
          text: "Uses an online separation service (an API) with an existing AI model.",
          why: "Fastest to build, with good results. Trade-offs: it costs money per song, needs internet, and the song leaves the user's computer.",
          spawns: [
            "s-up",
            "s-back"
          ],
          alternatives: [
            {
              label: "Run it on the user's computer instead",
              text: "Runs an AI model on the user's computer.",
              spawns: [
                "s-model",
                "s-lib",
                "s-gpu",
                "s-run",
                "s-back2"
              ],
              needs: [
                "A separation model you are allowed to ship"
              ]
            }
          ]
        },
        suggestions: [
          {
            id: "bleed",
            text: "Reduce bleed between stems",
            why: "Faint drums in the vocal stem are the most common complaint about stem splitters.",
            spawns: [
              "bleed"
            ],
            state: "open"
          },
          {
            id: "backing",
            text: "Separate lead and backing vocals",
            why: "Useful for remixes and karaoke.",
            spawns: [
              "backing"
            ],
            state: "open"
          }
        ]
      },
      listen: {
        id: "listen",
        parent: "tool",
        title: "Listen to each stem",
        description: "Play the stems on their own or together.",
        author: "user",
        kind: "component",
        decision: {
          state: "open",
          text: "Solo and mute buttons for each stem, with a waveform.",
          why: "This is how most music tools let you check separate parts.",
          alternatives: [
            {
              label: "Just play and stop per stem",
              text: "One play button per stem, nothing else."
            }
          ]
        }
      },
      save: {
        id: "save",
        parent: "tool",
        title: "Save the stems",
        description: "Keep each stem as its own file.",
        author: "user",
        kind: "component",
        decision: {
          state: "open",
          text: "Saves each stem as a WAV file named after the song.",
          why: "WAV keeps full quality and every music tool can open it.",
          alternatives: [
            {
              label: "Let people choose WAV or MP3",
              text: "People choose WAV or MP3 when saving.",
              needs: [
                "An MP3 encoder"
              ]
            }
          ]
        }
      },
      "s-up": {
        id: "s-up",
        parent: "split",
        title: "Send the song to a separation service",
        description: "An existing AI model, run online.",
        author: "ai",
        kind: "external",
        needs: [
          "An account with a separation service (costs per song)",
          "Internet access while splitting"
        ]
      },
      "s-back": {
        id: "s-back",
        parent: "split",
        title: "Get four stems back",
        description: "Vocals, drums, bass, other.",
        author: "ai",
        kind: "function"
      },
      "s-model": {
        id: "s-model",
        parent: "split",
        title: "Include the separation model",
        description: "The AI model ships with the tool. It is about 300 MB.",
        author: "user",
        kind: "component",
        questions: [
          {
            id: "delivery",
            kind: "must",
            type: "single",
            text: "Should the model be inside the installer, or download the first time someone uses the tool?",
            why: "It trades download size against needing internet once. That's a product call.",
            options: [
              {
                value: "installer",
                label: "Inside the installer (bigger download)"
              },
              {
                value: "download",
                label: "Download on first use (needs internet once)",
                needs: [
                  "Somewhere to host the model file"
                ]
              }
            ]
          }
        ]
      },
      "s-lib": {
        id: "s-lib",
        parent: "split",
        title: "Model runtime library",
        description: "A ready-made library that runs AI models on a computer. One node stands for the whole library.",
        author: "ai",
        kind: "external"
      },
      l1: {
        id: "l1",
        parent: "s-lib",
        title: "Load a model file",
        description: "From the library's documentation.",
        author: "doc",
        kind: "function"
      },
      l2: {
        id: "l2",
        parent: "s-lib",
        title: "Run the model on some audio",
        description: "From the library's documentation.",
        author: "doc",
        kind: "function",
        code: {
          lang: "cpp",
          source: "// From the library's documentation\nstd::vector<Stem> run(Model& m, const AudioBuffer& chunk) {\n  auto input = toTensor(chunk);          // samples \u2192 model input\n  auto output = m.forward(input);        // vocals, drums, bass, other\n  return toStems(output, chunk.sampleRate);\n}"
        }
      },
      l3: {
        id: "l3",
        parent: "s-lib",
        title: "Choose processor or graphics card",
        description: "From the library's documentation.",
        author: "doc",
        kind: "function"
      },
      "s-gpu": {
        id: "s-gpu",
        parent: "split",
        title: "Use the graphics card if there is one",
        description: "Much faster. Falls back to the processor.",
        author: "user",
        kind: "component"
      },
      "s-run": {
        id: "s-run",
        parent: "split",
        title: "Work through the song in 10-second pieces",
        description: "Shows progress as it goes and keeps memory use low.",
        author: "user",
        kind: "function",
        code: {
          lang: "cpp",
          source: '// Your idea: "Work through the song in 10-second pieces"\nfor (int start = 0; start < song.length(); start += 10 * song.sampleRate) {\n  auto stems = run(model, song.slice(start, 10 * song.sampleRate));\n  append(result, stems);\n  progress(start / (float) song.length());\n}'
        }
      },
      "s-back2": {
        id: "s-back2",
        parent: "split",
        title: "Get four stems back",
        description: "Vocals, drums, bass, other.",
        author: "user",
        kind: "function"
      },
      bleed: {
        id: "bleed",
        parent: "split",
        title: "Reduce bleed between stems",
        description: "Lower what each stem picks up from the others.",
        author: "ai",
        kind: "function"
      },
      backing: {
        id: "backing",
        parent: "split",
        title: "Separate lead and backing vocals",
        description: "Two vocal stems instead of one.",
        author: "ai",
        kind: "function"
      },
      plugin: {
        id: "plugin",
        parent: "tool",
        title: "Works as a plugin",
        description: "Runs inside music software, on a track.",
        author: "ai",
        kind: "component",
        questions: [
          {
            id: "format",
            kind: "must",
            type: "single",
            text: "Which music software should it work in?",
            why: "Plugin formats differ: VST3 works in most, and Logic Pro needs AU. Only you know your audience.",
            options: [
              {
                value: "vst3",
                label: "Ableton, FL Studio and others (VST3)",
                needs: [
                  "A VST3 build of the plugin"
                ]
              },
              {
                value: "au",
                label: "Logic Pro (AU)",
                needs: [
                  "An AU build, signed for macOS"
                ]
              },
              {
                value: "both",
                label: "Both",
                needs: [
                  "A VST3 build of the plugin",
                  "An AU build, signed for macOS"
                ]
              }
            ]
          }
        ]
      },
      p1: {
        id: "p1",
        parent: "plugin",
        title: "Shows up in the plugin list",
        description: "People add it to a track like any other effect.",
        author: "ai",
        kind: "function"
      },
      p2: {
        id: "p2",
        parent: "plugin",
        title: "Takes audio from its track",
        description: "No need to load a file.",
        author: "ai",
        kind: "function"
      },
      p3: {
        id: "p3",
        parent: "plugin",
        title: "Sends each stem to its own track",
        description: "So people can mix them right away.",
        author: "ai",
        kind: "function"
      }
    },
    edges: [
      {
        from: "load",
        to: "split",
        label: "The song"
      },
      {
        from: "split",
        to: "listen",
        label: "Four stems"
      },
      {
        from: "split",
        to: "save",
        label: "Four stems"
      },
      {
        from: "s-up",
        to: "s-back",
        label: "Waits for the result"
      },
      {
        from: "s-model",
        to: "s-lib",
        label: "Model file"
      },
      {
        from: "s-gpu",
        to: "s-lib",
        label: "Where to run"
      },
      {
        from: "s-lib",
        to: "s-run",
        label: "Runs the model"
      },
      {
        from: "s-run",
        to: "s-back2",
        label: "Stems"
      },
      {
        from: "l1",
        to: "l2",
        label: "Loaded model"
      },
      {
        from: "l3",
        to: "l2",
        label: "Device"
      },
      {
        from: "s-back",
        to: "bleed",
        label: "Stems to clean"
      },
      {
        from: "s-back2",
        to: "bleed",
        label: "Stems to clean"
      },
      {
        from: "bleed",
        to: "backing",
        label: "Vocal stem"
      },
      {
        from: "plugin",
        to: "load",
        label: "Audio from the track"
      },
      {
        from: "p1",
        to: "p2"
      },
      {
        from: "p2",
        to: "p3",
        label: "Four stems"
      }
    ],
    log: []
  };

  // demo/app.ts
  var EXAMPLES = {
    stems: { label: "Stem separation tool", data: stem_splitter_acore_default },
    store: { label: "Online clothing store", data: clothing_store_acore_default }
  };
  var exampleKey = new URLSearchParams(location.search).get("example") === "store" ? "store" : "stems";
  var history = [];
  var P;
  var sel;
  var tab = "node";
  var detail = 1;
  var showCode = false;
  var ledgerFilter = "open";
  var $ = (s) => document.querySelector(s);
  var esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var WHO = { user: "You", ai: "AI", doc: "Docs" };
  function start(key) {
    exampleKey = key;
    P = load(EXAMPLES[key].data);
    history = [];
    sel = P.root;
    detail = 1;
    showCode = false;
    tab = "node";
    render();
  }
  function apply(fn) {
    try {
      const next = fn(P);
      history.push(P);
      P = next;
      if (!activeIds(P).has(sel)) sel = P.root;
      render();
    } catch (e) {
      toast(e.message);
    }
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.hidden = true, 3200);
  }
  function graphHTML() {
    const active = activeIds(P);
    const edges = activeEdges(P, active);
    const max = detail;
    const count = (id) => children(P, id, active).reduce((n, c) => n + 1 + count(c), 0);
    const nodeHTML = (id, d) => {
      const n = P.nodes[id];
      const kids = children(P, id, active);
      const folded = d >= max && kids.length ? count(id) : 0;
      const mustOpen = (n.questions ?? []).filter((q) => q.kind === "must" && isVisible(n, q) && !isAnswered(q)).length;
      const dec = n.decision;
      const chips = [];
      if (mustOpen) chips.push(`<span class="chip must">${mustOpen} to decide</span>`);
      if (dec) chips.push(dec.state === "open" ? `<span class="chip dec">AI decision \xB7 review</span>` : dec.state === "accepted" ? `<span class="chip ok">AI decision \u2713</span>` : `<span class="chip mine">Your change</span>`);
      if (n.code && showCode && d <= max) chips.push(`<span class="chip code">has code</span>`);
      const out = edges.filter((e) => e.from === id).map((e) => `<span class="flow">\u2192 ${esc(P.nodes[e.to].title)}${e.label ? ` <i>${esc(e.label)}</i>` : ""}</span>`).join("");
      let h = `<div class="gnode d${Math.min(d, 3)} by-${n.author}${sel === id ? " sel" : ""}">
      <button class="gcard" data-act="sel" data-id="${id}">
        <span class="meta">${esc(layerName(P, id))} \xB7 ${WHO[n.author]}</span>
        <span class="ttl">${esc(n.title)}</span>
        ${dec && d <= max ? `<span class="dtext">${esc(decisionText(n))}</span>` : ""}
        ${chips.length ? `<span class="chips">${chips.join("")}</span>` : ""}
        ${out ? `<span class="flows">${out}</span>` : ""}
      </button>`;
      if (folded) h += `<button class="fold" data-act="deeper">+ ${folded} more detailed part${folded > 1 ? "s" : ""} \u2014 look deeper</button>`;
      else if (kids.length) h += `<div class="kids">${kids.map((k) => nodeHTML(k, d + 1)).join("")}</div>`;
      return h + "</div>";
    };
    return nodeHTML(P.root, 0);
  }
  function qHTML(n, q) {
    const done = isAnswered(q), skipped = isSkipped(q.answer);
    let h = `<section class="q ${q.kind}${done ? " done" : ""}" id="q-${q.id}"><div class="qlabel">${q.kind === "must" ? `<span class="pill must">You must decide</span>` : `<span class="pill">Question</span>`}${done && !skipped ? `<span class="okt">\u2713 Answered</span>` : ""}</div>
    <h3>${esc(q.text)}</h3>${q.hint ? `<p class="muted">${esc(q.hint)}</p>` : ""}
    ${q.why ? `<p class="muted"><b class="mustc">Why it is yours to decide:</b> ${esc(q.why)}</p>` : ""}`;
    if (q.type === "text") {
      h += `<textarea id="ta-${q.id}" rows="3">${esc(typeof q.answer === "string" ? q.answer : "")}</textarea>
      <button class="btn" data-act="text" data-id="${n.id}" data-q="${q.id}">${done ? "Update" : "Save"}</button>`;
    } else {
      const vals = Array.isArray(q.answer) ? q.answer : typeof q.answer === "string" ? [q.answer] : [];
      h += `<div class="opts">${q.options.map((o) => `<button class="opt ${q.type}" aria-pressed="${vals.includes(o.value)}"
      data-act="pick" data-id="${n.id}" data-q="${q.id}" data-v="${esc(o.value)}"><span class="mark"></span>
      <span><b>${esc(o.label)}</b>${o.note ? `<small>${esc(o.note)}</small>` : ""}${o.spawns?.length ? `<small class="grows">Adds ${o.spawns.length} part${o.spawns.length > 1 ? "s" : ""} to the graph</small>` : ""}</span></button>`).join("")}</div>`;
      const needs = chosenOptions(q).flatMap((o) => o.needs ?? []);
      if (needs.length) h += `<div class="needsbox"><b>This means you will need</b><ul>${needs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    }
    if (q.kind === "ask") h += skipped ? `<p class="muted">Skipped. The AI uses: ${esc(q.default)} <button class="link" data-act="unskip" data-id="${n.id}" data-q="${q.id}">Answer instead</button></p>` : !done ? `<p class="muted">If you skip: ${esc(q.default)} <button class="link" data-act="skip" data-id="${n.id}" data-q="${q.id}">Skip and let the AI use this</button></p>` : "";
    return h + "</section>";
  }
  function decisionHTML(n) {
    const d = n.decision;
    const label = d.state === "open" ? "AI decision \xB7 not reviewed" : d.state === "accepted" ? "AI decision \xB7 you accepted" : "You changed the AI's decision";
    let h = `<section class="dcard ${d.state}"><div class="qlabel"><span class="pill dec">${label}</span></div>
    <h3>${esc(decisionText(n))}</h3>`;
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
  function nodePanel() {
    const n = P.nodes[sel], active = activeIds(P);
    const path = pathTo(P, sel);
    let h = `<nav class="crumbs">${path.map((id) => `<button class="link" data-act="sel" data-id="${id}">${esc(P.nodes[id].title)}</button> \u203A `).join("")}</nav>
    <span class="meta">${esc(layerName(P, sel))} \xB7 added by ${WHO[n.author]}${n.kind ? ` \xB7 ${n.kind}` : ""}</span>
    <h2>${esc(n.title)}</h2><p class="muted">${esc(n.description)}</p>`;
    if (n.author === "ai") {
      const r = ledger(P).find((e) => e.node === sel && e.type === "addition");
      h += `<div class="ainote">The AI added this part, so it is in your decision ledger. ${r?.review === "accepted" ? `<b>You kept it.</b>${n.reviewed ? ` <button class="link" data-act="review" data-id="${sel}" data-v="0">Mark as not reviewed</button>` : ""}` : `<button class="btn" data-act="review" data-id="${sel}" data-v="1">Keep it</button>`}</div>`;
    }
    if (n.needs?.length) h += `<div class="needsbox"><b>This part needs</b><ul>${n.needs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    if (n.decision) h += decisionHTML(n);
    (n.questions ?? []).forEach((q) => {
      if (isVisible(n, q)) h += qHTML(n, q);
    });
    const sgs = (n.suggestions ?? []).filter((s) => s.state !== "dismissed");
    if (sgs.length) {
      h += `<div class="sec">Ideas the AI noticed</div>`;
      sgs.forEach((s) => {
        const acc = s.state === "accepted";
        h += `<section class="sg${acc ? " acc" : ""}"><div class="qlabel"><span class="pill sug">Suggestion \xB7 optional</span></div>
        <h3>${esc(s.text)}</h3><p class="muted">${esc(s.why)}</p>${acc ? `<p class="okt">\u2713 Added to your plan</p><button class="link" data-act="sugg" data-id="${n.id}" data-s="${s.id}" data-v="open">Remove it</button>` : `<div class="dbtns"><button class="btn" data-act="sugg" data-id="${n.id}" data-s="${s.id}" data-v="accepted">Add it</button>
           <button class="btn ghost" data-act="sugg" data-id="${n.id}" data-s="${s.id}" data-v="dismissed">No thanks</button></div>`}</section>`;
      });
    }
    const kids = children(P, sel, active);
    if (kids.length) h += `<div class="sec">Parts inside this</div><div class="parts">${kids.map((k) => `<button data-act="sel" data-id="${k}">${esc(P.nodes[k].title)}</button>`).join("")}</div>`;
    const nx = nextQuestion(P);
    const rv = nx ? void 0 : ledger(P).find((e) => e.review === "open");
    h += `<div class="nextbar"><button class="next" data-act="next">${nx ? `Next question${nx.node !== sel ? ` \xB7 ${esc(P.nodes[nx.node].title)}` : ""}` : rv ? `Review the next AI choice${rv.node !== sel ? ` \xB7 ${esc(P.nodes[rv.node].title)}` : ""}` : "Everything is answered and reviewed. See what it needs"}</button></div>`;
    if (n.code) {
      h += `<div class="sec">Code</div>`;
      h += showCode ? `<pre class="code"><code>${esc(n.code.source)}</code></pre><button class="link" data-act="code" data-v="0">Hide code</button>` : `<p class="muted">This part has code. You don't need to read it to make decisions here. <button class="link" data-act="code" data-v="1">Show code</button></p>`;
    }
    return h;
  }
  function ledgerPanel() {
    const L = ledger(P);
    const open = L.filter((e) => e.review === "open");
    const list = ledgerFilter === "open" ? open : L;
    const typeLabel = { decision: "Decision", default: "Default", addition: "Added part" };
    const rev = { open: "To review", accepted: "Accepted", overridden: "You changed it" };
    let h = `<h2>Decision ledger</h2><p class="muted">Every choice the AI made on your behalf, in one place. You stay the architect:
    review any of them, change them, or leave them.</p>
    <div class="stat"><b>${L.length}</b> AI choices \xB7 <b>${L.length - open.length}</b> reviewed \xB7 <b>${open.length}</b> to review</div>
    <div class="seg"><button aria-pressed="${ledgerFilter === "open"}" data-act="lf" data-v="open">To review</button>
    <button aria-pressed="${ledgerFilter === "all"}" data-act="lf" data-v="all">All</button></div>`;
    if (!list.length) return h + `<p class="muted">${ledgerFilter === "open" ? "Nothing left to review." : "The AI has made no choices yet."}</p>`;
    return h + `<ul class="ledger">${list.map((e) => `<li class="${e.review}"><button data-act="sel" data-id="${e.node}">
    <span class="lrow"><span class="pill ${e.type === "decision" ? "dec" : e.type === "addition" ? "sug" : ""}">${typeLabel[e.type]}</span>
    <span class="rv">${rev[e.review]}</span></span>
    <b>${esc(P.nodes[e.node].title)}</b><span>${esc(e.what)}</span>${e.why ? `<small>${esc(e.why)}</small>` : ""}</button></li>`).join("")}</ul>`;
  }
  function needsPanel() {
    const s = status(P);
    let h = `<h2>What it needs</h2><p class="muted">Everything your choices add up to, in plain language.</p>`;
    h += s.openMust.length ? `<div class="status red"><strong>${s.openMust.length} decision${s.openMust.length > 1 ? "s" : ""} still need you</strong>
       <p>Nothing gets built around a gap. These are the answers the AI will not guess.</p><ul class="jl">${s.openMust.map((r) => `<li><button data-act="sel" data-id="${r.node}">${esc(r.question.text)}<small>${esc(P.nodes[r.node].title)}</small></button></li>`).join("")}</ul></div>` : `<div class="status ok"><strong>Every must-decide question is answered.</strong><p>The plan is ready to build.</p></div>`;
    h += `<div class="sec">You will need</div>`;
    h += s.needs.length ? `<ul class="plain">${s.needs.map((n) => `<li>${esc(n.need)} <small>${esc(P.nodes[n.node].title)}</small></li>`).join("")}</ul>` : `<p class="muted">Nothing yet. Make a few decisions and this fills in.</p>`;
    h += `<div class="sec">Who shaped the graph</div><p>${s.ownership.user} parts from you \xB7 ${s.ownership.ai} from the AI \xB7 ${s.ownership.doc} from library docs</p>`;
    h += `<div class="sec">Project file</div><p class="muted">The whole graph, every decision and the audit log are one JSON file.</p>
    <button class="btn ghost" data-act="download">Download .acore.json</button>`;
    return h;
  }
  function render() {
    const s = status(P), L = ledger(P);
    const total = s.made.length + s.openMust.length;
    const toReview = L.filter((e) => e.review === "open").length;
    $("#progress").innerHTML = (total ? `<b>${s.made.length}/${total}</b> your decisions` : "No decisions waiting on you") + ` \xB7 <b>${toReview}</b> AI choice${toReview === 1 ? "" : "s"} to review`;
    $("#undo").toggleAttribute("disabled", !history.length);
    $("#levels").innerHTML = P.layers.map((l, i) => `<button aria-pressed="${i === detail}" data-act="level" data-v="${i}">${esc(l)}</button>`).join("");
    $("#codeToggle").setAttribute("aria-pressed", String(showCode));
    document.getElementById("example").value = exampleKey;
    const gs = $("#graph").scrollTop, ps = $("#panel").scrollTop;
    $("#graph").innerHTML = graphHTML();
    document.querySelectorAll(".tabs [data-v]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === tab)));
    $("#cMust").textContent = s.openMust.length ? String(s.openMust.length) : "";
    $("#cLedger").textContent = toReview ? String(toReview) : "";
    $("#panelBody").innerHTML = tab === "node" ? nodePanel() : tab === "ledger" ? ledgerPanel() : needsPanel();
    $("#graph").scrollTop = gs;
    $("#panel").scrollTop = ps;
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const { act, id = "", q = "", v = "" } = t.dataset;
    switch (act) {
      case "sel":
        sel = id;
        tab = "node";
        render();
        $("#panel").scrollTop = 0;
        break;
      case "tab":
        tab = v;
        render();
        break;
      case "level":
        detail = Number(v);
        if (detail < P.layers.length - 1) showCode = false;
        render();
        break;
      case "deeper":
        detail = Math.min(detail + 1, P.layers.length - 1);
        render();
        break;
      case "code":
        showCode = v === "1";
        if (showCode) detail = P.layers.length - 1;
        render();
        break;
      case "pick": {
        const qq = P.nodes[id].questions.find((x) => x.id === q);
        if (qq.type === "multi") apply((p) => toggle(p, id, q, v));
        else apply((p) => qq.answer === v ? unanswer(p, id, q) : answer(p, id, q, v));
        break;
      }
      case "text":
        apply((p) => answer(p, id, q, document.getElementById("ta-" + q).value));
        break;
      case "skip":
        apply((p) => skip(p, id, q));
        break;
      case "unskip":
        apply((p) => unanswer(p, id, q));
        break;
      case "accept":
        apply((p) => acceptDecision(p, id));
        break;
      case "override":
        apply((p) => overrideDecision(p, id, Number(t.dataset.i)));
        break;
      case "reopen":
        apply((p) => reopenDecision(p, id));
        break;
      case "sugg":
        apply((p) => v === "accepted" ? acceptSuggestion(p, id, t.dataset.s) : v === "dismissed" ? dismissSuggestion(p, id, t.dataset.s) : resetSuggestion(p, id, t.dataset.s));
        break;
      case "codeToggle":
        showCode = !showCode;
        if (showCode) detail = P.layers.length - 1;
        render();
        break;
      case "next": {
        const nx = nextQuestion(P);
        const rv = ledger(P).find((e2) => e2.review === "open");
        if (nx) {
          sel = nx.node;
          tab = "node";
          render();
          document.getElementById("q-" + nx.question.id)?.scrollIntoView({ block: "center" });
        } else if (rv) {
          sel = rv.node;
          tab = "node";
          render();
          $("#panel").scrollTop = 0;
        } else {
          tab = "needs";
          render();
        }
        break;
      }
      case "review":
        apply((p) => reviewPart(p, id, v === "1"));
        break;
      case "lf":
        ledgerFilter = v;
        render();
        break;
      case "undo":
        if (history.length) {
          P = history.pop();
          if (!activeIds(P).has(sel)) sel = P.root;
          render();
        }
        break;
      case "reset":
        start(exampleKey);
        break;
      case "download": {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([save(P)], { type: "application/json" }));
        a.download = exampleKey + ".acore.json";
        a.click();
        URL.revokeObjectURL(a.href);
        break;
      }
    }
  });
  document.getElementById("example").addEventListener("change", (e) => start(e.target.value));
  start(exampleKey);
})();
