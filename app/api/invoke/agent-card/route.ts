import { NextRequest, NextResponse } from "next/server";
import { isSafePublicUrl } from "@/lib/api/url-safety";

interface AgentCard {
  name?: string;
  description?: string;
  version?: string;
  url?: string;
  skills?: unknown[];
  capabilities?: unknown;
}

const cache = new Map<string, AgentCard>();

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

async function tryGet(endpoint: string): Promise<AgentCard | null> {
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
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

async function tryPost(brokerUrl: string): Promise<AgentCard | null> {
  const bodies = [
    JSON.stringify({ jsonrpc: "2.0", method: "agent/info", id: crypto.randomUUID(), params: {} }),
    JSON.stringify({ jsonrpc: "2.0", method: "tasks/send", id: crypto.randomUUID(), params: {} }),
  ];
  for (const body of bodies) {
    try {
      const res = await fetch(brokerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(8000),
      });
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
  const brokerUrl = req.nextUrl.searchParams.get("url");
  if (!brokerUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  const safety = isSafePublicUrl(brokerUrl, { allowHttp: false });
  if (!safety.ok) {
    return NextResponse.json({ error: `Unsafe URL: ${safety.reason}` }, { status: 400 });
  }

  const bust = req.nextUrl.searchParams.get("refresh") === "1";
  if (!bust && cache.has(brokerUrl)) {
    return NextResponse.json(cache.get(brokerUrl));
  }

  const candidates = buildGetCandidates(brokerUrl);
  for (const endpoint of candidates) {
    const card = await tryGet(endpoint);
    if (card) {
      cache.set(brokerUrl, card);
      return NextResponse.json(card);
    }
  }

  const card = await tryPost(brokerUrl);
  if (card) {
    cache.set(brokerUrl, card);
    return NextResponse.json(card);
  }

  return NextResponse.json(
    { error: "Agent card not discoverable", tried: candidates.length + 2 },
    { status: 404 }
  );
}
