#!/usr/bin/env node
/**
 * Recover all non-studio/editor work from agent transcripts.
 * Replays Write, StrReplace, and ApplyPatch with deduplication to avoid
 * duplicate-import / duplicate-declaration corruption from replaying ops twice.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPO = path.resolve(import.meta.dirname, "..");
const TRANSCRIPT_ROOT =
  "/Users/gjeffcock/.cursor/projects/Users-gjeffcock-Documents-github-mulesoftforge-agent-network-tracer/agent-transcripts";

const SKIP_PATH_RE =
  /(?:^|\/)(?:components\/(?:studio|editor)|lib\/(?:studio|editor)|app\/api\/(?:studio|editor)|workers\/)/;

function shouldSkip(rel) {
  return SKIP_PATH_RE.test(rel);
}

function rel(absPath) {
  return path.relative(REPO, absPath);
}

function readHead(relPath) {
  try {
    return execSync(`git show HEAD:${relPath}`, { cwd: REPO, encoding: "utf8" });
  } catch {
    return null;
  }
}

function walkJsonl(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkJsonl(full, out);
    else if (name.endsWith(".jsonl")) out.push(full);
  }
  return out.sort();
}

function dedupeConsecutiveLines(source) {
  const lines = source.split("\n");
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && line === prev && line.trim() !== "") continue;
    out.push(line);
  }
  return out.join("\n");
}

function parsePatch(patchText) {
  const ops = [];
  const chunks = patchText.split("*** ");
  for (const chunk of chunks) {
    if (chunk.startsWith("Add File: ") || chunk.startsWith("Update File: ")) {
      const nl = chunk.indexOf("\n");
      const header = chunk.slice(0, nl);
      const body = chunk.slice(nl + 1);
      const filePath = header.replace(/^(Add File:|Update File:)\s*/, "").trim();
      ops.push({ kind: header.startsWith("Add") ? "add" : "update", filePath, body });
    }
  }
  return ops;
}

function applyUnifiedDiff(content, hunks) {
  let text = content;
  const lines = text.split("\n");
  for (const hunk of hunks) {
    const block = hunk.oldLines.join("\n");
    const joined = lines.join("\n");
    if (!joined.includes(block)) continue;
    text = joined.replace(block, hunk.newLines.join("\n"));
    lines.length = 0;
    lines.push(...text.split("\n"));
  }
  return text;
}

function parseUpdateHunks(body) {
  const hunks = [];
  let current = null;
  for (const line of body.split("\n")) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { oldLines: [], newLines: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("-") && !line.startsWith("---")) current.oldLines.push(line.slice(1));
    else if (line.startsWith("+") && !line.startsWith("+++")) current.newLines.push(line.slice(1));
    else if (line.startsWith(" ")) {
      current.oldLines.push(line.slice(1));
      current.newLines.push(line.slice(1));
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function applyAddContent(body) {
  return body
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

/** @type {Array<{kind:'write'|'replace'|'patch-add'|'patch-update', path:string, contents?:string, old?:string, new?:string, body?:string}>} */
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

      if (part.name === "ApplyPatch" && typeof part.input === "string") {
        const patch = part.input
          .replace(/^\*\*\* Begin Patch\n/, "")
          .replace(/\n\*\*\* End Patch\n?$/, "");
        for (const op of parsePatch(patch)) {
          const r = rel(op.filePath);
          if (shouldSkip(r)) continue;
          ops.push({
            kind: op.kind === "add" ? "patch-add" : "patch-update",
            path: r,
            body: op.body,
          });
        }
        continue;
      }

      const filePath = part.input?.path;
      if (!filePath?.startsWith(REPO)) continue;
      const r = rel(filePath);
      if (shouldSkip(r)) continue;

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

/** @type {Set<string>} */
const touched = new Set(ops.map((o) => o.path));

/** @type {Map<string, string>} */
const files = new Map();
for (const r of touched) {
  files.set(r, readHead(r) ?? "");
}

/** @type {Set<string>} */
const appliedReplace = new Set();

for (const op of ops) {
  if (op.kind === "write") {
    files.set(op.path, op.contents);
    continue;
  }

  let content = files.get(op.path);
  if (content == null) {
    content = readHead(op.path) ?? "";
    files.set(op.path, content);
  }

  if (op.kind === "replace") {
    const key = `${op.path}\0${op.old}`;
    if (appliedReplace.has(key)) continue;
    if (!content.includes(op.old)) continue;
    files.set(op.path, content.replace(op.old, op.new));
    appliedReplace.add(key);
    continue;
  }

  if (op.kind === "patch-add") {
    files.set(op.path, applyAddContent(op.body));
    continue;
  }

  if (op.kind === "patch-update") {
    const hunks = parseUpdateHunks(op.body);
    files.set(op.path, applyUnifiedDiff(content, hunks));
  }
}

let written = 0;
for (const [r, raw] of files.entries()) {
  if (shouldSkip(r)) continue;
  const content = dedupeConsecutiveLines(raw);
  const dest = path.join(REPO, r);
  const existing = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (existing === content) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content.endsWith("\n") || content.length === 0 ? content : content + "\n");
  written++;
  console.log("restored", r);
}

console.log(`Done: ${written} files updated (${ops.length} ops from transcripts).`);
