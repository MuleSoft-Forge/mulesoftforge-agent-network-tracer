/**
 * Resolve Exchange file download URLs from asset version detail `files[]` entries.
 *
 * The v2 Experience API lists files on an asset version, but binary/json downloads
 * are served from `downloadURL` (or the v1 files facade) — not from
 * `/exchange/api/v2/assets/.../files/{classifier}.{packaging}`.
 */

import { resolveAllowedUrl } from "@/lib/api/allowed-hosts";

export interface ExchangeAssetVersionRef {
  organizationId?: string;
  groupId?: string;
  assetId: string;
  version: string;
}

export interface ExchangeAssetFileRef {
  classifier?: string | null;
  packaging?: string;
  downloadURL?: string;
  externalLink?: string;
}

/** Candidate download URLs in preferred order (first working wins at call site). */
export function resolveExchangeFileDownloadUrls(
  baseUrl: string,
  asset: ExchangeAssetVersionRef,
  file: ExchangeAssetFileRef
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  function add(candidate: string | null | undefined) {
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    urls.push(candidate);
  }

  for (const raw of [file.downloadURL, file.externalLink]) {
    if (!raw) continue;
    const safe = resolveAllowedUrl(raw, baseUrl);
    if (safe) add(safe.toString());
  }

  const classifier = file.classifier;
  const packaging = file.packaging;
  if (!classifier || !packaging) return urls;

  const groupId = asset.groupId ?? asset.organizationId;
  const orgId = asset.organizationId ?? asset.groupId;

  if (orgId && groupId) {
    add(
      `${baseUrl}/exchange/files/api/v1/organizations/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(groupId)}/${encodeURIComponent(asset.assetId)}/${encodeURIComponent(classifier)}/${encodeURIComponent(packaging)}`
    );
    add(
      `${baseUrl}/exchange/files/api/v1/organizations/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(groupId)}/${encodeURIComponent(asset.assetId)}/${encodeURIComponent(asset.version)}/${encodeURIComponent(classifier)}/${encodeURIComponent(packaging)}`
    );
  }

  if (groupId) {
    add(
      `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(groupId)}/${encodeURIComponent(asset.assetId)}/${encodeURIComponent(asset.version)}/files/${encodeURIComponent(classifier)}.${encodeURIComponent(packaging)}`
    );
  }

  return urls;
}

export function resolveExchangeFileDownloadUrl(
  baseUrl: string,
  asset: ExchangeAssetVersionRef,
  file: ExchangeAssetFileRef
): string | null {
  return resolveExchangeFileDownloadUrls(baseUrl, asset, file)[0] ?? null;
}
