#!/usr/bin/env node
/**
 * Hunt for text inside Anypoint Monitoring (_msearch) and optionally AMC deployment logs.
 *
 * Prerequisites:
 *   export ANYPOINT_TOKEN="<bearer>"   # dev: curl -s http://localhost:3000/api/auth/debug/access-token | jq -r .accessToken
 *   export ORG_ID="<uuid>"
 * Optional:
 *   export ANYPOINT_BASE_URL="https://anypoint.mulesoft.com"
 *   export API_INSTANCE_ID="<id>"      # narrow _msearch Lucene query (same as UI broker)
 *   export ENV_ID / DEPLOYMENT_ID / SPEC_ID  # if set, also GET AMC /logs and scan .message
 *   export DAYS=7                      # _msearch time window (default 7)
 *
 * Usage:
 *   node scripts/hunt-broker-message.mjs
 *   node scripts/hunt-broker-message.mjs "MonoDeferContextual" "-32603"
 *
 * Raw curl (_msearch) — same NDJSON shape as lib/api/msearch.ts:
 *   See printed "equivalent curl" on 403/usage, or run this script.
 *
 * Raw curl (AMC logs) — same as lib/broker-tasks/runtime-logs-strategy.ts:
 *   curl -sS -H "Authorization: Bearer $ANYPOINT_TOKEN" \
 *     "$ANYPOINT_BASE_URL/amc/application-manager/api/v2/organizations/$ORG_ID/environments/$ENV_ID/deployments/$DEPLOYMENT_ID/specs/$SPEC_ID/logs?length=1000&descending=true"
 */

const BASE = process.env.ANYPOINT_BASE_URL || "https://anypoint.mulesoft.com";
const TOKEN = process.env.ANYPOINT_TOKEN;
const ORG_ID = process.env.ORG_ID;
const API_INSTANCE_ID = process.env.API_INSTANCE_ID;
const ENV_ID = process.env.ENV_ID;
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;
const SPEC_ID = process.env.SPEC_ID;
const DAYS = Math.max(1, Math.min(90, Number(process.env.DAYS || 7)));

const DEFAULT_NEEDLES = [
  "Error -32603",
  "Did not observe any item or terminal signal within 60000ms",
  "MonoDeferContextual",
  "no fallback has been configured",
];

const needlesFromArgv = process.argv.slice(2).filter(Boolean);
const NEEDLES = needlesFromArgv.length ? needlesFromArgv : DEFAULT_NEEDLES;

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

if (!TOKEN) die("Set ANYPOINT_TOKEN (Bearer access token).");
if (!ORG_ID) die("Set ORG_ID.");

function luceneForOrgAndMaybeApi() {
  if (API_INSTANCE_ID) {
    return `orgId=${ORG_ID} AND apiInstanceId=${API_INSTANCE_ID}`;
  }
  return `orgId=${ORG_ID}`;
}

async function msearchPage(luceneQuery, from, size, timeRangeMs) {
  const now = Date.now();
  const ndjson =
    [
      JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
      JSON.stringify({
        version: true,
        size,
        from,
        _source: { excludes: [] },
        stored_fields: ["*"],
        docvalue_fields: ["timestamp"],
      }),
      JSON.stringify({
        filter: [
          {
            range: {
              timestamp: {
                gte: now - timeRangeMs,
                lte: now,
                format: "epoch_millis",
              },
            },
          },
        ],
        query: [{ query: luceneQuery, language: "lucene" }],
      }),
    ].join("\n") + "\n";

  const url = `${BASE}/monitoring/api/logs/elasticsearch/_msearch`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: res.ok, status: res.status, error: "non-json body", raw: text.slice(0, 500) };
  }
  const r = (parsed.responses || [])[0] || {};
  const hits = (r.hits && r.hits.hits) || [];
  const totalRaw = r.hits && r.hits.total;
  const total =
    typeof totalRaw === "number"
      ? totalRaw
      : totalRaw && typeof totalRaw === "object" && typeof totalRaw.value === "number"
        ? totalRaw.value
        : 0;
  const shards = r._shards || {};
  return { ok: res.ok, status: res.status, total, hits, shards, took: r.took };
}

function hitMatchesNeedles(hit) {
  const src = hit._source || {};
  const blob = JSON.stringify(src);
  const found = NEEDLES.filter((n) => blob.includes(n));
  return { blob, found, src };
}

async function huntMsearch() {
  const luceneQuery = luceneForOrgAndMaybeApi();
  const timeRangeMs = DAYS * 24 * 3600 * 1000;
  const PAGE = 500;
  const MAX_PAGES = 40;
  let allHits = [];
  let reportedTotal = 0;

  console.log(`\n[msearch] lucene=${luceneQuery}`);
  console.log(`[msearch] window=${DAYS}d (${new Date(Date.now() - timeRangeMs).toISOString()} → ${new Date().toISOString()})`);

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const result = await msearchPage(luceneQuery, from, PAGE, timeRangeMs);
    if (!result.ok && result.status === 403) {
      console.error("[msearch] 403 — entitlement or token scope. Body:", result.raw || result);
      return;
    }
    if (!result.ok) {
      console.error("[msearch] HTTP", result.status, result.raw || result.error || "");
      return;
    }
    if (page === 0) reportedTotal = result.total;
    const hits = result.hits || [];
    allHits = allHits.concat(hits);
    console.log(
      `[msearch] page ${page + 1}: fetched ${hits.length} hits (cum ${allHits.length}/${reportedTotal}) took=${result.took} shards=${JSON.stringify(result.shards || {})}`
    );
    if (hits.length < PAGE || allHits.length >= reportedTotal) break;
  }

  let matchCount = 0;
  for (const hit of allHits) {
    const { found, src } = hitMatchesNeedles(hit);
    if (found.length) {
      matchCount++;
      const ts = src.timestamp ?? src["@timestamp"];
      const msg = typeof src.message === "string" ? src.message : "";
      console.log("\n--- MATCH ---");
      console.log("needles:", found.join(", "));
      console.log("timestamp:", ts);
      console.log("appId:", src.appId);
      console.log("apiInstanceId:", src.apiInstanceId);
      console.log("message:", msg.slice(0, 2000));
    }
  }

  console.log(`\n[msearch] scanned ${allHits.length} hits, ${matchCount} hit(s) contained any needle.`);
  if (matchCount === 0 && allHits.length > 0) {
    console.log("[msearch] tip: try narrower needles via argv, or unset API_INSTANCE_ID to scan whole org, or increase DAYS.");
  }
}

async function huntAmcLogs() {
  if (!ENV_ID || !DEPLOYMENT_ID || !SPEC_ID) {
    console.log("\n[amc] skip (set ENV_ID, DEPLOYMENT_ID, SPEC_ID to scan deployment logs)");
    return;
  }
  const url = `${BASE}/amc/application-manager/api/v2/organizations/${ORG_ID}/environments/${ENV_ID}/deployments/${DEPLOYMENT_ID}/specs/${SPEC_ID}/logs?length=1000&descending=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await res.text();
  if (!res.ok) {
    console.error("\n[amc] GET /logs failed", res.status, text.slice(0, 400));
    return;
  }
  let entries;
  try {
    entries = JSON.parse(text);
  } catch {
    console.error("[amc] non-json logs response", text.slice(0, 400));
    return;
  }
  if (!Array.isArray(entries)) {
    console.error("[amc] expected JSON array of log entries");
    return;
  }
  console.log(`\n[amc] entries=${entries.length}`);
  let n = 0;
  for (const e of entries) {
    const msg = e.message || "";
    const hit = NEEDLES.filter((needle) => msg.includes(needle));
    if (hit.length) {
      n++;
      console.log("\n--- AMC MATCH ---");
      console.log("needles:", hit.join(", "));
      console.log("timestamp:", e.timestamp);
      console.log("replicaId:", e.replicaId);
      console.log("message:", String(msg).slice(0, 2000));
    }
  }
  console.log(`\n[amc] ${n} matching entr(y|ies).`);
}

async function main() {
  console.log("needles:", NEEDLES.join(" | "));
  await huntMsearch();
  await huntAmcLogs();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
