#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import {
  acceptDecision, acceptSuggestion, answer, dismissSuggestion, load, nextQuestion, overrideDecision,
  save, skip, toLedgerText, toMermaid, toStatusText, toTree, validate, type Project,
} from "./index.js";

const HELP = `acore – work with abstractCORE project files (.acore.json)

  acore status   <file>                         what's decided, what's open, what it needs
  acore tree     <file> [--depth N]             layered outline, broad to specific
  acore ledger   <file>                         every choice the AI made, and whether you reviewed it
  acore next     <file>                         the next question to answer
  acore mermaid  <file> [--depth N]             Mermaid flowchart of the current graph
  acore validate <file>                         structural checks

  acore answer   <file> <node> <question> <value>[,<value>…]
  acore skip     <file> <node> <question>       use the AI's stated default
  acore accept   <file> <node>                  agree with the AI's decision on a node
  acore override <file> <node> <alternative#>   choose one of its alternatives (0-based)
  acore suggest  <file> <node> <id> add|dismiss

Commands that change the project write it back to <file>.`;

function main(argv: string[]): number {
  const di = argv.indexOf("--depth");
  const view = di >= 0 ? { maxDepth: Number(argv[di + 1]) } : {};
  if (di >= 0) argv = argv.filter((_, i) => i !== di && i !== di + 1);
  const [cmd, file, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || !file) { console.log(HELP); return cmd ? 0 : 1; }
  const text = readFileSync(file, "utf8");

  if (cmd === "validate") {
    const issues = validate(JSON.parse(text));
    issues.forEach(i => console.log(`${i.level === "error" ? "✗" : "!"} ${i.at}: ${i.message}`));
    const errors = issues.filter(i => i.level === "error").length;
    console.log(errors ? `${errors} error(s)` : `OK${issues.length ? ` with ${issues.length} warning(s)` : ""}`);
    return errors ? 1 : 0;
  }

  const p = load(text);
  const write = (next: Project) => { writeFileSync(file, save(next)); console.log(toStatusText(next).split("\n").slice(0, 2).join("\n")); };

  switch (cmd) {
    case "status": console.log(toStatusText(p)); return 0;
    case "tree": console.log(toTree(p, view)); return 0;
    case "mermaid": console.log(toMermaid(p, view)); return 0;
    case "ledger": console.log(toLedgerText(p)); return 0;
    case "next": {
      const n = nextQuestion(p);
      if (!n) { console.log("Everything is answered."); return 0; }
      const q = n.question;
      console.log(`${p.nodes[n.node].title} › ${q.text}  [${q.kind === "must" ? "you must decide" : "question"}]`);
      if (q.why) console.log(`  why it's yours: ${q.why}`);
      q.options?.forEach(o => console.log(`  ${o.value.padEnd(10)} ${o.label}`));
      if (q.default) console.log(`  if skipped: ${q.default}`);
      console.log(`\n  acore answer ${file} ${n.node} ${q.id} <value>`);
      return 0;
    }
    case "answer": {
      const [node, qid, ...v] = rest;
      const q = p.nodes[node]?.questions?.find(x => x.id === qid);
      const raw = v.join(" ");
      write(answer(p, node, qid, q?.type === "multi" ? raw.split(",").map(s => s.trim()).filter(Boolean) : raw));
      return 0;
    }
    case "skip": write(skip(p, rest[0], rest[1])); return 0;
    case "accept": write(acceptDecision(p, rest[0])); return 0;
    case "override": write(overrideDecision(p, rest[0], Number(rest[1]))); return 0;
    case "suggest":
      write(rest[2] === "dismiss" ? dismissSuggestion(p, rest[0], rest[1]) : acceptSuggestion(p, rest[0], rest[1]));
      return 0;
    default: console.log(HELP); return 1;
  }
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (e) { console.error((e as Error).message); process.exitCode = 1; }
