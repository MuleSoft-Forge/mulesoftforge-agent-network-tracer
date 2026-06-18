import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { DEFAULT_BASE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * **Local development only.** Empirically probe the NEW Anypoint Monitoring
 * "Enhanced Log Search" (OpenSearch Dashboards) backend that replaced the
 * retired `/monitoring/api/logs/elasticsearch/_msearch` endpoint.
 *
 * The browser UI authenticates these calls with an OSD **session cookie**
 * obtained via the `monitoring_center_ui` implicit OAuth client. The open
 * question is whether the OSD proxy *also* accepts a normal Anypoint Connected
 * App **bearer token** (what this app holds) plus the OSD headers
 * (`osd-xsrf`, `osd-version`, `x-active-org-id`). This route tests exactly that
 * and reports the raw status + body for each call so we can see what auth is
 * required.
 *
 * Usage (signed in, browser):
 *   /api/auth/debug/log-search-probe?orgId=<uuid>&envId=<uuid>&appId=<uuid>&days=7
 *   optionally &dataSourceId=<id>&index=data-stream-<orgId>*
 */
const OSD_BASE = "/monitoring-x-api/logs";
const OSD_VERSION = "3.3.0-SNAPSHOT";

function osdHeaders(accessToken: string, orgId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "osd-xsrf": "osd-fetch",
    "osd-version": OSD_VERSION,
    "x-active-org-id": orgId,
  };
}

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
  const envId = req.nextUrl.searchParams.get("envId") || undefined;
  const appId = req.nextUrl.searchParams.get("appId") || undefined;
  const days = Math.max(1, Math.min(90, parseInt(req.nextUrl.searchParams.get("days") || "7", 10)));
  let dataSourceId = req.nextUrl.searchParams.get("dataSourceId") || undefined;
  const index = req.nextUrl.searchParams.get("index") || (orgId ? `data-stream-${orgId}*` : undefined);

  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const headers = osdHeaders(accessToken, orgId);
  const results: Record<string, unknown> = {
    params: { orgId, envId, appId, days, index, dataSourceIdProvided: dataSourceId ?? null },
    note: "Each step reports raw status + body so we can see what auth/headers the OSD proxy requires.",
  };

  // Step 1: can we reach the OSD proxy at all with our bearer token?
  // `settings` is a cheap, always-present endpoint.
  try {
    const res = await fetch(`${baseUrl}${OSD_BASE}/api/opensearch-dashboards/settings`, {
      method: "GET",
      headers,
      redirect: "manual",
    });
    results["step1_settings"] = {
      status: res.status,
      statusText: res.statusText,
      location: res.headers.get("location"),
      anypntTrxId: res.headers.get("x-anypnt-trx-id"),
      body: (await res.text()).slice(0, 600),
    };
  } catch (e) {
    results["step1_settings"] = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 2: discover the index-pattern + its dataSource reference (the id we
  // need for the search call). The UI does this via saved_objects/_find.
  try {
    const url = `${baseUrl}${OSD_BASE}/api/saved_objects/_find?type=index-pattern&fields=title&fields=references&per_page=1000`;
    const res = await fetch(url, { method: "GET", headers, redirect: "manual" });
    const text = await res.text();
    results["step2_indexPatterns"] = {
      status: res.status,
      statusText: res.statusText,
      location: res.headers.get("location"),
      body: text.slice(0, 2000),
    };
    if (res.ok && !dataSourceId) {
      try {
        const parsed = JSON.parse(text) as {
          saved_objects?: Array<{
            attributes?: { title?: string };
            references?: Array<{ name?: string; id?: string; type?: string }>;
          }>;
        };
        const match =
          parsed.saved_objects?.find((o) => o.attributes?.title?.startsWith(`data-stream-${orgId}`)) ??
          parsed.saved_objects?.[0];
        const ds = match?.references?.find((r) => r.type === "data-source");
        if (ds?.id) {
          dataSourceId = ds.id;
          results["step2_discoveredDataSourceId"] = dataSourceId;
        }
      } catch {
        /* leave dataSourceId as-is */
      }
    }
  } catch (e) {
    results["step2_indexPatterns"] = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 3: the actual search — the call we ultimately need to work.
  const now = Date.now();
  const gte = new Date(now - days * 24 * 3600 * 1000).toISOString();
  const lte = new Date(now).toISOString();
  const filter: unknown[] = [
    { range: { timestamp: { gte, lte, format: "strict_date_optional_time" } } },
  ];
  if (appId) filter.unshift({ match_phrase: { appId } });

  const searchBody = {
    params: {
      index,
      body: {
        sort: [{ timestamp: { order: "desc", unmapped_type: "boolean" } }],
        size: 10,
        version: true,
        stored_fields: ["*"],
        docvalue_fields: [{ field: "timestamp", format: "date_time" }],
        _source: { excludes: [] },
        query: { bool: { must: [{ match_all: {} }], filter, should: [], must_not: [] } },
      },
      preference: now,
    },
    ...(dataSourceId ? { dataSourceId } : {}),
  };

  try {
    const res = await fetch(`${baseUrl}${OSD_BASE}/internal/search/opensearch-with-long-numerals`, {
      method: "POST",
      headers,
      body: JSON.stringify(searchBody),
      redirect: "manual",
    });
    const text = await res.text();
    results["step3_search"] = {
      status: res.status,
      statusText: res.statusText,
      location: res.headers.get("location"),
      anypntTrxId: res.headers.get("x-anypnt-trx-id"),
      usedDataSourceId: dataSourceId ?? null,
      body: text.slice(0, 3000),
    };
  } catch (e) {
    results["step3_search"] = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
