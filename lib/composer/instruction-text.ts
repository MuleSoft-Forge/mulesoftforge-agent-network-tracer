/** AgentScript procedure marker — not user-facing instruction content. */
const PROCEDURE_MARKER = "->";

/**
 * Normalize text parsed from `.agent` fields. Empty or bare `->` becomes undefined
 * so the model never stores procedure syntax as prompt/instruction content.
 */
export function normalizeParsedInstructionText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === PROCEDURE_MARKER) return undefined;
  return value;
}

/** Value shown in canvas inspector text areas (hides legacy `->` artifacts). */
export function instructionTextForEditor(value: string | undefined): string {
  if (!value) return "";
  if (value.trim() === PROCEDURE_MARKER) return "";
  return value;
}
