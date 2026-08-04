/** Inline `@…` completion for AgentScript instruction fields. */

import type { FlatExpressionCatalogEntry } from "@/lib/composer/agentfabric-expression-catalog";

export interface ExpressionToken {
  /** Index of the leading `@`. */
  start: number;
  /** Caret position (exclusive end of the token). */
  end: number;
  text: string;
}

/** Characters that terminate an expression token when scanning back from the caret. */
const BOUNDARY = /[\s{}()[\],'"`]/;

/** The `@…` token the caret currently sits inside, if any. */
export function activeExpressionToken(value: string, caret: number): ExpressionToken | null {
  for (let i = caret - 1; i >= 0; i--) {
    const char = value[i];
    if (char === "@") return { start: i, end: caret, text: value.slice(i, caret) };
    if (BOUNDARY.test(char)) return null;
  }
  return null;
}

function searchable(entry: FlatExpressionCatalogEntry): string {
  return `${entry.insert} ${entry.label}`.toLowerCase();
}

export function suggestExpressions(
  entries: FlatExpressionCatalogEntry[],
  token: string,
  limit = 8
): FlatExpressionCatalogEntry[] {
  // Compare without the sigil so "@gen" matches an entry written as "{!@generator…}".
  const query = token.replace(/^@/, "").toLowerCase();
  if (!query) return entries.slice(0, limit);
  const starts: FlatExpressionCatalogEntry[] = [];
  const contains: FlatExpressionCatalogEntry[] = [];
  for (const entry of entries) {
    const hay = searchable(entry);
    const at = hay.indexOf(`@${query}`);
    if (at >= 0) starts.push(entry);
    else if (hay.includes(query)) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Replace the active token with a catalog entry. When the caret is already
 * inside `{!…}` the wrapper is stripped so braces are not doubled.
 */
export function applyExpressionCompletion(
  value: string,
  token: ExpressionToken,
  entryInsert: string
): { value: string; caret: number } {
  const insideBraces = value.slice(Math.max(0, token.start - 2), token.start) === "{!";
  const text = insideBraces
    ? entryInsert.replace(/^\{!/, "").replace(/\}$/, "")
    : entryInsert;
  return {
    value: value.slice(0, token.start) + text + value.slice(token.end),
    caret: token.start + text.length,
  };
}
