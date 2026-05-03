import { loggedFetch, debugLog } from "@/lib/api-logger";

/**
 * Probe whether Anypoint Monitoring `_msearch` (Log Search) is USEFUL for the
 * signed-in org — i.e. returns HTTP 200 AND has actual documents indexed over
 * a recent window.
 *
 * Two signals matter, and each on its own is misleading:
 *   - `monitoringCenter.productSKU` on the profile is unreliable. SKU 3 orgs
 *     can call `_msearch` (endpoint reachable) but their ES index is empty.
 *   - HTTP status alone is unreliable. 200 + `total: 0` is the exact pattern
 *     we see for basic-tier orgs.
 *
 * So we do two checks:
 *   1. Can we call the endpoint at all? (filters out 403 Premium/scope cases)
 *   2. Does it actually have any documents in the last 30 days for this org?
 *
 * Both must pass for `true`. A `true` result means the runtime `_msearch`
 * strategy will likely find tasks; `false` means we should go straight to
 * runtime-logs (AMC) and show the "Log Search unavailable" banner.
 */
export async function probeMsearchEntitlement(
  baseUrl: string,
  accessToken: string
): Promise<boolean> {
  const url = `${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`;
  const now = Date.now();
  // 30-day window — wide enough to catch any active org, small enough to be
  // cheap. `size: 0` is fine; we only care about `hits.total`.
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
        query: [{ query: "*", language: "lucene" }],
      }),
    ].join("\n") + "\n";

  try {
    const res = await loggedFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-ndjson",
      },
      body: ndjson,
    });

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
      debugLog(`[AUTH-TOKEN] _msearch probe: HTTP 200, total=${total} → entitled`);
      return true;
    }
    debugLog(
      `[AUTH-TOKEN] _msearch probe: HTTP 200 but total=0 over last 30d → treating as not entitled ` +
        `(endpoint reachable but index empty — likely requires Monitoring Center Premium)`
    );
    return false;
  } catch (err) {
    debugLog("[AUTH-TOKEN] _msearch probe threw:", err);
    return false;
  }
}
