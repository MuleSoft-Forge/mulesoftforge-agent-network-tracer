/** Fold an AgentScript expression to one line without changing quoted whitespace. */
export function compactAgentScriptExpression(source: string): string {
  let output = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let pendingSpace = false;

  for (const character of source.trim()) {
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      if (pendingSpace && output) output += " ";
      pendingSpace = false;
      quote = character;
      output += character;
      continue;
    }
    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output) output += " ";
    pendingSpace = false;
    output += character;
  }

  return output;
}
