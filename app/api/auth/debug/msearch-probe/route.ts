import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { DEFAULT_BASE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * **Local development only** (`next dev`). Run an arbitrary Lucene query
 * through Anypoint Monitoring `_msearch` using the current session token and
 * return diagnostic info:
 *   - raw ES status + shard stats
 *   - `hits.total` and `hits` count returned
 *   - the `_source` field keys from the first hit (so you can see what fields
 *     the documents actually have — e.g. is `apiInstanceId` a real field or
 *     just a substring in the `message` text?)
 *   - a short text preview of the first hit's message for quick pattern-spotting
 *
 * Does NOT pass bodies through the logger's redactor — this endpoint exists
 * precisely to see the content, so don't call it in production (guarded by
 * NODE_ENV). The bigger pieces of PII are still capped by `preview` length.
 *
 * Usage (from a signed-in browser):
 *   /api/auth/debug/msearch-probe?query=*&days=60&size=1
 *   /api/auth/debug/msearch-probe?query=apiInstanceId%3D20880323&days=60
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

  const luceneQuery = req.nextUrl.searchParams.get("query") || "*";
  const days = Math.max(1, Math.min(90, parseInt(req.nextUrl.searchParams.get("days") || "60", 10)));
  const size = Math.max(1, Math.min(20, parseInt(req.nextUrl.searchParams.get("size") || "3", 10)));
  // The _msearch endpoint routes via these headers (no org/env in path).
  const orgId = req.nextUrl.searchParams.get("orgId") || undefined;
  const envId = req.nextUrl.searchParams.get("envId") || undefined;

  const now = Date.now();
  const gte = now - days * 24 * 3600 * 1000;

  // Use the exact shape `/lib/api/msearch.ts` uses — we want to match the
  // production request as closely as possible so results are interpretable.
  const ndjson =
    [
      JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
      JSON.stringify({
        version: true,
        size,
        from: 0,
        _source: { excludes: [] },
        stored_fields: ["*"],
        docvalue_fields: ["timestamp"],
      }),
      JSON.stringify({
        filter: [
          {
            range: {
              timestamp: { gte, lte: now, format: "epoch_millis" },
            },
          },
        ],
        query: [{ query: luceneQuery, language: "lucene" }],
      }),
    ].join("\n") + "\n";

  const probeHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/x-ndjson",
  };
  if (orgId) probeHeaders["X-ANYPNT-ORG-ID"] = orgId;
  if (envId) probeHeaders["X-ANYPNT-ENV-ID"] = envId;
  const res = await fetch(`${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`, {
    method: "POST",
    headers: probeHeaders,
    body: ndjson,
  });

  const bodyText = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: res.status,
        statusText: res.statusText,
        body: bodyText.slice(0, 2000),
        query: { lucene: luceneQuery, gte, lte: now, days, size },
      },
      { status: 200 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ ok: false, status: res.status, body: bodyText.slice(0, 2000) });
  }

  const r = (parsed as { responses?: unknown[] }).responses?.[0] ?? {};
  const resp = r as {
    hits?: {
      total?: number | { value?: number };
      hits?: Array<{ _id?: string; _source?: Record<string, unknown> }>;
    };
    _shards?: { total?: number; successful?: number; failed?: number; skipped?: number };
    took?: number;
    timed_out?: boolean;
  };

  const totalRaw = resp.hits?.total;
  const total =
    typeof totalRaw === "number"
      ? totalRaw
      : typeof totalRaw === "object" && totalRaw && typeof totalRaw.value === "number"
        ? totalRaw.value
        : 0;

  const hits = resp.hits?.hits ?? [];
  const first = hits[0];
  const firstSource = first?._source ?? undefined;
  const firstKeys = firstSource ? Object.keys(firstSource) : [];
  const messageField = firstSource?.message;
  const messagePreview =
    typeof messageField === "string" ? messageField.slice(0, 500) : undefined;

  return NextResponse.json({
    ok: true,
    query: { lucene: luceneQuery, gte, lte: now, days, size },
    status: res.status,
    took: resp.took,
    timedOut: resp.timed_out,
    shards: resp._shards,
    total,
    returned: hits.length,
    firstKeys,
    // Flatten a few fields of interest so you can grep the response quickly.
    firstHitDocId: first?._id,
    firstSourceSelected: firstSource
      ? {
          timestamp: firstSource.timestamp,
          orgId: firstSource.orgId,
          appId: firstSource.appId,
          apiInstanceId: firstSource.apiInstanceId,
          deploymentId: firstSource.deploymentId,
          environmentId: firstSource.environmentId,
          logLevel: firstSource.logLevel,
          messagePreview,
        }
      : undefined,
    // Full first source for thorough inspection (dev only).
    firstSource,
  });
}
