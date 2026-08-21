/**
 * Parse a local agent-network project (folder or zip entries) into a Builder model.
 */

import type { ComposerProject } from "@/lib/composer/model";
import { parseProjectFiles } from "@/lib/composer/parse";
import { selectProjectSourceFiles, type ProjectZipEntry } from "@/lib/composer/import/select-project-files";
import {
  detectProjectVersion,
  projectVersionLabel,
} from "@/lib/mulesoft/agent-network-project-version";

export interface LocalProjectImportResult {
  project: ComposerProject;
  warnings: string[];
}

export function importLocalProjectEntries(
  entries: ProjectZipEntry[],
  fallbackGroupId?: string
): LocalProjectImportResult {
  const input = selectProjectSourceFiles(entries);
  if (!input.agentYaml && !input.exchangeJson && !input.brokerAgent) {
    throw new Error(
      "Could not find exchange.json, agent-network.yaml, or a broker .agent file in the project."
    );
  }

  const projectVersion = detectProjectVersion({ yamlContent: input.agentYaml });
  if (projectVersion === "v1") {
    throw new Error(
      `This is an ${projectVersionLabel("v1")} project. The Builder can only open agent network v2 projects for editing.`
    );
  }

  const parsed = parseProjectFiles({ ...input, fallbackGroupId: fallbackGroupId || "" });
  if (!parsed.ok) {
    throw new Error(`Import failed: ${parsed.errors.join("; ")}`);
  }
  return { project: parsed.project, warnings: parsed.warnings };
}
