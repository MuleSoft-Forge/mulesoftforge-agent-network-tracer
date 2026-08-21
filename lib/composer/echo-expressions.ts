/** Parse/serialize helpers for echo `message` and `artifact` AgentScript expressions. */

import { compactAgentScriptExpression } from "@/lib/composer/agentscript-expression";

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

function bracketDepth(source: string): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth = Math.max(0, depth - 1);
  }
  return depth;
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

  let combined = parts.join(" ");
  let j = lineIdx + 1;

  // Continue through same-indent closers (`})`) until brackets balance.
  while (j < lines.length) {
    if (bracketDepth(combined) <= 0) break;
    const next = lines[j];
    if (isBlank(next)) {
      j += 1;
      continue;
    }
    const nextIndent = getIndent(next);
    if (nextIndent < keyIndent) break;
    if (nextIndent === keyIndent && bracketDepth(combined) <= 0) break;
    parts.push(next.trim());
    combined = parts.join(" ");
    j += 1;
  }

  if (parts.length === (first ? 1 : 0)) {
    parts.push(...collectDeeper(lines, lineIdx, keyIndent));
  }

  const joined = compactAgentScriptExpression(parts.join("\n"));
  return joined || undefined;
}

/** Default artifact expression for newly created artifact echo nodes. */
export function defaultArtifactExpr(): string {
  return 'a2a.artifact({artifactId: uuid(), name: "artifact", parts: [a2a.textPart("")], metadata: {}})';
}

/** Default status message expression for newly created status echo nodes. */
export function defaultStatusMessageExpr(): string {
  return 'a2a.message({messageId: uuid(), parts: [a2a.textPart("" + @request.payload.message.parts[0].text)]})';
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
    m.startsWith("a2a.textPart(") || m.startsWith("@") || m.startsWith('"')
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

/** Emit indented `message:` lines; multiline when value is a full `a2a.message({…})`. */
export function emitStatusMessageLines(message: string, baseIndent: number): string[] {
  const pad = " ".repeat(baseIndent);
  const m = message.trim();
  if (!m) return [`${pad}message: ${formatMessageExpr("")}`];
  if (!m.startsWith("a2a.message(")) return [`${pad}message: ${formatMessageExpr(m)}`];

  const partsMatch = m.match(/a2a\.message\(\{\s*messageId:\s*uuid\(\),\s*parts:\s*\[\s*(.+?)\s*\]\s*\}\)\s*$/);
  if (!partsMatch) return [`${pad}message: ${compactAgentScriptExpression(m)}`];

  const part = partsMatch[1].trim();
  return [
    `${pad}message: a2a.message({`,
    `${pad}  messageId: uuid(),`,
    `${pad}  parts: [`,
    `${pad}    ${part}`,
    `${pad}  ]`,
    `${pad}})`,
  ];
}
