/**
 * Client-side helpers to fetch raw agent-network project sources from Exchange
 * (exchange.json, agent-network.yaml, brokers/*.agent) without parsing them.
 */

import type { ProjectZipEntry } from "@/lib/composer/import/select-project-files";

export interface ExchangeAssetFile {
  classifier?: string | null;
  packaging?: string;
  downloadURL?: string;
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function isFatClassifier(classifier: string | null | undefined): boolean {
  return (classifier ?? "").toLowerCase().startsWith("fat-");
}

/** The one non-fat zip holding the real project sources. */
export function findProjectZip(files: ExchangeAssetFile[]): ExchangeAssetFile | undefined {
  return files.find(
    (f) =>
      f.packaging === "zip" &&
      !isFatClassifier(f.classifier) &&
      (f.classifier === "agent-network" || f.classifier === "agentic-network" || f.classifier === "broker-group")
  );
}

/** Core editable project files used for Builder compare baselines. */
export function filterComparableProjectEntries(entries: ProjectZipEntry[]): ProjectZipEntry[] {
  return entries.filter((e) => {
    const norm = e.filename.replace(/\\/g, "/");
    const base = basename(norm);
    if (base.toLowerCase() === "exchange.json") return true;
    if (/agent-network\.ya?ml$/i.test(base)) return true;
    if (/\.agent$/i.test(norm)) return true;
    return false;
  });
}

export async function fetchExchangeAssetFiles(
  groupId: string,
  assetId: string,
  version: string
): Promise<ExchangeAssetFile[]> {
  const params = new URLSearchParams({ organizationId: groupId, assetId, version });
  const res = await fetch(`/api/exchange/asset?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to load asset files (${res.status})`);
  }
  const data = (await res.json()) as { files?: ExchangeAssetFile[] };
  return data.files ?? [];
}

export async function extractProjectZipEntries(zip: ExchangeAssetFile): Promise<ProjectZipEntry[]> {
  if (!zip.downloadURL) return [];
  const params = new URLSearchParams({
    downloadURL: zip.downloadURL,
    classifier: zip.classifier ?? "project",
  });
  const res = await fetch(`/api/exchange/extract-zip?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to extract project zip (${res.status})`);
  }
  const data = (await res.json()) as { files?: ProjectZipEntry[] };
  return data.files ?? [];
}

/** Download raw project source entries from Exchange (unparsed, as published). */
export async function fetchComparableProjectEntries(
  groupId: string,
  assetId: string,
  version: string
): Promise<ProjectZipEntry[]> {
  const assetFiles = await fetchExchangeAssetFiles(groupId, assetId, version);
  const projectZip = findProjectZip(assetFiles);
  if (!projectZip) {
    throw new Error("This version has no downloadable project zip on Exchange.");
  }
  const extracted = await extractProjectZipEntries(projectZip);
  const comparable = filterComparableProjectEntries(extracted);
  if (comparable.length === 0) {
    throw new Error("Project zip has no exchange.json, agent-network.yaml, or broker .agent files.");
  }
  return comparable;
}

export function exchangeBaselineZipName(assetId: string, version: string): string {
  return `${assetId}-${version}-baseline.zip`;
}
