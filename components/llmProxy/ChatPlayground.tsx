"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Send, Trash2, X } from "lucide-react";
import CredentialsPanel from "@/components/llmProxy/CredentialsPanel";
import ModelRoutesPanel from "@/components/llmProxy/ModelRoutesPanel";
import PromptTopicsSidebar from "@/components/llmProxy/PromptTopicsSidebar";
import ReplyMetaPanels from "@/components/llmProxy/ReplyMetaPanels";
import Spinner from "@/components/Spinner";
import LlmProxyChatErrorModal from "@/components/llmProxy/LlmProxyChatErrorModal";
import {
  formatDenyListInlineMessage,
  implementationErrorCopy,
} from "@/lib/llmProxy/chat-proxy-errors";
import {
  isLlmProxyDenyListChatError,
  routeTraceFromChatProxyError,
  routeTraceFromProxyHeaders,
} from "@/lib/llmProxy/route-trace";
import {
  collectModelOptions,
  formatLlmProxyModelForRequest,
  resolveBareModelViaSingleUpstream,
} from "@/lib/llmProxy/model-request";
import {
  parseSseStream,
  extractChatCompletionDelta,
  extractResponsesDelta,
} from "@/lib/llmProxy/sse";
import { devLog } from "@/lib/api-logger";
import type {
  ChatMessage,
  LlmProxyChatEndpoint,
  LlmProxyChatMeta,
  LlmProxyDetail,
  LlmProxyListItem,
  LlmProxyRouteTrace,
  LlmProxyUsage,
  SavedCredentials,
} from "@/lib/llmProxy/types";

interface ChatPlaygroundProps {
  proxy: LlmProxyListItem;
  /** Updates the network diagram when a reply completes (from `x-llm-proxy-*` headers). */
  onRouteTrace?: (trace: LlmProxyRouteTrace | null) => void;
}

interface PlaygroundParams {
  model: string;
  temperature: number | null;
  topP: number | null;
  maxCompletionTokens: number | null;
  stream: boolean;
}

const DEFAULT_PARAMS: PlaygroundParams = {
  model: "",
  temperature: null,
  topP: null,
  maxCompletionTokens: null,
  stream: false,
};

export default function ChatPlayground({ proxy, onRouteTrace }: ChatPlaygroundProps) {
  const [detail, setDetail] = useState<LlmProxyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [creds, setCreds] = useState<SavedCredentials | null>(null);
  const [endpoint, setEndpoint] = useState<LlmProxyChatEndpoint>("/chat/completions");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Per-assistant-message metadata keyed by index in `messages`. */
  const [metaByIndex, setMetaByIndex] = useState<Record<number, LlmProxyChatMeta>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non–deny-list failures: full payload in a modal (MuleSoft / downstream errors). */
  const [implementationError, setImplementationError] = useState<{
    httpStatus: number;
    title: string;
    hint: string;
    payload: Record<string, unknown>;
  } | null>(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [params, setParams] = useState<PlaygroundParams>(DEFAULT_PARAMS);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [lastRequest, setLastRequest] = useState<unknown>(null);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  /** Org/env context for this proxy (resolved lazily from sessionStorage / URL). */
  const [ctx, setCtx] = useState<{ orgId: string; envId: string }>({ orgId: "", envId: "" });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch detail whenever the proxy changes.
  useEffect(() => {
    let cancelled = false;
    devLog(
      `[LLM-PROXY-CLIENT ChatPlayground] proxy changed -> id=${proxy?.id} ` +
        `name="${proxy?.name}" endpointUri=${proxy?.endpointUri} ` +
        `basePath=${proxy?.basePath}`
    );
    setDetail(null);
    setDetailError(null);
    setMessages([]);
    setMetaByIndex({});
    setDraft("");
    setError(null);
    setImplementationError(null);
    setLastRequest(null);
    setLastResponse(null);
    setParams(DEFAULT_PARAMS);
    onRouteTrace?.(null);

    if (!proxy) return;
    const search = new URLSearchParams(window.location.search);
    const ctxRaw = sessionStorage.getItem("llm-proxy-ctx");
    let ctxOrgId = "";
    let ctxEnvId = "";
    if (ctxRaw) {
      try {
        const parsedCtx = JSON.parse(ctxRaw) as { orgId?: string; envId?: string };
        ctxOrgId = parsedCtx.orgId ?? "";
        ctxEnvId = parsedCtx.envId ?? "";
      } catch {
        /* ignore */
      }
    }
    if (!ctxOrgId) ctxOrgId = search.get("orgId") ?? "";
    if (!ctxEnvId) ctxEnvId = search.get("envId") ?? "";
    setCtx({ orgId: ctxOrgId, envId: ctxEnvId });

    if (!ctxOrgId || !ctxEnvId) {
      setDetailError("Missing org/env context for detail lookup.");
      return;
    }

    setDetailLoading(true);
    const qs = new URLSearchParams({ orgId: ctxOrgId, envId: ctxEnvId });
    const detailUrl = `/api/llm-proxy/${encodeURIComponent(proxy.id)}?${qs.toString()}`;
    devLog(
      `[LLM-PROXY-CLIENT ChatPlayground] fetching detail proxy.id=${proxy.id} url=${detailUrl}`
    );
    fetch(detailUrl)
      .then(async (res) => {
        const data = (await res.json()) as LlmProxyDetail & { error?: string };
        if (!res.ok) throw new Error(data.error || `Failed: ${res.status}`);
        if (cancelled) return;
        devLog(
          `[LLM-PROXY-CLIENT ChatPlayground] detail received id=${data.id} ` +
            `publicEndpoint=${data.publicEndpoint} basePath=${data.basePath} ` +
            `routingStrategy=${data.routingStrategy}`
        );
        setDetail(data);
        const firstFormatted =
          data.upstreams[0] != null
            ? formatLlmProxyModelForRequest(data.upstreams[0])
            : "";
        setParams((prev) => ({
          ...prev,
          model: prev.model || firstFormatted,
        }));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Failed to load detail");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [proxy, onRouteTrace]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function addSystemMessage(): void {
    setMessages((prev) => [...prev, { role: "system", content: "" }]);
  }

  function updateMessage(index: number, patch: Partial<ChatMessage>): void {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m))
    );
  }

  function removeMessage(index: number): void {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  }

  function clearConversation(): void {
    setMessages([]);
    setMetaByIndex({});
    setDraft("");
    setError(null);
    setImplementationError(null);
    setLastRequest(null);
    setLastResponse(null);
  }

  function buildPayload(extra: ChatMessage[]): Record<string, unknown> {
    const all = [...messages, ...extra].filter((m) => m.content.trim().length > 0 || m.role === "tool");
    const payload: Record<string, unknown> = {};
    let modelForRequest = params.model.trim();
    if (
      modelForRequest.length > 0 &&
      activeDetail?.routingStrategy === "model-based" &&
      !modelForRequest.includes("/")
    ) {
      const resolved = resolveBareModelViaSingleUpstream(
        modelForRequest,
        activeDetail.upstreams
      );
      if (resolved) modelForRequest = resolved;
    }
    if (modelForRequest.length > 0) payload.model = modelForRequest;
    if (params.temperature != null) payload.temperature = params.temperature;
    if (params.topP != null) payload.top_p = params.topP;
    if (params.maxCompletionTokens != null)
      payload.max_completion_tokens = params.maxCompletionTokens;
    if (params.stream) payload.stream = true;

    if (endpoint === "/chat/completions") {
      payload.messages = all.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      }));
    } else {
      payload.input = all.map((m) => ({ role: m.role, content: m.content }));
    }
    return payload;
  }

  function extractNonStreamText(response: unknown): string {
    if (!response || typeof response !== "object") return "";
    if (endpoint === "/chat/completions") {
      const obj = response as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = obj.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    }
    const obj = response as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: unknown; type?: string }> }>;
    };
    if (typeof obj.output_text === "string") return obj.output_text;
    const chunks = obj.output?.[0]?.content;
    if (Array.isArray(chunks)) {
      return chunks
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .join("");
    }
    return "";
  }

  function extractUsage(body: unknown): LlmProxyUsage | null {
    if (!body || typeof body !== "object") return null;
    const u = (body as { usage?: unknown }).usage;
    if (!u || typeof u !== "object") return null;
    const obj = u as Record<string, unknown>;
    const toNum = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    return {
      prompt_tokens: toNum(obj.prompt_tokens) ?? toNum(obj.input_tokens),
      completion_tokens: toNum(obj.completion_tokens) ?? toNum(obj.output_tokens),
      total_tokens: toNum(obj.total_tokens),
    };
  }

  async function sendMessage(): Promise<void> {
    if (sending) return;
    if (!creds) {
      setError("Enter credentials first.");
      return;
    }
    const text = draft.trim();
    if (text.length === 0) return;

    const newUserMessage: ChatMessage = { role: "user", content: text };
    const assistantPlaceholder: ChatMessage = { role: "assistant", content: "" };
    let assistantIndex = -1;
    setMessages((prev) => {
      assistantIndex = prev.length + 1;
      return [...prev, newUserMessage, assistantPlaceholder];
    });
    setDraft("");
    setError(null);
    setImplementationError(null);
    setSending(true);
    onRouteTrace?.(null);

    const payload = buildPayload([newUserMessage]);
    setLastRequest({ endpoint, ...payload });
    setLastResponse(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const captureMeta = (meta: LlmProxyChatMeta) => {
      if (assistantIndex < 0) return;
      setMetaByIndex((prev) => ({ ...prev, [assistantIndex]: meta }));
      onRouteTrace?.(routeTraceFromProxyHeaders(meta.headers));
    };

    try {
      const res = await fetch("/api/llm-proxy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          publicEndpoint: creds.publicEndpoint,
          basePath: creds.basePath,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          payload,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const raw = await res.text();
        let errJson: Record<string, unknown>;
        try {
          errJson = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          errJson = { error: `HTTP ${res.status}`, detail: raw };
        }
        setLastResponse(errJson);

        if (isLlmProxyDenyListChatError(res.status, errJson)) {
          const denyTrace = routeTraceFromChatProxyError(res.status, errJson);
          if (denyTrace) onRouteTrace?.(denyTrace);
          const msg = formatDenyListInlineMessage(errJson);
          setMessages((prev) => {
            const copy = [...prev];
            const lastIdx = copy.length - 1;
            if (lastIdx >= 0 && copy[lastIdx].role === "assistant") {
              copy[lastIdx] = {
                ...copy[lastIdx],
                content: msg,
                blockReason: "semantic-deny",
              };
            }
            return copy;
          });
        } else {
          const { title, hint } = implementationErrorCopy(res.status);
          setImplementationError({
            httpStatus: res.status,
            title,
            hint,
            payload: errJson,
          });
          setMessages((prev) => {
            const copy = [...prev];
            const lastIdx = copy.length - 1;
            if (
              lastIdx >= 0 &&
              copy[lastIdx].role === "assistant" &&
              copy[lastIdx].content === ""
            ) {
              copy.pop();
            }
            return copy;
          });
        }
        return;
      }

      const eagerHeadersRaw = res.headers.get("X-Llm-Proxy-Headers");
      let eagerHeaders: Record<string, string> | null = null;
      if (eagerHeadersRaw) {
        try {
          eagerHeaders = JSON.parse(eagerHeadersRaw) as Record<string, string>;
        } catch {
          /* ignore */
        }
      }

      const contentType = res.headers.get("Content-Type") ?? "";
      if (params.stream && contentType.includes("event-stream") && res.body) {
        let acc = "";
        const rawEvents: string[] = [];
        let streamMeta: Record<string, string> | null = eagerHeaders;
        for await (const evt of parseSseStream(res.body)) {
          rawEvents.push(evt.data);
          if (evt.event === "llm-proxy-meta") {
            try {
              streamMeta = JSON.parse(evt.data) as Record<string, string>;
            } catch {
              /* ignore malformed meta event */
            }
            continue;
          }
          if (evt.data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(evt.data) as unknown;
            const delta =
              endpoint === "/chat/completions"
                ? extractChatCompletionDelta(parsed)
                : extractResponsesDelta(parsed);
            if (delta.length > 0) {
              acc += delta;
              const current = acc;
              setMessages((prev) => {
                const copy = [...prev];
                const lastIdx = copy.length - 1;
                if (lastIdx >= 0 && copy[lastIdx].role === "assistant") {
                  copy[lastIdx] = { ...copy[lastIdx], content: current };
                }
                return copy;
              });
            }
          } catch {
            /* not JSON, ignore */
          }
        }
        setLastResponse({ stream: true, events: rawEvents, meta: streamMeta });
        if (streamMeta) {
          captureMeta({ headers: streamMeta, usage: null, endpoint });
        }
      } else {
        const envelope = (await res.json()) as {
          data?: unknown;
          headers?: Record<string, string>;
        };
        const data = envelope.data;
        const headers = envelope.headers ?? {};
        setLastResponse(envelope);
        const assistantText = extractNonStreamText(data);
        setMessages((prev) => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          if (lastIdx >= 0 && copy[lastIdx].role === "assistant") {
            copy[lastIdx] = { ...copy[lastIdx], content: assistantText };
          }
          return copy;
        });
        captureMeta({ headers, usage: extractUsage(data), endpoint });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // user aborted; keep partial content
      } else {
        const msg = err instanceof Error ? err.message : "Request failed";
        setImplementationError({
          httpStatus: 0,
          title: "Could not complete chat request",
          hint: "The browser failed before a normal HTTP response was handled. Check your connection and try again.",
          payload: { error: msg },
        });
        setMessages((prev) => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          if (lastIdx >= 0 && copy[lastIdx].role === "assistant" && copy[lastIdx].content === "") {
            copy.pop();
          }
          return copy;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function cancelSend(): void {
    abortRef.current?.abort();
  }

  // Only trust `detail` when it actually belongs to the currently-selected
  // proxy. Otherwise we can leak the previous proxy's publicEndpoint/basePath
  // into `CredentialsPanel` during the render that happens before the reset
  // effect clears `detail`.
  const activeDetail = detail && detail.id === proxy.id ? detail : null;
  const resolvedDefaultPublicEndpoint =
    activeDetail?.publicEndpoint ?? proxy.endpointUri?.replace(/\/+$/, "") ?? null;
  const resolvedDefaultBasePath = activeDetail?.basePath ?? proxy.basePath;
  devLog(
    `[LLM-PROXY-CLIENT ChatPlayground] render proxy.id=${proxy.id} ` +
      `detail.id=${detail?.id ?? "null"} activeDetail=${activeDetail ? "match" : "null"} ` +
      `-> defaultPublicEndpoint=${resolvedDefaultPublicEndpoint} ` +
      `defaultBasePath=${resolvedDefaultBasePath}`
  );

  const modelOptions = useMemo(() => {
    const opts = new Set<string>();
    if (activeDetail) {
      for (const s of collectModelOptions(activeDetail.upstreams)) {
        opts.add(s);
      }
    }
    if (params.model.length > 0) opts.add(params.model);
    return Array.from(opts);
  }, [activeDetail, params.model]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {implementationError != null && (
        <LlmProxyChatErrorModal
          open
          onClose={() => setImplementationError(null)}
          title={implementationError.title}
          hint={implementationError.hint}
          httpStatus={implementationError.httpStatus}
          payload={implementationError.payload}
        />
      )}
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{proxy.name}</div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <span className="font-mono">#{proxy.id}</span>
            {activeDetail?.routingStrategy && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                {activeDetail.routingStrategy}
              </span>
            )}
            {activeDetail?.endpointFormat && activeDetail.endpointFormat !== "unknown" && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                {activeDetail.endpointFormat}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => setEndpoint("/chat/completions")}
              className={`rounded px-2 py-1 text-xs font-medium ${
                endpoint === "/chat/completions"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              /chat/completions
            </button>
            <button
              type="button"
              onClick={() => setEndpoint("/responses")}
              className={`rounded px-2 py-1 text-xs font-medium ${
                endpoint === "/responses"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              /responses
            </button>
          </div>
          <button
            type="button"
            onClick={clearConversation}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Body: credentials first, then prompts/routes, model params, chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="shrink-0 space-y-2 border-b border-gray-100 p-3">
          {detailLoading && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Spinner size="s" />
              Loading proxy detail...
            </div>
          )}
          {detailError && (
            <div className="text-xs text-red-600">Failed to load detail: {detailError}</div>
          )}
          <CredentialsPanel
            instanceId={proxy.id}
            defaultPublicEndpoint={resolvedDefaultPublicEndpoint}
            defaultBasePath={resolvedDefaultBasePath}
            onChange={setCreds}
          />
          {activeDetail?.routingStrategy === "semantic" && (
            <PromptTopicsSidebar
              instanceId={proxy.id}
              orgId={ctx.orgId}
              envId={ctx.envId}
              onSelect={(utterance) => setDraft(utterance)}
            />
          )}
          {activeDetail?.routingStrategy === "model-based" && (
            <ModelRoutesPanel
              upstreams={activeDetail.upstreams}
              selectedModel={params.model}
              onSelect={(model) => {
                setParams((p) => ({ ...p, model }));
                setParamsOpen(true);
              }}
            />
          )}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => setParamsOpen((v) => !v)}
              aria-expanded={paramsOpen}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 text-xs font-semibold text-gray-900">
                  Model & parameters
                </span>
                {!paramsOpen && (
                  <span className="min-w-0 truncate text-xs text-gray-500">
                    {params.model.trim() ? (
                      <span className="font-mono text-gray-700">{params.model.trim()}</span>
                    ) : (
                      <span className="text-gray-400">No model</span>
                    )}
                    <span className="text-gray-400"> · </span>
                    {params.stream ? "SSE" : "Non-stream"}
                  </span>
                )}
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${
                  paramsOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>
            {paramsOpen && (
              <div className="border-t border-gray-100 px-3 pb-3 pt-1">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700">Model</label>
                    <input
                      type="text"
                      list={`models-${proxy.id}`}
                      value={params.model}
                      onChange={(e) => setParams((p) => ({ ...p, model: e.target.value }))}
                      placeholder={
                        activeDetail?.routingStrategy === "semantic"
                          ? "(omit for semantic routing)"
                          : "openai/gpt-5.2"
                      }
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <datalist id={`models-${proxy.id}`}>
                      {modelOptions.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    {activeDetail?.routingStrategy === "model-based" && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        When multiple providers are configured, use{" "}
                        <span className="font-mono text-gray-700">provider/model</span> (e.g.{" "}
                        <span className="font-mono">azureopenai/gpt-5-mini</span>). Use the Routes
                        chips above to pick a route.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={params.temperature ?? ""}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          temperature: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Top P</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={params.topP ?? ""}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          topP: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Max tokens</label>
                    <input
                      type="number"
                      min="1"
                      value={params.maxCompletionTokens ?? ""}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          maxCompletionTokens: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
                    <input
                      id={`stream-${proxy.id}`}
                      type="checkbox"
                      checked={params.stream}
                      onChange={(e) => setParams((p) => ({ ...p, stream: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor={`stream-${proxy.id}`} className="text-xs text-gray-700">
                      Stream response (SSE)
                    </label>
                  </div>
                  <div className="col-span-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 sm:col-span-4">
                    <div className="text-xs text-gray-600">
                      <span className="font-medium text-gray-700">System message</span>
                      <span className="ml-1 text-gray-500">
                        — instructions that steer the assistant (optional).
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={addSystemMessage}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Plus className="h-3 w-3" />
                      Add system message
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-gray-50 p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.map((m, idx) => {
              const meta = metaByIndex[idx];
              return (
                <div key={idx} className="flex flex-col gap-0">
                  <MessageRow
                    message={m}
                    onChange={(patch) => updateMessage(idx, patch)}
                    onRemove={() => removeMessage(idx)}
                  />
                  {m.role === "assistant" && meta ? (
                    <ReplyMetaPanels
                      meta={meta}
                      flowContext={{
                        proxyName: activeDetail?.name ?? proxy.name,
                        publicEndpoint:
                          activeDetail?.publicEndpoint ??
                          proxy.endpointUri?.replace(/\/+$/, "") ??
                          null,
                        basePath: activeDetail?.basePath ?? proxy.basePath,
                        upstreams: activeDetail?.upstreams ?? [],
                        endpoint,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            {messages.length === 0 && (
              <div className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-6 text-center text-xs text-gray-500">
                Start the conversation below. Need to set an assistant persona?
                Expand{" "}
                <button
                  type="button"
                  onClick={() => setParamsOpen(true)}
                  className="font-medium text-primary hover:underline"
                >
                  Model & parameters
                </button>{" "}
                above to add a system message.
              </div>
            )}
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-gray-200 bg-white p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              rows={2}
              placeholder="Send a message. Cmd/Ctrl+Enter to send."
              className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {sending ? (
              <button
                type="button"
                onClick={cancelSend}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!creds || draft.trim().length === 0}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            )}
          </div>
        </div>

        {/* Inspector */}
        <div className="shrink-0 border-t border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <span>Inspector (request + response)</span>
            <span className="text-gray-400">{inspectorOpen ? "Hide" : "Show"}</span>
          </button>
          {inspectorOpen && (
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto border-t border-gray-100 p-2">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase text-gray-500">
                  Request
                </div>
                <pre className="max-h-56 overflow-auto rounded bg-gray-900 p-2 text-[11px] text-gray-100">
                  <code>{lastRequest ? JSON.stringify(lastRequest, null, 2) : "(no request yet)"}</code>
                </pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase text-gray-500">
                  Response
                </div>
                <pre className="max-h-56 overflow-auto rounded bg-gray-900 p-2 text-[11px] text-gray-100">
                  <code>
                    {lastResponse ? JSON.stringify(lastResponse, null, 2) : "(no response yet)"}
                  </code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ROLE_COLORS: Record<ChatMessage["role"], string> = {
  system: "bg-amber-50 border-amber-200 text-amber-900",
  developer: "bg-sky-50 border-sky-200 text-sky-900",
  user: "bg-white border-gray-200 text-gray-900",
  assistant: "bg-emerald-50 border-emerald-200 text-emerald-900",
  tool: "bg-purple-50 border-purple-200 text-purple-900",
};

const SEMANTIC_DENY_ROW =
  "bg-amber-50 border-amber-400 text-amber-950 ring-1 ring-amber-200";

function MessageRow({
  message,
  onChange,
  onRemove,
}: {
  message: ChatMessage;
  onChange: (patch: Partial<ChatMessage>) => void;
  onRemove: () => void;
}) {
  const rowStyle =
    message.blockReason === "semantic-deny"
      ? SEMANTIC_DENY_ROW
      : ROLE_COLORS[message.role];

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${rowStyle}`}>
      {message.blockReason === "semantic-deny" && (
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
          Blocked · semantic deny list
        </div>
      )}
      <div className="mb-1 flex items-center justify-between gap-2">
        <select
          value={message.role}
          onChange={(e) =>
            onChange({ role: e.target.value as ChatMessage["role"] })
          }
          className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] font-medium text-gray-700"
        >
          <option value="system">system</option>
          <option value="developer">developer</option>
          <option value="user">user</option>
          <option value="assistant">assistant</option>
          <option value="tool">tool</option>
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-gray-400 hover:bg-white hover:text-gray-700"
          aria-label="Remove message"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <textarea
        value={message.content}
        onChange={(e) => onChange({ content: e.target.value })}
        rows={Math.max(2, Math.min(10, message.content.split("\n").length))}
        className="w-full resize-none bg-transparent text-sm focus:outline-none"
      />
    </div>
  );
}
