import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { DEFAULT_BASE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * **Local development only.** Exhaustive raw dump of every Anypoint data source
 * relevant to a broker's API instance, so we can see exactly what data exists
 * and what our filters are missing.
 *
 * Usage (signed in, browser):
 *   /api/auth/debug/raw-broker-data?orgId=<uuid>&apiInstanceId=<id>&envId=<uuid>&days=7
 *
 * Returns a structured JSON with:
 *   1. _msearch: org-wide, apiInstanceId-filtered, broker-app-filtered, wildcard
 *   2. RM (API Manager) metadata for the apiInstanceId
 *   3. AMC deployment resolution + raw GET /logs
 *   4. Distinct appId/logLevel/message-pattern breakdown
 *   5. Field presence map (which _source keys appear on which appId)
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getSession();
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const accessToken = session.accessToken;
  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const orgId = req.nextUrl.searchParams.get("orgId") ?? "";
  const apiInstanceId = req.nextUrl.searchParams.get("apiInstanceId") ?? "";
  const envId = req.nextUrl.searchParams.get("envId");
  const days = Math.max(1, Math.min(90, parseInt(req.nextUrl.searchParams.get("days") || "7", 10)));
  const maxHits = Math.max(10, Math.min(5000, parseInt(req.nextUrl.searchParams.get("maxHits") || "500", 10)));

  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const now = Date.now();
  const timeRangeMs = days * 24 * 3600 * 1000;
  const results: Record<string, unknown> = {
    params: { orgId, apiInstanceId, envId, days, maxHits, now: new Date(now).toISOString() },
  };

  // --- helper: run _msearch ---
  async function runMsearch(label: string, lucene: string, size: number): Promise<unknown> {
    const ndjson = [
      JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
      JSON.stringify({
        version: true, size, from: 0,
        _source: { excludes: [] },
        stored_fields: ["*"],
        docvalue_fields: ["timestamp"],
      }),
      JSON.stringify({
        filter: [{ range: { timestamp: { gte: now - timeRangeMs, lte: now, format: "epoch_millis" } } }],
        query: [{ query: lucene, language: "lucene" }],
      }),
    ].join("\n") + "\n";

    try {
      const res = await fetch(`${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-ndjson" },
        body: ndjson,
      });
      const text = await res.text();
      if (!res.ok) return { label, lucene, ok: false, status: res.status, body: text.slice(0, 2000) };
      const parsed = JSON.parse(text);
      const r = (parsed.responses || [])[0] || {};
      const hits = r.hits?.hits ?? [];
      const totalRaw = r.hits?.total;
      const total = typeof totalRaw === "number" ? totalRaw
        : (totalRaw?.value ?? 0);
      return { label, lucene, ok: true, total, returned: hits.length, shards: r._shards, took: r.took, hits };
    } catch (e) {
      return { label, lucene, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 1. _msearch probes
  const msearchProbes: Record<string, unknown> = {};
  msearchProbes["wildcard"] = await runMsearch("wildcard", "*", 3);
  msearchProbes["orgOnly"] = await runMsearch("orgOnly", `orgId=${orgId}`, 5);
  if (apiInstanceId) {
    msearchProbes["orgAndApi"] = await runMsearch("orgAndApi", `orgId=${orgId} AND apiInstanceId=${apiInstanceId}`, maxHits);
  }
  results["msearch"] = msearchProbes;

  // 2. Analyze hits: distinct appId, logLevel, message patterns, field presence
  const orgAndApiResult = msearchProbes["orgAndApi"] as { ok?: boolean; hits?: Array<{ _source?: Record<string, unknown> }> } | undefined;
  if (orgAndApiResult?.ok && Array.isArray(orgAndApiResult.hits)) {
    const hits = orgAndApiResult.hits;
    const byAppId: Record<string, { count: number; logLevels: Record<string, number>; messagePatterns: string[]; sampleKeys: string[] }> = {};
    for (const h of hits) {
      const src = h._source ?? {};
      const appId = String(src.appId ?? "(none)");
      const logLevel = String(src["log-level"] ?? src.logLevel ?? "(none)");
      const msg = String(src.message ?? "").slice(0, 120);
      if (!byAppId[appId]) {
        byAppId[appId] = { count: 0, logLevels: {}, messagePatterns: [], sampleKeys: Object.keys(src) };
      }
      byAppId[appId].count++;
      byAppId[appId].logLevels[logLevel] = (byAppId[appId].logLevels[logLevel] ?? 0) + 1;
      if (byAppId[appId].messagePatterns.length < 5) {
        const normalized = msg.replace(/\d{10,}/g, "<epoch>").replace(/[a-f0-9-]{36}/g, "<uuid>");
        if (!byAppId[appId].messagePatterns.includes(normalized)) {
          byAppId[appId].messagePatterns.push(normalized);
        }
      }
    }
    results["hitAnalysis"] = { totalHits: hits.length, byAppId };

    const hasTaskId = hits.filter(h => {
      const msg = String((h._source as Record<string, unknown>)?.message ?? "");
      return /taskId[=:]/.test(msg) || /"taskId"/.test(msg);
    });
    results["taskIdPresence"] = {
      hitsWithTaskId: hasTaskId.length,
      hitsWithoutTaskId: hits.length - hasTaskId.length,
      samplesWithTaskId: hasTaskId.slice(0, 3).map(h => String((h._source as Record<string, unknown>)?.message ?? "").slice(0, 400)),
    };
  }

  // 3. RM (API Manager) metadata
  if (apiInstanceId && envId) {
    try {
      const rmUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`;
      const rmRes = await fetch(rmUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      results["rmApiInstance"] = rmRes.ok
        ? { ok: true, status: rmRes.status, body: await rmRes.json() }
        : { ok: false, status: rmRes.status, body: (await rmRes.text()).slice(0, 2000) };
    } catch (e) {
      results["rmApiInstance"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 4. AMC deployments list + raw logs
  if (envId) {
    try {
      const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`;
      const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (listRes.ok) {
        const listData = await listRes.json() as { items?: Array<{ id: string; name: string; status?: string }> };
        const deployments = (listData.items ?? []).map(d => ({ id: d.id, name: d.name, status: d.status }));
        results["amcDeployments"] = deployments;

        for (const dep of deployments.slice(0, 10)) {
          const specUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${dep.id}/specs`;
          const specRes = await fetch(specUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!specRes.ok) continue;
          const specs = await specRes.json() as Array<{ version?: string; id?: string }>;
          const specId = specs?.[0]?.version ?? specs?.[0]?.id;
          if (!specId) continue;

          const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${dep.id}/specs/${specId}/logs?length=200&descending=true`;
          const logsRes = await fetch(logsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!logsRes.ok) continue;
          const entries = await logsRes.json() as Array<{ timestamp?: number; message?: string; logLevel?: string; replicaId?: string }>;
          if (!Array.isArray(entries)) continue;

          const logSummary = {
            deploymentId: dep.id,
            deploymentName: dep.name,
            specId,
            entryCount: entries.length,
            sampleMessages: entries.slice(0, 5).map(e => ({
              ts: e.timestamp ? new Date(e.timestamp).toISOString() : null,
              level: e.logLevel,
              replicaId: e.replicaId,
              message: (e.message ?? "").slice(0, 300),
            })),
            hasTaskId: entries.filter(e => /taskId[=:]/.test(e.message ?? "")).length,
            hasBrokerError: entries.filter(e => (e.message ?? "").includes("TOOL_ERROR") || (e.message ?? "").includes("MonoDeferContextual")).length,
          };
          results[`amcLogs_${dep.name}`] = logSummary;
        }
      }
    } catch (e) {
      results["amcDeployments"] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 5. Environments list
  try {
    const envUrl = `${baseUrl}/accounts/api/organizations/${orgId}/environments`;
    const envRes = await fetch(envUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (envRes.ok) {
      const envData = await envRes.json() as { data?: Array<{ id: string; name: string; type?: string }> };
      results["environments"] = (envData.data ?? []).map(e => ({ id: e.id, name: e.name, type: e.type }));
    }
  } catch { /* ignore */ }

  return NextResponse.json(results);
}
