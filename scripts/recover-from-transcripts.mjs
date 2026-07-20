#!/usr/bin/env node
/**
 * Recover file contents from Cursor agent transcripts by replaying Write/StrReplace ops.
 * Excludes studio/editor paths (intentionally rolled back).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const REPO = path.resolve(import.meta.dirname, "..");
const TRANSCRIPT_ROOT =
  "/Users/gjeffcock/.cursor/projects/Users-gjeffcock-Documents-github-mulesoftforge-agent-network-tracer/agent-transcripts";

const SKIP_PATH_RE =
  /(?:^|\/)(?:components\/(?:studio|editor)|lib\/(?:studio|editor)|app\/api\/(?:studio|editor)|workers\/)/;

function shouldSkip(filePath) {
  const rel = path.relative(REPO, filePath);
  return SKIP_PATH_RE.test(rel);
}

function collectJsonlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(".jsonl")) out.push(full);
    }
  }
  walk(dir);
  return out.sort();
}

/** @type {Map<string, string>} */
const files = new Map();

function relPath(absPath) {
  return path.relative(REPO, absPath);
}

function ensureFromHead(absPath) {
  const rel = relPath(absPath);
  if (files.has(rel)) return;
  try {
    files.set(rel, execSync(`git show HEAD:${rel}`, { cwd: REPO, encoding: "utf8" }));
  } catch {
    // untracked in HEAD — will appear on Write
  }
}

function applyWrite(absPath, contents) {
  if (shouldSkip(absPath)) return;
  files.set(relPath(absPath), contents);
}

function applyStrReplace(absPath, oldString, newString) {
  if (shouldSkip(absPath)) return;
  ensureFromHead(absPath);
  const rel = relPath(absPath);
  const current = files.get(rel);
  if (current == null) return;
  if (!current.includes(oldString)) return;
  files.set(rel, current.replace(oldString, newString));
}

function processLine(line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return;
  }
  const content = row?.message?.content;
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part?.type !== "tool_use") continue;
    const name = part.name;
    const input = part.input ?? {};
    const filePath = input.path;
    if (!filePath || !filePath.startsWith(REPO)) continue;

    if (name === "Write" && typeof input.contents === "string") {
      applyWrite(filePath, input.contents);
    } else if (
      name === "StrReplace" &&
      typeof input.old_string === "string" &&
      typeof input.new_string === "string"
    ) {
      applyStrReplace(filePath, input.old_string, input.new_string);
    }
  }
}

const jsonlFiles = collectJsonlFiles(TRANSCRIPT_ROOT);
console.log(`Scanning ${jsonlFiles.length} transcript files…`);
for (const file of jsonlFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    processLine(line);
  }
}

let written = 0;
let skipped = 0;
for (const [rel, contents] of files.entries()) {
  if (shouldSkip(path.join(REPO, rel))) {
    skipped++;
    continue;
  }
  let headContents;
  try {
    headContents = execSync(`git show HEAD:${rel}`, { cwd: REPO, encoding: "utf8" });
  } catch {
    headContents = null;
  }
  if (headContents === contents) continue;

  const dest = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, contents);
  written++;
  console.log(`restored ${rel}`);
}

console.log(`Done: ${written} files written, ${skipped} studio/editor skipped.`);
