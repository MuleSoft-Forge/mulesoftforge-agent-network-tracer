import { readBodyWithLimit, extractTextFiles } from "@/lib/zip-extract";
import {
  parseExchangeMetadataFile,
  type AgentNetworkMetadata,
} from "@/lib/mulesoft/exchange-asset-metadata";
import {
  findAgentNetworkMetadataFile,
  findProjectZipFile,
  type ExchangeAssetFileEntry,
} from "@/lib/mulesoft/exchange-network-asset-files";
import {
  findProjectSourcesInFiles,
  resolveNetworkTopology,
  type NetworkTopology,
} from "@/lib/mulesoft/exchange-network-topology";
import { resolveExchangeFileDownloadUrls } from "@/lib/mulesoft/exchange-file-download";

interface ExchangeAssetVersionDetail {
  files?: ExchangeAssetFileEntry[];
}

async function fetchAssetVersionDetail(
  baseUrl: string,
  groupId: string,
  assetId: string,
  version: string,
  accessToken: string
): Promise<ExchangeAssetFileEntry[]> {
  const url = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(groupId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as ExchangeAssetVersionDetail;
  return data.files ?? [];
}

async function downloadFileText(
  baseUrl: string,
  accessToken: string,
  asset: { groupId: string; assetId: string; version: string },
  file: ExchangeAssetFileEntry
): Promise<string | null> {
  const urls = resolveExchangeFileDownloadUrls(baseUrl, asset, file);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) return await res.text();
    } catch {
      /* try next URL */
    }
  }
  return null;
}

async function downloadProjectZipEntries(
  baseUrl: string,
  accessToken: string,
  asset: { groupId: string; assetId: string; version: string },
  file: ExchangeAssetFileEntry
): Promise<Array<{ classifier?: string; packaging?: string; content?: string | null }>> {
  const urls = resolveExchangeFileDownloadUrls(baseUrl, asset, file);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) continue;
      const buffer = await readBodyWithLimit(res);
      if (!buffer) continue;
      return extractTextFiles(buffer).map((entry) => {
        const dot = entry.filename.lastIndexOf(".");
        return {
          classifier: dot > 0 ? entry.filename.slice(0, dot) : entry.filename,
          packaging: dot > 0 ? entry.filename.slice(dot + 1) : "txt",
          content: entry.content,
        };
      });
    } catch {
      /* try next URL */
    }
  }
  return [];
}

/**
 * Resolves brokers[] + registry[] for one published agent-network version.
 * Prefers agent-network-metadata.json; falls back to project zip sources.
 */
export async function loadNetworkTopologyForVersion(
  baseUrl: string,
  groupId: string,
  assetId: string,
  version: string,
  accessToken: string
): Promise<{ topology: NetworkTopology; networkMetadata: AgentNetworkMetadata | null }> {
  const assetRef = { groupId, assetId, version };
  const files = await fetchAssetVersionDetail(baseUrl, groupId, assetId, version, accessToken);

  const metadataFile = findAgentNetworkMetadataFile(files);
  if (metadataFile) {
    const content = await downloadFileText(baseUrl, accessToken, assetRef, metadataFile);
    const parsed = parseExchangeMetadataFile("agent-network-metadata", content);
    const networkMetadata =
      parsed?.fileKind === "agent-network-metadata" ? parsed : null;
    if (networkMetadata) {
      return {
        topology: resolveNetworkTopology({ networkMetadata, sources: {} }),
        networkMetadata,
      };
    }
  }

  const projectZip = findProjectZipFile(files);
  const zipFiles = projectZip
    ? await downloadProjectZipEntries(baseUrl, accessToken, assetRef, projectZip)
    : [];
  const sources = findProjectSourcesInFiles(zipFiles, projectZip?.classifier ?? null);

  return {
    topology: resolveNetworkTopology({ networkMetadata: null, sources }),
    networkMetadata: null,
  };
}
