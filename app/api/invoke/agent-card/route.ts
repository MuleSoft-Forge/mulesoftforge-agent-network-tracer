import { NextRequest, NextResponse } from "next/server";
import { isSafePublicUrl } from "@/lib/api/url-safety";
import { a2aVersionRequestHeaders, normalizeA2AVersion } from "@/lib/invoke/a2a-version";
import { egressProxyConfigured, fetchDirect, fetchViaEgressProxy, type NormalizedResponse } from "@/lib/invoke/egress-proxy";
import type { InvokeAuthConfig } from "@/lib/invoke/types";
import { isAuthenticated } from "@/lib/session";

interface AgentCard {
  name?: string;
  description?: string;
  version?: string;
  url?: string;
  protocolVersion?: string;
  supportedInterfaces?: Array<{
    url?: string;
    protocolVersion?: string;
    protocolBinding?: string;
  }>;
  skills?: unknown[];
  capabilities?: unknown;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { card: AgentCard; expiresAt: number }>();

function toBase64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

function buildAuthHeaders(auth: InvokeAuthConfig | undefined): Record<string, string> {
  if (!auth || auth.type === "none") return {};
  switch (auth.type) {
    case "apiKey": {
      const headerName = auth.apiKeyHeaderName.trim();
      const value = auth.apiKeyValue.trim();
      if (!headerName || !value) return {};
      return { [headerName]: value };
    }
    case "basic": {
      if (!auth.basicUsername || !auth.basicPassword) return {};
      return {
        Authorization: `Basic ${toBase64(`${auth.basicUsername}:${auth.basicPassword}`)}`,
      };
    }
    case "mulesoftClientIdSecret": {
      const clientId = auth.clientId.trim();
      const clientSecret = auth.clientSecret.trim();
      if (!clientId || !clientSecret) return {};
      return {
        client_id: clientId,
        client_secret: clientSecret,
      };
    }
    default: {
      const _exhaustive: never = auth.type;
      return _exhaustive;
    }
  }
}

function cacheGet(key: string): AgentCard | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.card;
}

function cacheSet(key: string, card: AgentCard): void {
  // Bound memory: drop the oldest entry once we hit the cap (Map preserves insertion order).
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { card, expiresAt: Date.now() + CACHE_TTL_MS });
}

function isAgentCard(data: unknown): data is AgentCard {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  return "name" in obj || "skills" in obj || "description" in obj;
}

function extractCard(parsed: unknown): AgentCard | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if ("jsonrpc" in obj) {
    const result = obj.result;
    if (isAgentCard(result)) return result as AgentCard;
    if ("skills" in obj) return obj as AgentCard;
    return null;
  }
  if (isAgentCard(obj)) return obj as AgentCard;
  return null;
}

function logCardDiagnostics(card: AgentCard, source: string): void {
  if (process.env.NODE_ENV !== "development") return;
  const skills = Array.isArray(card.skills) ? card.skills : [];
  const firstSkill = skills[0];
  let firstSkillKeys: string[] = [];
  let firstSkillExamplesType = "none";
  if (firstSkill && typeof firstSkill === "object" && !Array.isArray(firstSkill)) {
    const first = firstSkill as Record<string, unknown>;
    firstSkillKeys = Object.keys(first);
    const ex = first.examples;
    firstSkillExamplesType = Array.isArray(ex) ? "array" : typeof ex;
  }
  console.log("[invoke/agent-card] discovered", {
    source,
    name: card.name ?? "",
    hasDescription: Boolean(card.description),
    skillCount: skills.length,
    firstSkillKeys,
    firstSkillExamplesType,
  });
}

function buildGetCandidates(brokerUrl: string): string[] {
  const base = brokerUrl.replace(/\/$/, "");
  let origin = base;
  try {
    origin = new URL(brokerUrl).origin;
  } catch { /* use base */ }

  const paths = [
    `${base}/.well-known/agent-card.json`,
    `${base}/.well-known/agent-card`,
    `${origin}/.well-known/agent-card.json`,
    `${origin}/.well-known/agent-card`,
    `${base}/.well-known/agent.json`,
    `${base}/.well-known/agent`,
    `${base}/.well-known/agents`,
    `${base}/.well-known/agents.json`,
    `${origin}/.well-known/agent.json`,
    `${origin}/.well-known/agent`,
    `${origin}/.well-known/agents`,
    `${origin}/.well-known/agents.json`,
    base,
    `${base}/agent-card`,
    `${base}/info`,
    `${base}/metadata`,
  ];
  return [...new Set(paths)];
}

interface DiscoveryAttempt {
  url: string;
  status?: number;
  reason: string;
}

/** Reason string for a thrown fetch error — distinguishes a timeout from a hard network failure. */
function fetchErrorReason(err: unknown): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "timed out";
  }
  return err instanceof Error ? err.message : "network error";
}

async function tryGet(
  endpoint: string,
  a2aVersion?: string,
  authHeaders?: Record<string, string>,
  useProxy = false
): Promise<{ card: AgentCard | null; attempt: DiscoveryAttempt }> {
  const label = useProxy ? `${endpoint} (via egress proxy)` : endpoint;
  try {
    const headers = {
      Accept: "application/json",
      ...(a2aVersion ? a2aVersionRequestHeaders(a2aVersion) : {}),
      ...(authHeaders ?? {}),
    };
    const res: NormalizedResponse = useProxy
      ? await fetchViaEgressProxy(endpoint, { method: "GET", headers, timeoutMs: 5000 })
      : await fetchDirect(endpoint, { method: "GET", headers, timeoutMs: 5000 });
    if (!res.ok) {
      return { card: null, attempt: { url: label, status: res.status, reason: res.statusText || `HTTP ${res.status}` } };
    }
    const ct = res.headers["content-type"] ?? "";
    if (!ct.includes("application/json") && !ct.includes("text/")) {
      return { card: null, attempt: { url: label, status: res.status, reason: `unexpected content-type "${ct}"` } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      return { card: null, attempt: { url: label, status: res.status, reason: "response was not valid JSON" } };
    }
    const card = extractCard(parsed);
    if (!card) {
      return { card: null, attempt: { url: label, status: res.status, reason: "response did not look like an agent card" } };
    }
    return { card, attempt: { url: label, status: res.status, reason: "ok" } };
  } catch (err) {
    return { card: null, attempt: { url: label, reason: fetchErrorReason(err) } };
  }
}

async function tryPost(
  brokerUrl: string,
  a2aVersion?: string,
  authHeaders?: Record<string, string>,
  useProxy = false
): Promise<{ card: AgentCard | null; attempts: DiscoveryAttempt[] }> {
  const bodies: Array<{ method: string; body: string }> = [
    { method: "agent/info", body: JSON.stringify({ jsonrpc: "2.0", method: "agent/info", id: crypto.randomUUID(), params: {} }) },
    { method: "tasks/send", body: JSON.stringify({ jsonrpc: "2.0", method: "tasks/send", id: crypto.randomUUID(), params: {} }) },
  ];
  const attempts: DiscoveryAttempt[] = [];
  for (const { method, body } of bodies) {
    const label = `${brokerUrl} (POST ${method}${useProxy ? ", via egress proxy" : ""})`;
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(a2aVersion ? a2aVersionRequestHeaders(a2aVersion) : {}),
        ...(authHeaders ?? {}),
      };
      const res: NormalizedResponse = useProxy
        ? await fetchViaEgressProxy(brokerUrl, { method: "POST", headers, body, timeoutMs: 8000 })
        : await fetchDirect(brokerUrl, { method: "POST", headers, body, timeoutMs: 8000 });
      if (!res.ok) {
        attempts.push({ url: label, status: res.status, reason: res.statusText || `HTTP ${res.status}` });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        attempts.push({ url: label, status: res.status, reason: "response was not valid JSON" });
        continue;
      }
      const card = extractCard(parsed);
      if (card) return { card, attempts: [...attempts, { url: label, status: res.status, reason: "ok" }] };
      attempts.push({ url: label, status: res.status, reason: "response did not look like an agent card" });
    } catch (err) {
      attempts.push({ url: label, reason: fetchErrorReason(err) });
    }
  }
  return { card: null, attempts };
}

async function resolveCardFetch(params: {
  brokerUrl: string;
  bust: boolean;
  a2aVersion?: string;
  auth?: InvokeAuthConfig;
}) {
  const { brokerUrl, bust, a2aVersion, auth } = params;
  const safety = isSafePublicUrl(brokerUrl, { allowHttp: false });
  if (!safety.ok) {
    return NextResponse.json({ error: `Unsafe URL: ${safety.reason}` }, { status: 400 });
  }

  const authHeaders = buildAuthHeaders(auth);
  const hasAuth = Boolean(auth && auth.type !== "none");
  if (!bust && !hasAuth) {
    const cached = cacheGet(safety.url.toString());
    if (cached) return NextResponse.json(cached);
  }

  const attempts: DiscoveryAttempt[] = [];
  const candidates = buildGetCandidates(safety.url.toString());

  // Direct pass, then (only if that fully failed and a proxy is configured) a
  // second pass relayed through the egress proxy — some brokers block this
  // server's IP range outright while accepting the proxy's AWS-hosted one.
  // The direct pass stays first so the common case pays no extra latency.
  for (const useProxy of egressProxyConfigured() ? [false, true] : [false]) {
    for (const endpoint of candidates) {
      const { card, attempt } = await tryGet(endpoint, a2aVersion, authHeaders, useProxy);
      attempts.push(attempt);
      if (card) {
        logCardDiagnostics(card, attempt.url);
        if (!hasAuth) cacheSet(safety.url.toString(), card);
        return NextResponse.json(card);
      }
    }

    const postOutcome = await tryPost(safety.url.toString(), a2aVersion, authHeaders, useProxy);
    attempts.push(...postOutcome.attempts);
    if (postOutcome.card) {
      logCardDiagnostics(postOutcome.card, useProxy ? "jsonrpc-post (via egress proxy)" : "jsonrpc-post");
      if (!hasAuth) cacheSet(safety.url.toString(), postOutcome.card);
      return NextResponse.json(postOutcome.card);
    }
  }

  return NextResponse.json(
    { error: "Agent card not discoverable", tried: attempts.length, attempts },
    { status: 404 }
  );
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const brokerUrl = req.nextUrl.searchParams.get("url");
  if (!brokerUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }
  const bust = req.nextUrl.searchParams.get("refresh") === "1";
  const a2aVersion = normalizeA2AVersion(req.nextUrl.searchParams.get("a2aVersion")) ?? undefined;
  return resolveCardFetch({ brokerUrl, bust, a2aVersion });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json()) as {
    url?: string;
    refresh?: boolean;
    a2aVersion?: string;
    auth?: InvokeAuthConfig;
  };
  const brokerUrl = body.url?.trim();
  if (!brokerUrl) {
    return NextResponse.json({ error: "Missing url field" }, { status: 400 });
  }
  return resolveCardFetch({
    brokerUrl,
    bust: Boolean(body.refresh),
    a2aVersion: normalizeA2AVersion(body.a2aVersion) ?? undefined,
    auth: body.auth,
  });
}
