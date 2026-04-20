"use client";

import { ChevronDown, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Spinner from "@/components/Spinner";
import type {
  LlmProxyPromptTopic,
  LlmProxyPromptTopicsResponse,
} from "@/lib/llmProxy/types";

interface PromptTopicsSidebarProps {
  instanceId: string;
  orgId: string;
  envId: string;
  onSelect: (utterance: string) => void;
}

/** Rotating accent per topic section (non–deny-list topics). */
const TOPIC_SECTION_STYLES: readonly {
  section: string;
  headerMuted: string;
  icon: string;
  chip: string;
  utteranceBtn: string;
}[] = [
  {
    section: "border-sky-200 bg-sky-50/90",
    headerMuted: "text-sky-800",
    icon: "text-sky-600",
    chip: "bg-sky-100/90 text-sky-800",
    utteranceBtn:
      "border-sky-200 bg-white/90 text-sky-900 hover:bg-sky-100/90",
  },
  {
    section: "border-violet-200 bg-violet-50/90",
    headerMuted: "text-violet-800",
    icon: "text-violet-600",
    chip: "bg-violet-100/90 text-violet-800",
    utteranceBtn:
      "border-violet-200 bg-white/90 text-violet-900 hover:bg-violet-100/90",
  },
  {
    section: "border-emerald-200 bg-emerald-50/90",
    headerMuted: "text-emerald-800",
    icon: "text-emerald-600",
    chip: "bg-emerald-100/90 text-emerald-800",
    utteranceBtn:
      "border-emerald-200 bg-white/90 text-emerald-900 hover:bg-emerald-100/90",
  },
  {
    section: "border-amber-200 bg-amber-50/90",
    headerMuted: "text-amber-900",
    icon: "text-amber-600",
    chip: "bg-amber-100/90 text-amber-900",
    utteranceBtn:
      "border-amber-200 bg-white/90 text-amber-900 hover:bg-amber-100/90",
  },
  {
    section: "border-rose-200 bg-rose-50/90",
    headerMuted: "text-rose-800",
    icon: "text-rose-600",
    chip: "bg-rose-100/90 text-rose-800",
    utteranceBtn:
      "border-rose-200 bg-white/90 text-rose-900 hover:bg-rose-100/90",
  },
  {
    section: "border-cyan-200 bg-cyan-50/90",
    headerMuted: "text-cyan-900",
    icon: "text-cyan-600",
    chip: "bg-cyan-100/90 text-cyan-900",
    utteranceBtn:
      "border-cyan-200 bg-white/90 text-cyan-900 hover:bg-cyan-100/90",
  },
];

const DENY_SECTION_STYLES = {
  section: "border-red-200 bg-red-50/90",
  headerMuted: "text-red-800",
  icon: "text-red-600",
  chip: "bg-red-100/90 text-red-800",
  utteranceBtn: "border-red-200 bg-white/90 text-red-900 hover:bg-red-100/90",
} as const;

/**
 * Renders the real semantic prompt topics configured on this LLM Proxy.
 * Source of truth: /api/llm-proxy/{id}/prompt-topics (which itself reads
 * `api/v1/.../apis/{id}/policies?fullInfo=true`).
 *
 * Each topic renders as a section header with:
 *  - N utterance chips if the semantic service returned them (xapi succeeded), or
 *  - a single chip with the topic name (clicking it seeds the prompt textarea).
 *
 * No hardcoded defaults. If the proxy has no semantic topics configured, we
 * say so plainly.
 */
export default function PromptTopicsSidebar({
  instanceId,
  orgId,
  envId,
  onSelect,
}: PromptTopicsSidebarProps) {
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState<LlmProxyPromptTopic[]>([]);

  useEffect(() => {
    if (!instanceId || !orgId || !envId) return;
    let cancelled = false;
    setLoading(true);
    setTopics([]);
    const qs = new URLSearchParams({ orgId, envId });
    fetch(
      `/api/llm-proxy/${encodeURIComponent(instanceId)}/prompt-topics?${qs.toString()}`
    )
      .then(async (res) => {
        const data = (await res.json()) as LlmProxyPromptTopicsResponse;
        if (cancelled) return;
        setTopics(data.topics ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setTopics([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, orgId, envId]);

  const hasTopics = topics.length > 0;
  const utteranceAvailability = useMemo(() => {
    const withUtterances = topics.filter((t) => t.utterances.length > 0).length;
    return { withUtterances, total: topics.length };
  }, [topics]);
  const anyUtterances = utteranceAvailability.withUtterances > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Prompt topics</span>
          {loading && <Spinner size="s" />}
          {!loading && hasTopics && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              {topics.length} topic{topics.length === 1 ? "" : "s"}
            </span>
          )}
          {!loading && hasTopics && !anyUtterances && (
            <span
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
              title="Anypoint did not return utterance text for these topics (xapi). Showing topic names only; counts still reflect configured utterances."
            >
              names only
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-gray-500 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded && (
        <div className="border-t border-gray-100">
          <div className="max-h-[min(50vh,20rem)] overflow-y-auto overflow-x-hidden px-3 py-3">
            <div className="space-y-3">
              {!hasTopics && !loading && (
                <div className="text-[11px] text-gray-500">
                  No semantic prompt topics configured for this proxy.
                </div>
              )}
              {hasTopics &&
                topics.map((t, i) => {
                  const nonDenyIndex = topics
                    .slice(0, i)
                    .filter((x) => !x.usedForDenyList).length;
                  const styles = t.usedForDenyList
                    ? DENY_SECTION_STYLES
                    : TOPIC_SECTION_STYLES[
                        nonDenyIndex % TOPIC_SECTION_STYLES.length
                      ];
                  return (
                    <div
                      key={t.id}
                      className={`space-y-1.5 rounded-lg border p-2.5 ${styles.section}`}
                    >
                      <div
                        className={`flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${styles.headerMuted}`}
                      >
                        {t.usedForDenyList ? (
                          <ShieldAlert className={`h-3 w-3 ${styles.icon}`} />
                        ) : (
                          <Sparkles className={`h-3 w-3 ${styles.icon}`} />
                        )}
                        <span>{t.name}</span>
                        {t.utteranceCount > 0 && (
                          <span
                            className={`rounded px-1 text-[9px] font-medium ${styles.chip}`}
                            title={`${t.utteranceCount} utterance${t.utteranceCount === 1 ? "" : "s"} configured`}
                          >
                            {t.utteranceCount}
                          </span>
                        )}
                        {t.routeLabel && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-medium normal-case ${styles.chip}`}
                          >
                            {t.routeLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {t.utterances.length > 0 ? (
                          t.utterances.map((utter, j) => (
                            <button
                              key={j}
                              type="button"
                              onClick={() => onSelect(utter)}
                              className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${styles.utteranceBtn}`}
                            >
                              {utter}
                            </button>
                          ))
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelect(t.name)}
                            className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${styles.utteranceBtn}`}
                            title="Utterance lines not returned for this topic; click to insert the topic name."
                          >
                            {t.name}
                            <span className="ml-1 text-[10px] opacity-60">
                              (name only — when xapi returns utterances, lines appear here)
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
