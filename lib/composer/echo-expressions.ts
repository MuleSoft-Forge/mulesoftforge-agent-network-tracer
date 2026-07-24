/** Parse/serialize helpers for echo `message` and `artifact` AgentScript expressions. */

function getIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Collect lines nested under `lines[startIdx]` (indent > keyIndent). */
function collectDeeper(lines: string[], startIdx: number, keyIndent: number): string[] {
  const out: string[] = [];
  for (let j = startIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (isBlank(l)) continue;
    if (getIndent(l) <= keyIndent) break;
    out.push(l.trim());
  }
  return out;
}

/**
 * Read a multiline AgentScript expression for `key: …` at `lineIdx`
 * (e.g. `message: a2a.message({ … })` or `artifact: a2a.artifact({ … })`).
 */
export function readExpressionValue(lines: string[], lineIdx: number): string | undefined {
  const line = lines[lineIdx];
  const keyIndent = getIndent(line);
  const m = line.trim().match(/^[\w]+:\s*(.*)$/);
  if (!m) return undefined;

  const parts: string[] = [];
  const first = m[1].trim();
  if (first) parts.push(first);
  parts.push(...collectDeeper(lines, lineIdx, keyIndent));

  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined || undefined;
}

/** Default artifact expression for newly created artifact echo nodes. */
export function defaultArtifactExpr(): string {
  return 'a2a.artifact({artifactId: uuid(), name: "artifact", parts: [a2a.textPart("")], metadata: {}})';
}

/**
 * Format a status echo `message` value for the .agent file.
 * Preserves full `a2a.message(...)` or bare `@node.ref` expressions; wraps simple text.
 */
export function formatMessageExpr(raw: string): string {
  const m = raw.trim();
  if (!m) return "a2a.message({messageId: uuid(), parts: [a2a.textPart(\"\")]})";
  if (m.startsWith("a2a.message(")) return m;
  if (/^@[\w.-]+(\.[\w.-]+)*$/.test(m)) return m;

  const part =
    m.startsWith("a2a.textPart(") || m.startsWith("@") || m.startsWith('"') || m.includes(" + ")
      ? m.startsWith("a2a.textPart(")
        ? m
        : `a2a.textPart(${m})`
      : `a2a.textPart(${JSON.stringify(m)})`;

  return `a2a.message({messageId: uuid(), parts: [${part}]})`;
}

/** True when `message` is already a full dialect message expression. */
export function isFullMessageExpr(value: string): boolean {
  const v = value.trim();
  return v.startsWith("a2a.message(") || /^@[\w.-]+(\.[\w.-]+)*$/.test(v);
}
