import type { ComposerProject } from "@/lib/composer/model";
import { lintAgentFabricSource } from "@/lib/composer/agentscript-lint";
import { serializeProject, type SerializedFile } from "@/lib/composer/serialize";

export interface AgentScriptConformanceError {
  path: string;
  message: string;
}

export interface AgentScriptSourceEntry {
  filename: string;
  content: string;
}

export interface AgentScriptValidationOptions {
  /**
   * Permit only the known action-definition `http_headers` diagnostics so the
   * parser can migrate those headers to invocation-level bindings. Every other
   * official error remains blocking.
   */
  allowMigratableLegacyActionHeaders?: boolean;
}

function agentFiles(files: SerializedFile[]): SerializedFile[] {
  return files.filter((file) => file.language === "agent");
}

interface PreparedAgentScript {
  source: string;
  errors: string[];
}

function lineIndent(line: string): number {
  return line.match(/^(\s*)/)?.[1].length ?? 0;
}

function hasOnlyRunScopedOutputsReferences(source: string): boolean {
  let activeRunIndent: number | null = null;
  let outputReferenceCount = 0;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = lineIndent(line);
    if (activeRunIndent !== null && indent <= activeRunIndent) activeRunIndent = null;
    if (/(?:^|->\s*)run\s+@actions\./.test(trimmed)) {
      activeRunIndent = indent;
      continue;
    }
    if (!trimmed.includes("@outputs")) continue;
    outputReferenceCount++;
    if (
      activeRunIndent === null ||
      indent <= activeRunIndent ||
      !/^set\s+@variables\.[\w.-]+\s*=/.test(trimmed)
    ) {
      return false;
    }
  }
  return outputReferenceCount > 0;
}

/**
 * Remove only parseable legacy action-level header maps before official lint.
 * The project parser subsequently migrates the captured values to every
 * invocation. Malformed maps remain blocking rather than being discarded.
 */
function prepareMigratableLegacyActionHeaders(source: string): PreparedAgentScript {
  const lines = source.split("\n");
  const output: string[] = [];
  const errors: string[] = [];
  let inActions = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = lineIndent(line);

    if (indent === 0 && trimmed && !trimmed.startsWith("#")) {
      inActions = trimmed === "actions:";
    }

    if (inActions && indent === 4 && /^http_headers:\s*$/.test(trimmed)) {
      const blockLine = index + 1;
      let headerCount = 0;
      const headerNames = new Set<string>();
      index++;
      while (index < lines.length) {
        const headerLine = lines[index];
        const headerText = headerLine.trim();
        if (headerText && !headerText.startsWith("#") && lineIndent(headerLine) <= 4) break;
        if (headerText && !headerText.startsWith("#")) {
          const header = headerText.match(/^([\w.-]+):\s*(.+)$/);
          let literalValue: unknown;
          if (header) {
            try {
              literalValue = JSON.parse(header[2]);
            } catch {
              literalValue = undefined;
            }
          }
          if (
            lineIndent(headerLine) !== 6 ||
            !header ||
            typeof literalValue !== "string"
          ) {
            errors.push(
              `Legacy action-level http_headers at line ${blockLine} must use one double-quoted string value per header.`
            );
          } else if (headerNames.has(header[1])) {
            errors.push(
              `Legacy action-level http_headers at line ${blockLine} contains duplicate header "${header[1]}".`
            );
          } else {
            headerNames.add(header[1]);
            headerCount++;
          }
        }
        index++;
      }
      if (headerCount === 0) {
        errors.push(
          `Legacy action-level http_headers at line ${blockLine} must contain at least one header.`
        );
      }
      continue;
    }

    output.push(line);
    index++;
  }

  return { source: output.join("\n"), errors };
}

/** Official AgentFabric severity 1 diagnostics for one exact source string. */
export async function validateAgentScriptSource(
  source: string,
  path = "broker .agent",
  options: AgentScriptValidationOptions = {}
): Promise<AgentScriptConformanceError[]> {
  const prepared = options.allowMigratableLegacyActionHeaders
    ? prepareMigratableLegacyActionHeaders(source)
    : { source, errors: [] };
  const diagnostics = await lintAgentFabricSource(prepared.source);
  const allowRunScopedOutputsDiagnostic = hasOnlyRunScopedOutputsReferences(prepared.source);
  return [
    ...prepared.errors.map((message) => ({ path, message })),
    ...diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.severity === 1 &&
          !(
            allowRunScopedOutputsDiagnostic &&
            diagnostic.message === "'@outputs' is not a recognized namespace"
          )
      )
      .map((diagnostic) => ({ path, message: diagnostic.message })),
  ];
}

/** Validate the exact .agent bytes that export/publish/deploy would consume. */
export async function validateProjectAgentScripts(
  project: ComposerProject
): Promise<AgentScriptConformanceError[]> {
  const errors: AgentScriptConformanceError[] = [];
  for (const file of agentFiles(serializeProject(project))) {
    errors.push(...(await validateAgentScriptSource(file.content, file.path)));
  }
  return errors;
}

export async function validateAgentScriptEntries(
  entries: ReadonlyArray<AgentScriptSourceEntry>
): Promise<AgentScriptConformanceError[]> {
  const errors: AgentScriptConformanceError[] = [];
  const agentEntries = entries.filter((entry) => /\.agent$/i.test(entry.filename));
  if (agentEntries.length === 0) {
    return [{ path: "(bundle)", message: "Bundle must contain at least one .agent file." }];
  }
  for (const entry of agentEntries) {
    errors.push(...(await validateAgentScriptSource(entry.content, entry.filename)));
  }
  return errors;
}

export async function assertProjectAgentScriptsConform(
  project: ComposerProject
): Promise<void> {
  const errors = await validateProjectAgentScripts(project);
  if (errors.length === 0) return;
  const details = errors
    .slice(0, 5)
    .map((error) => `${error.path}: ${error.message}`)
    .join("; ");
  const remainder = errors.length > 5 ? `; plus ${errors.length - 5} more` : "";
  throw new Error(`AgentScript conformance failed: ${details}${remainder}`);
}
