import { NextRequest, NextResponse } from "next/server";
import { isSafePublicUrl } from "@/lib/api/url-safety";

export const dynamic = "force-dynamic";
// On Vercel this hints the maximum route execution window.
export const maxDuration = 300;

const DEFAULT_BROKER_TIMEOUT_MS = 290_000;

function resolveBrokerTimeoutMs(): number {
  const raw = process.env.INVOKE_BROKER_TIMEOUT_MS;
  if (!raw) return DEFAULT_BROKER_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_BROKER_TIMEOUT_MS;
  // Keep timeout below route max duration with a little safety margin.
  return Math.min(Math.max(parsed, 5_000), DEFAULT_BROKER_TIMEOUT_MS);
}

function extractErrorSummary(parsed: unknown, fallback: string): string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  if (obj.error && typeof obj.error === "object" && !Array.isArray(obj.error)) {
    const nested = obj.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
  }
  return fallback;
}

/**
 * Server-side A2A proxy for Invoke chat.
 *
 * Browser -> this route (same-origin, no CORS issues)
 * This route -> brokerUrl (server-to-server)
 */
export async function POST(req: NextRequest) {
  const brokerTimeoutMs = resolveBrokerTimeoutMs();
  try {
    const body = (await req.json()) as { brokerUrl?: string; message?: string };
    const brokerUrl = body.brokerUrl?.trim();
    const message = body.message?.trim();

    if (!brokerUrl || !message) {
      return NextResponse.json(
        { error: "Missing required fields: brokerUrl, message" },
        { status: 400 }
      );
    }

    const safety = isSafePublicUrl(brokerUrl, { allowHttp: false });
    if (!safety.ok) {
      return NextResponse.json(
        { error: `Unsafe brokerUrl: ${safety.reason}` },
        { status: 400 }
      );
    }

    const upstreamBody = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params: {
        message: {
          role: "user",
          kind: "message",
          parts: [{ kind: "text", text: message }],
          messageId: crypto.randomUUID(),
        },
      },
    };

    // Defensive normalization: user-provided URLs sometimes include accidental
    // double slashes in the path (e.g. https://host//broker), which some
    // gateways treat differently. Keep protocol/host intact, collapse path only.
    const normalizedUrl = new URL(safety.url.toString());
    normalizedUrl.pathname = normalizedUrl.pathname.replace(/\/{2,}/g, "/");

    const upstream = await fetch(normalizedUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(brokerTimeoutMs),
    });

    const raw = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: extractErrorSummary(parsed, `Broker returned ${upstream.status}`),
          upstreamStatus: upstream.status,
          detail: raw,
        },
        { status: upstream.status }
      );
    }

    if (parsed === null) {
      return NextResponse.json(
        { error: "Broker returned non-JSON response", detail: raw },
        { status: 502 }
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return NextResponse.json(
      {
        error: isTimeout
          ? `Broker did not respond within ${Math.round(brokerTimeoutMs / 1000)}s`
          : "Failed to reach broker",
        detail,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
