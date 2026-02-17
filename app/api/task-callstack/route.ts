import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugError, debugLog } from "@/lib/api-logger";
import { TaskCallstackRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

async function msearch(
  orgId: string,
  luceneQuery: string,
  opts: { size?: number; sortOrder?: "asc" | "desc"; timeRangeMs?: number } = {},
  accessToken: string,
  baseUrl: string
): Promise<{ total: number; hits: unknown[]; raw: unknown; error?: "MONITORING_CENTER_PREMIUM_REQUIRED" }> {
  const { size = 500, sortOrder = "asc", timeRangeMs = 30 * 24 * 3600 * 1000 } = opts;
  const now = Date.now();
  // Anypoint's API doesn't support wildcard patterns in _msearch index field
  // Use empty array to search all indices, then filter by orgId in the query
  const ndjson = [
    JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
    JSON.stringify({
      version: true,
      size,
      sort: [{ timestamp: { order: sortOrder, unmapped_type: "boolean" } }],
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

  const url = `${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`;
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
    // Check for Monitoring Center Premium entitlement error first
    if (res.status === 403 && text.includes("Monitoring Center Premium")) {
      // Don't log this as an error - it's an expected entitlement issue
      return { total: 0, hits: [], raw: {}, error: "MONITORING_CENTER_PREMIUM_REQUIRED" };
    }
    throw new Error(`_msearch ${res.status}: ${text.slice(0, 200)}`);
  }

  const raw = await res.json();
  const r = (raw.responses || [])[0] || {};
  const hits = (r.hits && r.hits.hits) || [];
  return { total: r.hits ? r.hits.total : 0, hits, raw };
}

function classifyLog(logger: string, message: string): string {
  if (logger === "http-listener-config") {
    if (/^LISTENER\s*\n.*POST\s+\//m.test(message) || message.startsWith("LISTENER\nPOST"))
      return "INBOUND_REQUEST";
    if (message.includes("HTTP/1.1 200") || message.includes("HTTP/1.1 2"))
      return "FINAL_RESPONSE";
  }
  if (logger === "Loop") {
    if (message.includes("LLM selected tool")) return "LLM_TOOL_SELECTION";
    if (message.includes("Executed tool")) return "TOOL_EXECUTED";
    if (message.includes("No tool selected")) return "LLM_NO_TOOL";
  }
  if (logger === "INSECURE-LOGGING") {
    if (message.startsWith("Tool Input:")) return "TOOL_INPUT";
    if (message.startsWith("Sending A2A")) return "A2A_MESSAGE_SENT";
    if (message.startsWith("Output was:")) return "TOOL_OUTPUT";
  }
  if (logger.includes("a2a-http-client")) {
    if (message.includes("agent-card.json")) return "AGENT_DISCOVERY";
    if (/REQUESTER\s*\nPOST\s+\//m.test(message)) return "DOWNSTREAM_REQUEST";
    if (/REQUESTER\s*\nHTTP\/1\.1\s+\d/m.test(message)) return "DOWNSTREAM_RESPONSE";
    return "HTTP_CHUNK";
  }
  if (logger === "flex-gateway-envoy") return "GATEWAY";
  return "OTHER";
}

function parseFields(message: string) {
  const f: Record<string, unknown> = {};
  const m = (rx: RegExp) => (message.match(rx) || [])[1] || null;
  f.taskId = m(/taskId=([a-f0-9-]+)/);
  f.contextId = m(/contextId=([a-f0-9-]+)/);
  f.apiInstanceId = m(/apiInstanceId=(\d+)/);
  f.iteration = m(/iteration=(\d+)/);
  f.agent = m(/agent=(\S+)/);
  f.traceId = m(/traceparent: 00-([a-f0-9]{32})/);
  f.spanId = m(/traceparent: 00-[a-f0-9]{32}-([a-f0-9]{16})/);
  f.correlationId = m(/[Xx]-[Cc]orrelation-[Ii]d: ([a-f0-9-]+)/);
  f.tool = m(/(?:LLM selected tool|Executed tool) (\S+)/);
  // Extract embedded JSON
  if (message.startsWith("Tool Input:")) {
    const jsonMatch = message.match(/Tool Input: ([\s\S]+?)(?:\s+agent=|$)/);
    if (jsonMatch) {
      try {
        f.toolInputJson = JSON.parse(jsonMatch[1].trim());
      } catch {
        // ignore
      }
    }
  }
  if (message.startsWith("Output was:")) {
    const jsonMatch = message.match(/Output was: ([\s\S]+?)(?:\s+agent=|$)/);
    if (jsonMatch) {
      try {
        f.toolOutputJson = JSON.parse(jsonMatch[1].trim());
      } catch {
        // ignore
      }
    }
  }
  // Extract user message from LISTENER inbound
  const jsonRpcMatch = message.match(/\{"jsonrpc"[\s\S]*\}/);
  if (jsonRpcMatch) {
    try {
      const rpc = JSON.parse(jsonRpcMatch[0]);
      if (rpc.params && rpc.params.message) {
        const parts = rpc.params.message.parts || [];
        f.userMessage = parts.map((p: { text?: string }) => p.text || "").join(" ").trim();
        f.messageId = rpc.params.message.messageId || null;
      }
      if (rpc.result) {
        f.resultStatus = rpc.result.status && rpc.result.status.state;
        f.resultTaskId = rpc.result.id;
        f.resultContextId = rpc.result.contextId;
      }
    } catch {
      // ignore
    }
  }
  return f;
}

function summarizeLine(type: string, message: string, fields: Record<string, unknown>): string {
  switch (type) {
    case "INBOUND_REQUEST":
      return fields.userMessage ? `"${fields.userMessage}"` : "Inbound POST request";
    case "LLM_TOOL_SELECTION":
      return `LLM selected: ${((fields.tool as string) || "?").replace(/^[a-zA-Z0-9]+_/, "")}`;
    case "TOOL_INPUT":
      return fields.toolInputJson
        ? `Input: ${JSON.stringify(fields.toolInputJson).slice(0, 80)}`
        : "Tool input";
    case "A2A_MESSAGE_SENT": {
      const agentMatch = message.match(/to agent (\S+)/);
      return `A2A message to ${agentMatch ? agentMatch[1].replace(/^[a-zA-Z0-9]+_/, "") : "?"}`;
    }
    case "DOWNSTREAM_REQUEST": {
      const urlMatch = message.match(/POST\s+(\S+)/);
      return `POST ${urlMatch ? urlMatch[1].split("/").slice(-2).join("/") : "?"}`;
    }
    case "DOWNSTREAM_RESPONSE": {
      const statusMatch = message.match(/HTTP\/1\.1\s+(\d+)/);
      return `Response ${statusMatch ? statusMatch[1] : "?"}`;
    }
    case "TOOL_EXECUTED":
      return `Executed: ${((fields.tool as string) || "?").replace(/^[a-zA-Z0-9]+_/, "")}`;
    case "TOOL_OUTPUT":
      return fields.toolOutputJson
        ? `Output: ${JSON.stringify(fields.toolOutputJson).slice(0, 80)}`
        : "Tool output";
    case "FINAL_RESPONSE":
      return fields.resultStatus ? `Task ${fields.resultStatus}` : "Final response";
    case "AGENT_DISCOVERY": {
      const agMatch = message.match(/\/([^/]+)\/\.well-known/);
      return `Discover agent: ${agMatch ? agMatch[1] : "?"}`;
    }
    case "GATEWAY":
      return "Gateway log";
    case "HTTP_CHUNK":
      return "HTTP chunk";
    case "LLM_NO_TOOL":
      return "LLM reasoning (no tool selected)";
    default:
      return message.split("\n")[0].slice(0, 80);
  }
}

/** Trace span shape returned from observability spans:search and sent to the UI */
type TraceSpanRow = {
  traceId: string;
  spanId: string;
  name: string;
  kind: string;
  statusCode: string;
  httpStatusCode?: string;
  duration: number;
  endTime: number;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  envId?: string;
  orgId?: string;
  orgName?: string;
  envName?: string;
};

/**
 * Fetch OTEL trace spans for a trace from Anypoint Observability API.
 * Requires orgId, traceId, and envId. Uses timestamp BETWEEN for time range (API requirement).
 */
async function fetchTraceSpans(
  orgId: string,
  traceId: string,
  accessToken: string,
  baseUrl: string,
  envId: string,
  traceStartTime?: string | number,
  traceEndTime?: string | number
): Promise<TraceSpanRow[]> {
  if (!traceId || traceId.trim() === "" || !orgId || !envId || envId.trim() === "") {
    return [];
  }

  try {
    let startTimeMs: number;
    let endTimeMs: number;
    if (traceStartTime != null && traceEndTime != null) {
      const start = typeof traceStartTime === "number" ? traceStartTime : new Date(traceStartTime).getTime();
      const end = typeof traceEndTime === "number" ? traceEndTime : new Date(traceEndTime).getTime();
      const padding = 30 * 60 * 1000; // 30 minutes
      startTimeMs = Math.max(0, start - padding);
      endTimeMs = end + padding;
    } else {
      const now = Date.now();
      startTimeMs = now - 30 * 24 * 3600 * 1000; // 30 days
      endTimeMs = now;
    }

    const query = `SELECT "span_id" AS spanId, name, kind, "trace_id" AS traceId, "status_code" AS statusCode, "http.status_code" AS httpStatusCode, duration, "end_time_nano" AS endTime, "entity.id" AS entityId, "entity.name" AS entityName, "entity.type" AS entityType, "env.id" AS envId, "sub_org.id" AS orgId, "sub_org.name" AS orgName, "env.name" AS envName WHERE "sub_org.id" = '${orgId}' AND "env.id" = '${envId}' AND "trace_id" = '${traceId}' AND timestamp BETWEEN ${startTimeMs} AND ${endTimeMs} ORDER BY timestamp ASC LIMIT 500`;

    const url = `${baseUrl}/observability/api/v1/spans:search`;
    const res = await loggedFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      debugLog("[fetchTraceSpans] spans:search failed:", res.status);
      return [];
    }

    const data = (await res.json()) as { data?: TraceSpanRow[] };
    const spans = data.data ?? [];
    return spans.filter((span: TraceSpanRow): span is TraceSpanRow & { traceId: string; spanId: string } => Boolean(span.traceId && span.spanId));
  } catch (err) {
    debugLog("[fetchTraceSpans] error:", err);
    return [];
  }
}

/**
 * Fallback: Parse runtime logs when Premium is not available
 * This is inefficient but allows us to extract some task information
 */
async function parseRuntimeLogsFallback(
  orgId: string,
  taskId: string,
  envId: string | null,
  accessToken: string,
  baseUrl: string,
  timeRangeMs: number
): Promise<{ entries: unknown[]; jobCard: unknown } | null> {
  debugLog("[FALLBACK] Attempting to parse runtime logs for taskId:", taskId);

  // If envId not provided, get list of environments to try
  let environmentsToTry: Array<{ id: string; name: string }> = [];
  
  if (envId) {
    environmentsToTry = [{ id: envId, name: "" }];
  } else {
    try {
      const environmentsUrl = `${baseUrl}/accounts/api/organizations/${orgId}/environments`;
      const envsRes = await loggedFetch(environmentsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (envsRes.ok) {
        const envsData = (await envsRes.json()) as { data?: Array<{ id: string; name: string }> };
        environmentsToTry = envsData.data || [];
        debugLog("[FALLBACK] Found", environmentsToTry.length, "environments to try");
      } else {
        debugLog("[FALLBACK] Failed to fetch environments:", envsRes.status);
        return null;
      }
    } catch (error) {
      debugLog("[FALLBACK] Error fetching environments:", error);
      return null;
    }
  }

  if (environmentsToTry.length === 0) {
    debugLog("[FALLBACK] No environments to try");
    return null;
  }

  try {
    const now = Date.now();
    const startTime = now - timeRangeMs;
    const endTime = now;

    // Step 1: Try each environment to find deployments containing our taskId
    for (const env of environmentsToTry) {
      try {
        const deploymentsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`;
        const deploymentsRes = await loggedFetch(deploymentsUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!deploymentsRes.ok) {
          continue; // Try next environment
        }

        const deployments = (await deploymentsRes.json()) as Array<{ id: string; name: string; replicas?: Array<{ id: string }> }>;
        debugLog("[FALLBACK] Found", deployments.length, "deployments in environment", env.id);

        // Step 2: Try each deployment's logs to find taskId
        for (const deployment of deployments) {
          if (!deployment.replicas || deployment.replicas.length === 0) {
            continue;
          }

          // Use the first replica's specId (simplified - in reality we'd need to handle multiple replicas)
          const replicaId = deployment.replicas[0].id;
          const specId = replicaId; // Simplified assumption

          try {
            // Fetch logs file for this deployment
            const searchParams = {
              startTime,
              endTime,
              length: 10000,
              descending: true,
            };
            const searchEncoded = encodeURIComponent(JSON.stringify(searchParams));
            const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${deployment.id}/specs/${specId}/logs/file?search=${searchEncoded}`;

            const logsRes = await loggedFetch(logsUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

            if (!logsRes.ok) {
              continue; // Try next deployment
            }

            const logsText = await logsRes.text();
            
            // Step 3: Parse logs for taskId
            // Look for taskId in JSON-RPC responses and log messages
            const taskIdRegex = new RegExp(taskId.replace(/-/g, "[-]"), "gi");
            if (!taskIdRegex.test(logsText)) {
              continue; // TaskId not found in this deployment's logs
            }

            debugLog("[FALLBACK] Found taskId in deployment:", deployment.id);

            // Step 4: Parse log lines and extract entries
            const logLines = logsText.split("\n").filter((line: string) => line.trim().length > 0);
            const entries: unknown[] = [];
            let entryIndex = 0;

            for (const line of logLines) {
              // Skip if line doesn't contain taskId
              if (!taskIdRegex.test(line)) {
                continue;
              }

              // Try to parse timestamp from log line format: "2026-02-13T10:17:12.523Z DEBUG [8jpc4] ..."
              const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
              const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();

              // Extract logger and level
              const loggerMatch = line.match(/\[[\w]+\]\s+(\S+)\s+(\S+)/);
              const logger = loggerMatch ? loggerMatch[1] : "";
              const level = loggerMatch ? loggerMatch[2] : "";

              // Extract message (everything after timestamp and logger info)
              const messageMatch = line.match(/^[\d-T:Z.]+\s+\w+\s+\[[\w]+\]\s+[\w-]+\s+[\w-]+\s+(.+)$/);
              const message = messageMatch ? messageMatch[1] : line;

              // Classify and parse
              const type = classifyLog(logger, message);
              const fields = parseFields(message);
              const summary = summarizeLine(type, message, fields);

              entries.push({
                index: entryIndex++,
                type,
                summary,
                timestamp,
                logger,
                level,
                appId: "",
                workerId: "",
                fields,
                raw: { message, logger, timestamp, "log-level": level },
                _id: `fallback-${entryIndex}`,
                _index: "fallback",
              });
            }

            if (entries.length === 0) {
              continue; // No entries found, try next deployment
            }

            // Step 5: Build job card from parsed entries
            const inbound = entries.find((e: unknown) => {
              const entry = e as { type?: string };
              return entry.type === "INBOUND_REQUEST";
            });
            const finalResp = entries.find((e: unknown) => {
              const entry = e as { type?: string };
              return entry.type === "FINAL_RESPONSE";
            });
            const toolSelections = entries.filter((e: unknown) => {
              const entry = e as { type?: string };
              return entry.type === "LLM_TOOL_SELECTION";
            });
            const toolExecutions = entries.filter((e: unknown) => {
              const entry = e as { type?: string };
              return entry.type === "TOOL_EXECUTED";
            });

            const firstEntry = entries[0] as { timestamp?: string | number };
            const lastEntry = entries[entries.length - 1] as { timestamp?: string | number };
            let duration: string | null = null;
            if (firstEntry && lastEntry) {
              const t1 = typeof firstEntry.timestamp === "number" ? firstEntry.timestamp : new Date(firstEntry.timestamp || "").getTime();
              const t2 = typeof lastEntry.timestamp === "number" ? lastEntry.timestamp : new Date(lastEntry.timestamp || "").getTime();
              duration = ((t2 - t1) / 1000).toFixed(1);
            }

            const maxIter = Math.max(0, ...entries.map((e: unknown) => {
              const entry = e as { fields?: { iteration?: string } };
              return parseInt((entry.fields?.iteration as string) || "0", 10);
            }));
            const toolStrings = toolSelections.map((e: unknown) => {
              const entry = e as { fields?: { tool?: string } };
              return entry.fields?.tool as string;
            }).filter((t: string | undefined): t is string => typeof t === "string" && Boolean(t));
            const allTools: string[] = Array.from(new Set(toolStrings));

            const jobCard = {
              taskId,
              contextId: (entries.find((e: unknown) => {
                const entry = e as { fields?: { contextId?: string } };
                return entry.fields?.contextId;
              }) as { fields?: { contextId?: string } } | undefined)?.fields?.contextId || "",
              traceId: "",
              broker: (entries.find((e: unknown) => {
                const entry = e as { fields?: { agent?: string } };
                return entry.fields?.agent;
              }) as { fields?: { agent?: string } } | undefined)?.fields?.agent || "",
              apiInstanceId: (entries.find((e: unknown) => {
                const entry = e as { fields?: { apiInstanceId?: string } };
                return entry.fields?.apiInstanceId;
              }) as { fields?: { apiInstanceId?: string } } | undefined)?.fields?.apiInstanceId || "",
              userMessage: inbound ? ((inbound as { fields?: { userMessage?: string } }).fields?.userMessage || "") : "",
              messageId: inbound ? ((inbound as { fields?: { messageId?: string } }).fields?.messageId || "") : "",
              outcome: finalResp
                ? ((finalResp as { fields?: { resultStatus?: string } }).fields?.resultStatus || "completed")
                : toolExecutions.length > 0
                  ? "completed"
                  : "",
              startTime: firstEntry ? firstEntry.timestamp : "",
              endTime: lastEntry ? lastEntry.timestamp : "",
              duration,
              iterations: maxIter,
              toolsUsed: allTools.map((t: string) => t.replace(/^[a-zA-Z0-9]+_/, "")),
              totalEntries: entries.length,
              appId: "",
            };

            debugLog("[FALLBACK] Successfully parsed", entries.length, "log entries");
            return { entries, jobCard };
          } catch (error) {
            debugLog("[FALLBACK] Error parsing logs for deployment", deployment.id, ":", error);
            continue; // Try next deployment
          }
        }
      } catch (error) {
        debugLog("[FALLBACK] Error processing environment", env.id, ":", error);
        continue; // Try next environment
      }
    }

    debugLog("[FALLBACK] TaskId not found in any deployment logs");
    return null;
  } catch (error) {
    debugError("[FALLBACK] Error in runtime logs fallback:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  // Authentication check
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  const taskId = searchParams.get("taskId");
  // Convert null to undefined for optional parameters (Zod expects undefined, not null)
  const apiInstanceId = searchParams.get("apiInstanceId") || undefined;
  const envId = searchParams.get("envId") || undefined;

  // Validate query parameters with Zod
  const parseResult = TaskCallstackRequestSchema.safeParse({
    orgId,
    taskId,
    apiInstanceId,
    envId,
  });
  
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parseResult.error.format(),
      },
      { status: 400 }
    );
  }
  
  const { orgId: validatedOrgId, taskId: validatedTaskId, apiInstanceId: validatedApiInstanceId, envId: validatedEnvId } = parseResult.data;

  const timeRange = 30 * 24 * 3600 * 1000;

  try {
    // Phase 1: search by taskId - filter by orgId first since we search all indices
    const phase1Query = `orgId=${validatedOrgId} AND "${validatedTaskId}"`;
    const phase1 = await msearch(validatedOrgId, phase1Query, { timeRangeMs: timeRange }, session.accessToken, baseUrl);
    
    // Check for Monitoring Center Premium entitlement error - try fallback
    // COMMENTED OUT: Fallback disabled - return 403 to show warning message
    if (phase1.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
      return NextResponse.json(
        { 
          error: "Monitoring Center Premium entitlement required",
          message: "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)",
          code: "MONITORING_CENTER_PREMIUM_REQUIRED"
        },
        { status: 403 }
      );
    }
    /*
    if (phase1.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
      debugLog("[FALLBACK] Premium required, attempting runtime logs fallback");
      
      // Try fallback: parse runtime logs
      const fallbackResult = await parseRuntimeLogsFallback(
        orgId,
        taskId,
        envId,
        session.accessToken,
        baseUrl,
        timeRange
      );

      if (fallbackResult) {
        debugLog("[FALLBACK] Successfully parsed runtime logs");
        return NextResponse.json({
          jobCard: fallbackResult.jobCard,
          entries: fallbackResult.entries,
          rawQueries: { phase1: phase1Query, phase2: null, traceId: null },
          fallback: true, // Indicate this is fallback data
        });
      }

      // Fallback failed, return error
      return NextResponse.json(
        { 
          error: "Monitoring Center Premium entitlement required",
          message: "Monitoring Center Premium entitlement required. This feature requires access to log search functionality.",
          code: "MONITORING_CENTER_PREMIUM_REQUIRED"
        },
        { status: 403 }
      );
    }
    */

    // Extract trace_id from any entry with traceparent
    let traceId: string | null = null;
    for (const h of phase1.hits) {
      const hit = h as { _source?: { message?: string } };
      const m = ((hit._source?.message as string) || "").match(/traceparent: 00-([a-f0-9]{32})/);
      if (m) {
        traceId = m[1];
        break;
      }
    }

    // Phase 2: combined search if we found trace_id
    let allHits = phase1.hits;
    let phase2Query: string | null = null;
    if (traceId) {
      phase2Query = `orgId=${validatedOrgId} AND ("${traceId}" OR "${validatedTaskId}")`;
      const phase2 = await msearch(validatedOrgId, phase2Query, { timeRangeMs: timeRange }, session.accessToken, baseUrl);
      
      // Check for Monitoring Center Premium entitlement error - try fallback
      // COMMENTED OUT: Fallback disabled - return 403 to show warning message
      if (phase2.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
        return NextResponse.json(
          { 
            error: "Monitoring Center Premium entitlement required",
            message: "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)",
            code: "MONITORING_CENTER_PREMIUM_REQUIRED"
          },
          { status: 403 }
        );
      }
      /*
      if (phase2.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
        debugLog("[FALLBACK] Premium required in phase2, attempting runtime logs fallback");
        
        // Try fallback: parse runtime logs
        const fallbackResult = await parseRuntimeLogsFallback(
          orgId,
          taskId,
          envId,
          session.accessToken,
          baseUrl,
          timeRange
        );

        if (fallbackResult) {
          debugLog("[FALLBACK] Successfully parsed runtime logs");
          return NextResponse.json({
            jobCard: fallbackResult.jobCard,
            entries: fallbackResult.entries,
            rawQueries: { phase1: phase1Query, phase2: phase2Query, traceId },
            fallback: true, // Indicate this is fallback data
          });
        }

        // Fallback failed, return error
        return NextResponse.json(
          { 
            error: "Monitoring Center Premium entitlement required",
            message: "Monitoring Center Premium entitlement required. This feature requires access to log search functionality.",
            code: "MONITORING_CENTER_PREMIUM_REQUIRED"
          },
          { status: 403 }
        );
      }
      */
      
      allHits = phase2.hits;
    }

    // Deduplicate by _id
    const seen = new Set<string>();
    const unique: unknown[] = [];
    for (const h of allHits) {
      const hit = h as { _id?: string };
      if (hit._id && !seen.has(hit._id)) {
        seen.add(hit._id);
        unique.push(h);
      }
    }

    // Sort by timestamp
    unique.sort((a: unknown, b: unknown) => {
      const hitA = a as { _source?: { timestamp?: number | string } };
      const hitB = b as { _source?: { timestamp?: number | string } };
      const ta =
        typeof hitA._source?.timestamp === "number"
          ? hitA._source.timestamp
          : new Date((hitA._source?.timestamp as string) || "").getTime();
      const tb =
        typeof hitB._source?.timestamp === "number"
          ? hitB._source.timestamp
          : new Date((hitB._source?.timestamp as string) || "").getTime();
      return ta - tb;
    });

    // Classify and parse each entry
    const entries = unique.map((h: unknown, i: number) => {
      const hit = h as { _source?: { message?: string; logger?: string; timestamp?: string | number; "log-level"?: string; appId?: string; workerId?: string; [key: string]: unknown }; _id?: string; _index?: string };
      const s = hit._source || {};
      const message = (s.message as string) || "";
      const logger = (s.logger as string) || "";
      const type = classifyLog(logger, message);
      const fields = parseFields(message);
      const summary = summarizeLine(type, message, fields);
      return {
        index: i,
        type,
        summary,
        timestamp: s.timestamp as string | number,
        logger,
        level: (s["log-level"] as string) || "",
        appId: (s.appId as string) || "",
        workerId: (s.workerId as string) || "",
        fields,
        raw: s,
        _id: hit._id,
        _index: hit._index,
      };
    });

    // Build Job Card from parsed entries
    const inbound = entries.find((e: typeof entries[0]) => e.type === "INBOUND_REQUEST");
    const finalResp = entries.find((e: typeof entries[0]) => e.type === "FINAL_RESPONSE");
    const toolSelections = entries.filter((e: typeof entries[0]) => e.type === "LLM_TOOL_SELECTION");
    const toolExecutions = entries.filter((e: typeof entries[0]) => e.type === "TOOL_EXECUTED");

    const firstEntry = entries[0];
    const lastEntry = entries[entries.length - 1];
    let duration: string | null = null;
    if (firstEntry && lastEntry) {
      const t1 =
        typeof firstEntry.timestamp === "number"
          ? firstEntry.timestamp
          : new Date(firstEntry.timestamp).getTime();
      const t2 =
        typeof lastEntry.timestamp === "number"
          ? lastEntry.timestamp
          : new Date(lastEntry.timestamp).getTime();
      duration = ((t2 - t1) / 1000).toFixed(1);
    }

    const maxIter = Math.max(0, ...entries.map((e: typeof entries[0]) => parseInt((e.fields.iteration as string) || "0", 10)));
    const toolStrings = toolSelections.map((e: typeof entries[0]) => e.fields.tool as string).filter((t: string | undefined): t is string => typeof t === "string" && Boolean(t));
    const allTools: string[] = Array.from(new Set(toolStrings));

    const jobCard = {
      taskId,
      contextId: (entries.find((e: typeof entries[0]) => e.fields.contextId) || {}).fields?.contextId || "",
      traceId: traceId || "",
      broker: (entries.find((e: typeof entries[0]) => e.fields.agent) || {}).fields?.agent || "",
      apiInstanceId: (entries.find((e: typeof entries[0]) => e.fields.apiInstanceId) || {}).fields?.apiInstanceId || "",
      userMessage: inbound ? ((inbound.fields.userMessage as string) || "") : "",
      messageId: inbound ? ((inbound.fields.messageId as string) || "") : "",
      outcome: finalResp
        ? ((finalResp.fields.resultStatus as string) || "completed")
        : toolExecutions.length > 0
          ? "completed"
          : "",
      startTime: firstEntry ? firstEntry.timestamp : "",
      endTime: lastEntry ? lastEntry.timestamp : "",
      duration,
      iterations: maxIter,
      toolsUsed: allTools.map((t: string) => t.replace(/^[a-zA-Z0-9]+_/, "")),
      totalEntries: entries.length,
      appId: (entries.find((e: typeof entries[0]) => e.appId && !e.appId.startsWith("_")) || {}).appId || "",
    };

    // Fetch trace spans when we have traceId and envId (observability API)
    let traceSpans: TraceSpanRow[] = [];
    if (traceId && validatedEnvId && validatedEnvId.trim() !== "") {
      traceSpans = await fetchTraceSpans(
        validatedOrgId,
        traceId,
        session.accessToken,
        baseUrl,
        validatedEnvId,
        firstEntry?.timestamp,
        lastEntry?.timestamp
      );
    }

    return NextResponse.json({
      jobCard,
      entries,
      traceSpans,
      rawQueries: { phase1: phase1Query, phase2: phase2Query, traceId },
    });
  } catch (error) {
    debugError("Task callstack API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch task call stack" },
      { status: 500 }
    );
  }
}
