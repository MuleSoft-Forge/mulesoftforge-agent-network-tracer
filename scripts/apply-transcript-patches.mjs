#!/usr/bin/env node
/** Apply ApplyPatch tool ops from agent transcripts (Add/Update files). */
import fs from "node:fs";
import path from "node:path";

const TRANSCRIPT =
  "/Users/gjeffcock/.cursor/projects/Users-gjeffcock-Documents-github-mulesoftforge-agent-network-tracer/agent-transcripts/0f990d3b-e7b1-40c9-8b48-0444015f160e/0f990d3b-e7b1-40c9-8b48-0444015f160e.jsonl";
const REPO = path.resolve(import.meta.dirname, "..");
const SKIP = /(?:^|\/)(?:components\/(?:studio|editor)|lib\/(?:studio|editor)|app\/api\/(?:studio|editor)|workers\/)/;

function applyUnifiedDiff(filePath, hunks) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = content.split("\n");
  for (const hunk of hunks) {
    const oldLines = hunk.oldLines;
    const newLines = hunk.newLines;
    const block = oldLines.join("\n");
    const joined = lines.join("\n");
    if (!joined.includes(block)) continue;
    const next = joined.replace(block, newLines.join("\n"));
    content = next;
    lines.length = 0;
    lines.push(...content.split("\n"));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.endsWith("\n") || content.length === 0 ? content : content + "\n");
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

function applyAdd(filePath, body) {
  const lines = body
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

function applyUpdate(filePath, body) {
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
  applyUnifiedDiff(filePath, hunks);
}

const text = fs.readFileSync(TRANSCRIPT, "utf8");
for (const line of text.split("\n")) {
  if (!line.includes('"ApplyPatch"')) continue;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  for (const part of row.message?.content ?? []) {
    if (part?.name !== "ApplyPatch" || typeof part.input !== "string") continue;
    const patch = part.input.replace(/^\*\*\* Begin Patch\n/, "").replace(/\n\*\*\* End Patch\n?$/, "");
    for (const op of parsePatch(patch)) {
      const rel = path.relative(REPO, op.filePath);
      if (SKIP.test(rel)) continue;
      const dest = path.join(REPO, rel);
      if (op.kind === "add") {
        applyAdd(dest, op.body);
        console.log("add", rel);
      } else {
        applyUpdate(dest, op.body);
        console.log("update", rel);
      }
    }
  }
}
