/**
 * Exchange asset version delete — MAF/agent-type assets require trusted-manager
 * headers that the Anypoint CLI and MCP tools do not send.
 *
 * Working path (ground-truthed against agent-network / agent / mcp / llm assets):
 *   DELETE /exchange/api/v2/assets/{groupId}/{assetId}/{version}
 *   x-trusted-manager: true
 *   x-delete-type: hard-delete   (or soft-delete)
 *
 * Success: HTTP 204 No Content.
 * CLI `exchange asset delete` hits v1 and returns 403 for these asset types,
 * which is why orphaned agent/mcp/llm assets survive a normal teardown and this
 * "stubborn" API path exists to remove them.
 */

export type ExchangeDeleteType = "hard-delete" | "soft-delete";

export interface ExchangeDeleteResult {
  ok: boolean;
  status: number;
  /** Present when Exchange returns a non-204 error body. */
  error?: string;
}

/** Parse Exchange error JSON into a short human-readable message. */
export function formatExchangeApiError(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const json = JSON.parse(trimmed) as {
      message?: string;
      error?: string;
      name?: string;
    };
    const parts = [json.message, json.error, json.name].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
  } catch {
    /* plain text */
  }
  return trimmed.slice(0, 300);
}

export function httpStatusLabel(status: number): string {
  switch (status) {
    case 200:
      return "HTTP 200 OK";
    case 204:
      return "HTTP 204 No Content";
    case 207:
      return "HTTP 207 Multi-Status";
    case 403:
      return "HTTP 403 Forbidden";
    case 404:
      return "HTTP 404 Not Found";
    case 409:
      return "HTTP 409 Conflict";
    case 500:
      return "HTTP 500 Internal Server Error";
    default:
      return `HTTP ${status}`;
  }
}

/**
 * A caller-facing hint for the common non-success statuses, so the UI can say
 * something useful instead of a bare code. Kept here (not in the component) so
 * the API route and any future callers share one wording.
 */
export function exchangeDeleteHint(status: number): string | null {
  switch (status) {
    case 403:
      return "Forbidden — the signed-in user or its org role cannot delete this asset. Hard delete may be disabled for the org, or the asset is read-only. Re-authenticate with a user that has Exchange delete permission (manage:exchange).";
    case 404:
      return "Not found — this version is already gone in Exchange. Refresh the scan.";
    case 409:
      return "Conflict — the asset still has dependent managed instances. Undeploy/undeploy its API instances first, then retry.";
    default:
      return null;
  }
}

export async function deleteExchangeAssetVersion(
  baseUrl: string,
  groupId: string,
  assetId: string,
  version: string,
  accessToken: string,
  options: {
    deleteType?: ExchangeDeleteType;
    fetchFn?: typeof fetch;
  } = {}
): Promise<ExchangeDeleteResult> {
  const { deleteType = "hard-delete", fetchFn = fetch } = options;
  const url = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(groupId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}`;

  const res = await fetchFn(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-trusted-manager": "true",
      "x-delete-type": deleteType,
    },
  });

  if (res.status === 204) {
    return { ok: true, status: 204 };
  }

  const text = await res.text().catch(() => "");
  const formatted = formatExchangeApiError(text);
  return {
    ok: false,
    status: res.status,
    error: formatted || res.statusText || `HTTP ${res.status}`,
  };
}
