#!/usr/bin/env node
/**
 * Replay Write/StrReplace ops for Exchange v2 files from agent transcripts.
 * Starts tracked files from git HEAD; applies ops in chronological order.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPO = path.resolve(import.meta.dirname, "..");
const TRANSCRIPT_ROOT =
  "/Users/gjeffcock/.cursor/projects/Users-gjeffcock-Documents-github-mulesoftforge-agent-network-tracer/agent-transcripts";

const TARGET_RE =
  /^(?:components\/Exchange|app\/api\/exchange\/|lib\/mulesoft\/|lib\/zip-extract\.ts$)/;

function walkJsonl(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkJsonl(full, out);
    else if (name.endsWith(".jsonl")) out.push(full);
  }
  return out.sort();
}

function rel(abs) {
  return path.relative(REPO, abs);
}

function readHead(relPath) {
  try {
    return execSync(`git show HEAD:${relPath}`, { cwd: REPO, encoding: "utf8" });
  } catch {
    return null;
  }
}

/** @type {Array<{kind:'write'|'replace', path:string, contents?:string, old?:string, new?:string}>} */
const ops = [];

for (const jf of walkJsonl(TRANSCRIPT_ROOT)) {
  for (const line of fs.readFileSync(jf, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    for (const part of row.message?.content ?? []) {
      if (part?.type !== "tool_use") continue;
      const filePath = part.input?.path;
      if (!filePath?.startsWith(REPO)) continue;
      const r = rel(filePath);
      if (!TARGET_RE.test(r)) continue;
      if (part.name === "Write" && typeof part.input.contents === "string") {
        ops.push({ kind: "write", path: r, contents: part.input.contents });
      } else if (
        part.name === "StrReplace" &&
        typeof part.input.old_string === "string" &&
        typeof part.input.new_string === "string"
      ) {
        ops.push({
          kind: "replace",
          path: r,
          old: part.input.old_string,
          new: part.input.new_string,
        });
      }
    }
  }
}

/** @type {Map<string, string>} */
const files = new Map();

for (const op of ops) {
  if (op.kind === "write") {
    files.set(op.path, op.contents);
    continue;
  }
  let content = files.get(op.path);
  if (content == null) {
    content = readHead(op.path);
    if (content == null) continue;
  }
  if (!content.includes(op.old)) continue;
  files.set(op.path, content.replace(op.old, op.new));
}

let written = 0;
for (const [r, content] of files.entries()) {
  const head = readHead(r);
  if (head === content) continue;
  const dest = path.join(REPO, r);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  written++;
  console.log("restored", r);
}

console.log(`Done: ${written} exchange files updated (${ops.length} ops replayed).`);
