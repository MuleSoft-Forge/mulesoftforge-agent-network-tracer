"use client";

import { ShieldAlert, User, Cpu, Server } from "lucide-react";
import type { LlmProxyChatEndpoint, LlmProxyChatMeta, LlmProxyUpstream } from "@/lib/llmProxy/types";

interface RequestFlowDiagramProps {
  meta: LlmProxyChatMeta;
  /** Proxy display name (header on the middle node). */
  proxyName: string;
  /** Public endpoint of the Flex Gateway (e.g. https://gateway.example.com). */
  publicEndpoint: string | null;
  /** Base path configured on the proxy (e.g. /llm-proxy). */
  basePath: string | null;
  /** Upstreams declared on the proxy; used to resolve URI by provider/model. */
  upstreams: LlmProxyUpstream[];
  /** Endpoint hit at request time (falls back to the one stored on meta). */
  endpointFallback: LlmProxyChatEndpoint;
}

/**
 * Visual recap of a single reply:
 *   Client → Flex Gateway (LLM Proxy) → matched upstream (provider)
 *
 * Mirrors the topology diagram in the MuleSoft Flex Gateway LLM Proxy docs, but
 * annotated with the values actually observed in the x-llm-proxy-* response
 * headers: routing type, fallback usage, semantic match, and block state.
 *
 * Header keys read:
 *  - x-llm-proxy-llm-provider
 *  - x-llm-proxy-llm-model
 *  - x-llm-proxy-routing-type
 *  - x-llm-proxy-routing-fallback
 *  - x-llm-proxy-semantic-routing-success
 *  - x-llm-proxy-semantic-guard-success / matched-topic
 *  - x-llm-proxy-request-blocked
 */
export default function RequestFlowDiagram({
  meta,
  proxyName,
  publicEndpoint,
  basePath,
  upstreams,
  endpointFallback,
}: RequestFlowDiagramProps) {
  const h = meta.headers;
  const provider = h["x-llm-proxy-llm-provider"] ?? null;
  const model = h["x-llm-proxy-llm-model"] ?? null;
  const routingType = h["x-llm-proxy-routing-type"] ?? null;
  const fallbackUsed = /true|1|yes/i.test(h["x-llm-proxy-routing-fallback"] ?? "");
  const semanticOk = h["x-llm-proxy-semantic-routing-success"] ?? null;
  const blocked = isBlocked(h);
  const endpoint = meta.endpoint ?? endpointFallback;

  const matchedUpstream = pickUpstream(upstreams, provider, model);
  const upstreamUri = matchedUpstream?.uri ?? providerDefaultUri(provider);
  const routeLabel = matchedUpstream?.label ?? null;

  const gatewayUrl = composeGatewayUrl(publicEndpoint, basePath, endpoint);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Request flow</span>
        <div className="flex items-center gap-1.5 text-[10px]">
          {routingType && (
            <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
              {routingType}
            </span>
          )}
          {fallbackUsed && (
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
              fallback
            </span>
          )}
          {semanticOk && !blocked && (
            <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
              semantic match
            </span>
          )}
          {blocked && (
            <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-medium text-red-700">
              <ShieldAlert className="h-3 w-3" />
              blocked
            </span>
          )}
        </div>
      </div>

      <div className="flex items-stretch gap-2">
        <Node
          icon={<User className="h-4 w-4" />}
          title="Client"
          subtitle={endpoint}
          mono
        />
        <Arrow label={gatewayUrl} tone="gray" />
        <Node
          icon={<Cpu className="h-4 w-4" />}
          title={proxyName}
          subtitle="Flex Gateway · LLM Proxy"
          emphasized
          blocked={blocked}
        />
        {blocked ? (
          <BlockedArrow />
        ) : (
          <Arrow
            label={upstreamUri ?? "(upstream)"}
            sublabel={routeLabel}
            tone={fallbackUsed ? "amber" : "emerald"}
          />
        )}
        {!blocked && (
          <Node
            icon={<Server className="h-4 w-4" />}
            title={provider ?? "(unknown provider)"}
            subtitle={model ?? undefined}
            mono
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits & pieces
// ---------------------------------------------------------------------------

function Node({
  icon,
  title,
  subtitle,
  mono = false,
  emphasized = false,
  blocked = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  mono?: boolean;
  emphasized?: boolean;
  blocked?: boolean;
}) {
  const borderCls = blocked
    ? "border-red-300 bg-red-50"
    : emphasized
      ? "border-primary/40 bg-primary/5"
      : "border-gray-200 bg-white";
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col justify-center rounded-md border px-2 py-1.5 ${borderCls}`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        <span className={emphasized ? "text-primary" : "text-gray-500"}>{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      {subtitle && (
        <div
          className={`truncate text-[11px] text-gray-700 ${mono ? "font-mono" : ""}`}
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function Arrow({
  label,
  sublabel,
  tone,
}: {
  label?: string | null;
  sublabel?: string | null;
  tone: "gray" | "emerald" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : "text-gray-400";
  const labelColor =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-gray-600";
  return (
    <div className="flex min-w-[72px] flex-col items-center justify-center">
      {label && (
        <div
          className={`max-w-[140px] truncate text-center font-mono text-[10px] ${labelColor}`}
          title={label}
        >
          {label}
        </div>
      )}
      <svg
        className={`h-4 w-full ${color}`}
        viewBox="0 0 100 16"
        preserveAspectRatio="none"
        aria-hidden
      >
        <line x1="0" y1="8" x2="88" y2="8" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="88,3 98,8 88,13" fill="currentColor" />
      </svg>
      {sublabel && (
        <div className={`text-[10px] italic ${labelColor}`}>{sublabel}</div>
      )}
    </div>
  );
}

function BlockedArrow() {
  return (
    <div className="flex min-w-[72px] flex-col items-center justify-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-red-700">
        denied
      </div>
      <svg
        className="h-4 w-full text-red-500"
        viewBox="0 0 100 16"
        preserveAspectRatio="none"
        aria-hidden
      >
        <line
          x1="0"
          y1="8"
          x2="98"
          y2="8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <line x1="46" y1="2" x2="54" y2="14" stroke="currentColor" strokeWidth="2" />
        <line x1="54" y1="2" x2="46" y2="14" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

function isBlocked(h: Record<string, string>): boolean {
  const explicit = h["x-llm-proxy-request-blocked"];
  if (explicit && /true|1|yes/i.test(explicit)) return true;
  const guard = h["x-llm-proxy-semantic-guard-success"] ?? "";
  if (guard && /denied|blocked/i.test(guard)) return true;
  return false;
}

function pickUpstream(
  upstreams: LlmProxyUpstream[],
  provider: string | null,
  model: string | null
): LlmProxyUpstream | null {
  if (!upstreams || upstreams.length === 0) return null;
  if (model) {
    const byModel = upstreams.find((u) => u.targetModel && u.targetModel === model);
    if (byModel) return byModel;
  }
  if (provider) {
    const p = provider.toLowerCase();
    const byProvider = upstreams.find((u) => (u.provider ?? "").toLowerCase() === p);
    if (byProvider) return byProvider;
  }
  return null;
}

/**
 * Best-effort fallback when the proxy config didn't expose the upstream URI.
 * Mirrors the default base URLs documented for Flex Gateway LLM Proxy
 * upstreams. Keeps the diagram informative even if we couldn't resolve the
 * exact upstream, and clearly scopes to the known providers.
 */
function providerDefaultUri(provider: string | null): string | null {
  if (!provider) return null;
  switch (provider.toLowerCase()) {
    case "openai":
      return "https://api.openai.com/v1/";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/";
    case "azureopenai":
    case "azure":
      return "https://<resource>.openai.azure.com/";
    case "bedrock":
    case "anthropic-bedrock":
      return "https://bedrock-runtime.<region>.amazonaws.com/";
    default:
      return null;
  }
}

function composeGatewayUrl(
  publicEndpoint: string | null,
  basePath: string | null,
  endpoint: LlmProxyChatEndpoint
): string | null {
  if (!publicEndpoint) return endpoint;
  const origin = publicEndpoint.replace(/\/$/, "");
  const base = basePath ? (basePath.startsWith("/") ? basePath : `/${basePath}`) : "";
  return `${origin}${base}${endpoint}`;
}
