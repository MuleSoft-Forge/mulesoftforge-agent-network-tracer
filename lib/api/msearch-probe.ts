import { loggedFetch, debugLog } from "@/lib/api-logger";
import { TITANIUM_MONITORING_SKU } from "@/lib/api/log-search-entitlement";

export interface MsearchProbeOptions {
  /** Scope the probe to the active org when available. */
  orgId?: string;
  /** Profile `monitoringCenter.productSKU` — Titanium (1) is a positive signal. */
  productSKU?: number;
}

/**
 * Probe whether Anypoint Monitoring `_msearch` (Log Search) is available for the
 * signed-in org.
 *
 * Two signals matter, and each on its own is misleading:
 *   - `monitoringCenter.productSKU` on the profile is unreliable for *denying*
 *     access: SKU 3 orgs can call `_msearch` (endpoint reachable) but their ES
 *     index is empty. SKU 1 (Titanium) is a reliable *positive* signal.
 *   - HTTP status alone is unreliable. 200 + `total: 0` is the exact pattern
 *     we see for basic-tier orgs — but Titanium orgs can also return 0 over a
 *     broad window while still being fully entitled.
 *
 * Entitlement is granted when:
 *   1. `_msearch` returns documents in the last 30 days (scoped to orgId when
 *      provided), OR
 *   2. `_msearch` returns HTTP 200 and productSKU is Titanium (1).
 */
export async function probeMsearchEntitlement(
  baseUrl: string,
  accessToken: string,
  opts: MsearchProbeOptions = {}
): Promise<boolean> {
  const url = `${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`;
  const now = Date.now();
  // 30-day window — wide enough to catch any active org, small enough to be
  // cheap. `size: 0` is fine; we only care about `hits.total`.
  const luceneQuery = opts.orgId ? `orgId=${opts.orgId}` : "*";
  const ndjson =
    [
      JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
      JSON.stringify({ version: true, size: 0, from: 0 }),
      JSON.stringify({
        filter: [
          {
            range: {
              timestamp: {
                gte: now - 30 * 24 * 3600 * 1000,
                lte: now,
                format: "epoch_millis",
              },
            },
          },
        ],
        query: [{ query: luceneQuery, language: "lucene" }],
      }),
    ].join("\n") + "\n";

  // `_msearch` has no org/env in its path; the Anypoint edge routes it via the
  // X-ANYPNT-ORG-ID header. Missing it yields a bare 404 (looks "not entitled").
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/x-ndjson",
  };
  if (opts.orgId) headers["X-ANYPNT-ORG-ID"] = opts.orgId;

  try {
    const res = await loggedFetch(url, {
      method: "POST",
      headers,
      body: ndjson,
    });

    if (res.status === 404) {
      debugLog(
        "[AUTH-TOKEN] _msearch probe: HTTP 404 — API not reachable for this token " +
          `(productSKU=${opts.productSKU ?? "unknown"}); using runtime logs`
      );
      return false;
    }
    if (res.status === 404) {
      debugLog(
        "[AUTH-TOKEN] _msearch probe: HTTP 404 — API not reachable for this token " +
          `(productSKU=${opts.productSKU ?? "unknown"}); using runtime logs`
      );
      return false;
    }
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403 && text.includes("Monitoring Center Premium")) {
        debugLog("[AUTH-TOKEN] _msearch probe: 403 Premium required → not entitled");
      } else {
        debugLog(
          `[AUTH-TOKEN] _msearch probe: HTTP ${res.status}, body=${text.slice(0, 200)} → not entitled`
        );
      }
      return false;
    }

    // HTTP 200 — but an empty index (observed on productSKU 3 orgs) still
    // means _msearch is useless. Require at least one document to count as
    // entitled.
    const body = (await res.json()) as {
      responses?: Array<{
        hits?: { total?: number | { value?: number } };
      }>;
    };
    const totalRaw = body.responses?.[0]?.hits?.total;
    const total =
      typeof totalRaw === "number"
        ? totalRaw
        : typeof totalRaw === "object" && totalRaw && typeof totalRaw.value === "number"
          ? totalRaw.value
          : 0;

    if (total > 0) {
      debugLog(
        `[AUTH-TOKEN] _msearch probe: HTTP 200, total=${total}, query=${luceneQuery} → entitled`
      );
      return true;
    }

    if (opts.productSKU === TITANIUM_MONITORING_SKU) {
      debugLog(
        `[AUTH-TOKEN] _msearch probe: HTTP 200, total=0, productSKU=${TITANIUM_MONITORING_SKU} (Titanium) → entitled`
      );
      return true;
    }

    debugLog(
      `[AUTH-TOKEN] _msearch probe: HTTP 200 but total=0 over last 30d (query=${luceneQuery}) → not entitled ` +
        `(endpoint reachable but index empty — likely requires Monitoring Center Premium)`
    );
    return false;
  } catch (err) {
    debugLog("[AUTH-TOKEN] _msearch probe threw:", err);
    return false;
  }
}
