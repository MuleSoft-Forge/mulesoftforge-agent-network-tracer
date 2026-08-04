"use client";

import { ChevronDown, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
// import RequestFlowDiagram from "@/components/llmProxy/RequestFlowDiagram";
import { computeCost } from "@/lib/llmProxy/pricing";
import type {
  LlmProxyChatEndpoint,
  LlmProxyChatMeta,
  LlmProxyUpstream,
  LlmProxyUsage,
} from "@/lib/llmProxy/types";

interface ReplyMetaPanelsProps {
  meta: LlmProxyChatMeta;
  /** Optional proxy context — enables the Request Flow diagram when provided. */
  flowContext?: {
    proxyName: string;
    publicEndpoint: string | null;
    basePath: string | null;
    upstreams: LlmProxyUpstream[];
    endpoint: LlmProxyChatEndpoint;
  };
}

/**
 * Renders the per-reply panels beneath an assistant message:
 *  - RequestFlowDiagram (when flowContext is provided) — temporarily commented out
 *  - BlockedRequestPanel (when Semantic Prompt Guard blocked the request)
 *  - otherwise UsageCostCard + ProxyMetadataCard + ResponseHeadersTable
 */
export default function ReplyMetaPanels({ meta }: ReplyMetaPanelsProps) {
  const blocked = isBlocked(meta);
  return (
    <div className="mt-2 flex flex-col gap-2">
      {/*
      {flowContext && (
        <RequestFlowDiagram
          meta={meta}
          proxyName={flowContext.proxyName}
          publicEndpoint={flowContext.publicEndpoint}
          basePath={flowContext.basePath}
          upstreams={flowContext.upstreams}
          endpointFallback={flowContext.endpoint}
        />
      )}
      */}
      {blocked ? (
        <BlockedRequestPanel meta={meta} />
      ) : (
        <>
          <UsageCostCard meta={meta} />
          <ProxyMetadataCard meta={meta} />
        </>
      )}
      <ResponseHeadersTable meta={meta} />
    </div>
  );
}

function isBlocked(meta: LlmProxyChatMeta): boolean {
  const h = meta.headers;
  const explicit = h["x-llm-proxy-request-blocked"];
  if (explicit && /true|1|yes/i.test(explicit)) return true;
  const guard = h["x-llm-proxy-semantic-guard-success"] ?? "";
  if (!guard) return false;
  if (/denied|blocked/i.test(guard)) return true;
  return false;
}

// ----------------------------------------------------------------------------
// Usage & Cost
// ----------------------------------------------------------------------------

function pickUsage(meta: LlmProxyChatMeta): LlmProxyUsage {
  const body = meta.usage ?? {};
  const h = meta.headers;
  const headerPrompt = numOrNull(h["x-llm-proxy-usage-prompt-tokens"]);
  const headerCompletion = numOrNull(h["x-llm-proxy-usage-completion-tokens"]);
  const headerTotal = numOrNull(h["x-llm-proxy-usage-total-tokens"]);
  return {
    prompt_tokens: body.prompt_tokens ?? headerPrompt ?? undefined,
    completion_tokens: body.completion_tokens ?? headerCompletion ?? undefined,
    total_tokens: body.total_tokens ?? headerTotal ?? undefined,
  };
}

function numOrNull(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function UsageCostCard({ meta }: { meta: LlmProxyChatMeta }) {
  const usage = pickUsage(meta);
  const model = meta.headers["x-llm-proxy-llm-model"] ?? null;
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const total = usage.total_tokens ?? prompt + completion;
  const hasAny = prompt > 0 || completion > 0 || total > 0;
  const cost = computeCost(model, prompt, completion);

  if (!hasAny) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Usage & Cost</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MetricTile label="Input tokens" value={prompt} />
        <MetricTile label="Output tokens" value={completion} />
        <MetricTile label="Total tokens" value={total} highlight />
      </div>
      <div className="mt-2 space-y-0.5 text-[11px] text-gray-600">
        <div>
          Approximate Cost:{" "}
          <span className="font-mono font-medium text-gray-900">
            {cost.costUsd != null ? formatUsd(cost.costUsd) : "—"}
          </span>
        </div>
        {cost.percentSaved != null && cost.percentSaved > 0 && (
          <div className="text-emerald-700">
            Cost Savings: {cost.percentSaved.toFixed(1)}% vs GPT-4 Turbo
          </div>
        )}
        <div className="text-[10px] text-gray-400">
          Cost calculated based on standard pricing. Actual cost may vary.
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        highlight
          ? "border-emerald-200 bg-emerald-50"
          : "border-gray-200 bg-gray-50"
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div
        className={`font-mono text-lg font-semibold ${
          highlight ? "text-emerald-800" : "text-gray-900"
        }`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function formatUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

// ----------------------------------------------------------------------------
// Proxy Metadata
// ----------------------------------------------------------------------------

function ProxyMetadataCard({ meta }: { meta: LlmProxyChatMeta }) {
  const h = meta.headers;
  const provider = h["x-llm-proxy-llm-provider"];
  const model = h["x-llm-proxy-llm-model"];
  const routingType = h["x-llm-proxy-routing-type"];
  const fallback = h["x-llm-proxy-routing-fallback"];
  const semanticMatch = h["x-llm-proxy-semantic-routing-success"];
  const fallbackUsed =
    fallback != null &&
    fallback !== "" &&
    /true|1|yes/i.test(String(fallback).trim());

  if (!provider && !model && !routingType) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 text-sm font-semibold text-gray-900">Proxy Metadata</div>
      <div className="grid grid-cols-2 gap-2">
        <MetaField label="Provider" value={provider} />
        <MetaField label="Model" value={model} mono />
      </div>
      {fallbackUsed && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-950">
          <span className="font-semibold">Fallback routing</span>
          {" — "}
          Flex served this reply via the fallback upstream (
          <span className="font-mono">x-llm-proxy-routing-fallback</span>
          ). The winning route was not a primary semantic match for the requested model.
        </div>
      )}
      {(routingType || fallbackUsed) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {routingType && (
            <Chip label="Routing type" value={routingType} tone="blue" />
          )}
          {fallbackUsed && <Chip label="Fallback" value="yes" tone="amber" />}
        </div>
      )}
      {semanticMatch && (
        <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-700">
          <span className="font-semibold text-gray-900">Semantic routing</span>
          {": "}
          {semanticMatch}
        </p>
      )}
    </div>
  );
}

function MetaField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div
        className={`text-base font-semibold text-gray-900 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "amber" | "emerald";
}) {
  const cls =
    tone === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <span className="uppercase tracking-wide opacity-70">{label}</span>
      <span className="font-mono normal-case">{value}</span>
    </span>
  );
}

// ----------------------------------------------------------------------------
// Response Headers (collapsible)
// ----------------------------------------------------------------------------

function ResponseHeadersTable({ meta }: { meta: LlmProxyChatMeta }) {
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => {
    const proxyOnly = Object.entries(meta.headers).filter(([k]) =>
      k.startsWith("x-llm-proxy-")
    );
    proxyOnly.sort(([a], [b]) => a.localeCompare(b));
    return proxyOnly;
  }, [meta.headers]);

  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>View All Response Headers ({entries.length})</span>
        <ChevronDown
          className={`h-4 w-4 text-gray-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <table className="w-full text-[11px]">
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k} className="border-b border-gray-50 last:border-b-0">
                  <td className="w-1/3 px-3 py-1.5 align-top font-mono text-gray-700">
                    {k}
                  </td>
                  <td className="px-3 py-1.5 align-top font-mono text-gray-900 break-all">
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Blocked request panel
// ----------------------------------------------------------------------------

function BlockedRequestPanel({ meta }: { meta: LlmProxyChatMeta }) {
  const h = meta.headers;
  const matchedTopic =
    h["x-llm-proxy-semantic-guard-matched-topic"] ??
    h["x-llm-proxy-semantic-guard-topic"];
  const scoreRaw =
    h["x-llm-proxy-semantic-guard-score"] ??
    h["x-llm-proxy-semantic-guard-similarity"];
  const score = scoreRaw != null ? Number(scoreRaw) : null;
  const scorePct =
    score != null && Number.isFinite(score)
      ? Math.max(0, Math.min(100, score <= 1 ? score * 100 : score))
      : null;
  const message =
    h["x-llm-proxy-semantic-guard-success"] ??
    "Request denied — Prompt semantically matches deny list";

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-red-600" />
        <span className="text-sm font-semibold text-red-700">Request Blocked</span>
      </div>
      <div className="mt-1 text-xs text-red-700">{message}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-700/80">
            Matched topic
          </div>
          <div className="mt-0.5">
            {matchedTopic ? (
              <span className="inline-flex rounded bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white">
                {matchedTopic}
              </span>
            ) : (
              <span className="text-[11px] text-red-700/70">—</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-700/80">
            Similarity score
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-red-100">
              <div
                className="h-full bg-red-600"
                style={{ width: `${scorePct ?? 0}%` }}
              />
            </div>
            <span className="font-mono text-[11px] font-medium text-red-800">
              {score != null && Number.isFinite(score)
                ? score <= 1
                  ? score.toFixed(3)
                  : score.toFixed(1)
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
