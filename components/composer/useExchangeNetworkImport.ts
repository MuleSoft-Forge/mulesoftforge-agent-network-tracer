"use client";

import { useCallback, useState } from "react";
import type { ComposerProject } from "@/lib/composer/model";
import { parseProjectFiles } from "@/lib/composer/parse";
import { selectProjectSourceFiles, type ProjectZipEntry } from "@/lib/composer/import/select-project-files";
import { detectProjectVersion, projectVersionLabel } from "@/lib/mulesoft/agent-network-project-version";
import type { ExchangeNetworkSelection } from "@/components/main-content/useExchangeNetworkList";

interface ExchangeAssetFile {
  classifier?: string | null;
  packaging?: string;
  downloadURL?: string;
}

function isFatClassifier(classifier: string | null | undefined): boolean {
  return (classifier ?? "").toLowerCase().startsWith("fat-");
}

/** The one non-fat zip holding the real project sources. */
function findProjectZip(files: ExchangeAssetFile[]): ExchangeAssetFile | undefined {
  return files.find(
    (f) =>
      f.packaging === "zip" &&
      !isFatClassifier(f.classifier) &&
      (f.classifier === "agent-network" ||
        f.classifier === "agentic-network" ||
        f.classifier === "broker-group")
  );
}

async function fetchAssetFiles(
  groupId: string,
  assetId: string,
  version: string
): Promise<ExchangeAssetFile[]> {
  const params = new URLSearchParams({ organizationId: groupId, assetId, version });
  const res = await fetch(`/api/exchange/asset?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load asset files (${res.status})`);
  const data = (await res.json()) as { files?: ExchangeAssetFile[] };
  return data.files ?? [];
}

async function extractProjectZip(zip: ExchangeAssetFile): Promise<ProjectZipEntry[]> {
  if (!zip.downloadURL) return [];
  const params = new URLSearchParams({
    downloadURL: zip.downloadURL,
    classifier: zip.classifier ?? "project",
  });
  const res = await fetch(`/api/exchange/extract-zip?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to extract project zip (${res.status})`);
  const data = (await res.json()) as { files?: ProjectZipEntry[] };
  return data.files ?? [];
}

export interface NetworkImportResult {
  project: ComposerProject;
  warnings: string[];
}

export function useExchangeNetworkImport() {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importNetwork = useCallback(
    async (network: ExchangeNetworkSelection, version: string): Promise<NetworkImportResult | null> => {
      setImporting(true);
      setError(null);
      try {
        const files = await fetchAssetFiles(network.groupId, network.assetId, version);
        const zip = findProjectZip(files);
        if (!zip) {
          throw new Error("This network version has no downloadable project sources.");
        }
        const entries = await extractProjectZip(zip);
        const input = selectProjectSourceFiles(entries);
        if (!input.agentYaml && !input.exchangeJson && !input.brokerAgent) {
          throw new Error("Could not find agent-network.yaml, exchange.json, or a broker .agent in the zip.");
        }

        // The Composer model targets agent-network v2. v1 projects use a
        // different YAML shape the parser/serializers don't round-trip, so we
        // refuse to open them for editing rather than silently corrupt them.
        const projectVersion = detectProjectVersion({
          zipClassifier: zip.classifier,
          yamlContent: input.agentYaml,
        });
        if (projectVersion === "v1") {
          throw new Error(
            `This is an ${projectVersionLabel("v1")} project. The Builder can only open agent network v2 projects for editing.`
          );
        }

        const parsed = parseProjectFiles({ ...input, fallbackGroupId: network.groupId });
        if (!parsed.ok) {
          throw new Error(`Import failed: ${parsed.errors.join("; ")}`);
        }
        return { project: parsed.project, warnings: parsed.warnings };
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to import network");
        return null;
      } finally {
        setImporting(false);
      }
    },
    []
  );

  return { importNetwork, importing, error };
}
