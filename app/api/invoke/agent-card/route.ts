import { NextRequest, NextResponse } from "next/server";
import { isSafePublicUrl, safeFetch } from "@/lib/api/url-safety";
import { a2aVersionRequestHeaders, normalizeA2AVersion } from "@/lib/invoke/a2a-version";
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

async function tryGet(endpoint: string, a2aVersion?: string): Promise<AgentCard | null> {
  try {
    const res = await safeFetch(
      endpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(a2aVersion ? a2aVersionRequestHeaders(a2aVersion) : {}),
        },
        signal: AbortSignal.timeout(5000),
      },
      { allowHttp: false }
    );
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json") && !ct.includes("text/")) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      return null;
    }
    return extractCard(parsed);
  } catch {
    return null;
  }
}

async function tryPost(brokerUrl: string, a2aVersion?: string): Promise<AgentCard | null> {
  const bodies = [
    JSON.stringify({ jsonrpc: "2.0", method: "agent/info", id: crypto.randomUUID(), params: {} }),
    JSON.stringify({ jsonrpc: "2.0", method: "tasks/send", id: crypto.randomUUID(), params: {} }),
  ];
  for (const body of bodies) {
    try {
      const res = await safeFetch(
        brokerUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(a2aVersion ? a2aVersionRequestHeaders(a2aVersion) : {}),
          },
          body,
          signal: AbortSignal.timeout(8000),
        },
        { allowHttp: false }
      );
      if (!res.ok) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await res.text());
      } catch {
        continue;
      }
      const card = extractCard(parsed);
      if (card) return card;
    } catch { /* timeout / network */ }
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const brokerUrl = req.nextUrl.searchParams.get("url");
  if (!brokerUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  const safety = isSafePublicUrl(brokerUrl, { allowHttp: false });
  if (!safety.ok) {
    return NextResponse.json({ error: `Unsafe URL: ${safety.reason}` }, { status: 400 });
  }

  const bust = req.nextUrl.searchParams.get("refresh") === "1";
  const a2aVersion = normalizeA2AVersion(req.nextUrl.searchParams.get("a2aVersion")) ?? undefined;
  if (!bust) {
    const cached = cacheGet(brokerUrl);
    if (cached) return NextResponse.json(cached);
  }

  const candidates = buildGetCandidates(brokerUrl);
  for (const endpoint of candidates) {
    const card = await tryGet(endpoint, a2aVersion);
    if (card) {
      cacheSet(brokerUrl, card);
      return NextResponse.json(card);
    }
  }

  const card = await tryPost(brokerUrl, a2aVersion);
  if (card) {
    cacheSet(brokerUrl, card);
    return NextResponse.json(card);
  }

  return NextResponse.json(
    { error: "Agent card not discoverable", tried: candidates.length + 2 },
    { status: 404 }
  );
}
