"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import type { PanelTab } from "@/lib/composer/panel-tabs";

type MethodologyStep = {
  tab: PanelTab;
  group: string;
  label: string;
  order: number;
  headline: string;
  why: string;
};

const STEPS: MethodologyStep[] = [
  {
    tab: "identity",
    group: "Agent network",
    label: "Project details",
    order: 1,
    headline: "Set the project identity first",
    why: "Add the project name, asset id, version, and business group first. Every other step references these values, so setting them now prevents rename and version cleanup later.",
  },
  {
    tab: "assets",
    group: "Agent network",
    label: "Exchange assets",
    order: 2,
    headline: "Pick the assets this network will use",
    why: "Add the LLM, MCP, and Agent dependencies from Exchange before building flow logic. This creates the connection entries and dependency list your broker and graph will use.",
  },
  {
    tab: "access",
    group: "Broker",
    label: "A2A broker security",
    order: 3,
    headline: "Define how consumers connect and authenticate",
    why: "Set inbound and outbound policies before card details. Security settings here drive what is published in the card, so this keeps connection rules and metadata aligned.",
  },
  {
    tab: "a2a-card",
    group: "Broker",
    label: "A2A broker card",
    order: 4,
    headline: "Describe your broker for discovery",
    why: "Define the broker card name, description, capabilities, and metadata so other agents can find and use it. With security already set, the card stays consistent with real access rules.",
  },
  {
    tab: "behavior",
    group: "Broker",
    label: "AgentScript: general instructions",
    order: 5,
    headline: "Set the broker's overall behavior",
    why: "Write the global instructions before model and tool details. This sets clear design intent so later settings support the behavior instead of defining it by accident.",
  },
  {
    tab: "llms",
    group: "Broker",
    label: "AgentScript: LLM settings",
    order: 6,
    headline: "Configure model and runtime behavior",
    why: "Choose model provider, model, and runtime settings after instructions are clear. This makes model choices intentional and matched to the behavior you want.",
  },
  {
    tab: "actions",
    group: "Broker",
    label: "AgentScript: available actions",
    order: 7,
    headline: "Define the tools your graph can call",
    why: "Add and configure actions before graph composition. Nodes reference these actions directly, so defining them first avoids broken references and rework.",
  },
  {
    tab: "graph",
    group: "Broker",
    label: "AgentScript: graph composition",
    order: 8,
    headline: "Compose the execution flow last",
    why: "Build the node graph after identity, assets, security, card, instructions, LLM settings, and actions are ready. That lets you focus on flow logic without missing dependencies.",
  },
];

const GROUP_ORDER = ["Agent network", "Broker"];

type ProjectMethodologyModalProps = {
  open: boolean;
  helpModeEnabled: boolean;
  dontShowAgain: boolean;
  onDontShowAgainChange: (value: boolean) => void;
  onDisableHighlights: () => void;
  onClose: () => void;
};

export default function ProjectMethodologyModal({
  open,
  helpModeEnabled,
  dontShowAgain,
  onDontShowAgainChange,
  onDisableHighlights,
  onClose,
}: ProjectMethodologyModalProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = STEPS[activeIdx];

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  if (!open) return null;

  const groupedSteps = GROUP_ORDER.map((groupTitle) => ({
    title: groupTitle,
    steps: STEPS.filter((s) => s.group === groupTitle),
  }));

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="methodology-modal-title"
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />

      <div className="relative flex w-full max-w-3xl overflow-hidden rounded-anypoint border border-composer-border bg-white shadow-xl">
        {/* Left sidebar — mirrors the real builder nav */}
        <div className="flex w-48 shrink-0 flex-col border-r border-composer-border bg-composer-surface">
          <div className="border-b border-composer-border px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-composer-label-muted">
              Builder flow
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5 space-y-3 scrollbar-thin">
            {groupedSteps.map((group) => (
              <div key={group.title}>
                <p className="px-2 text-xs font-semibold uppercase tracking-wide text-composer-label-muted">
                  {group.title}
                </p>
                <div className="mt-0.5 space-y-0.5">
                  {group.steps.map((step) => {
                    const idx = STEPS.indexOf(step);
                    const isActive = idx === activeIdx;
                    return (
                      <button
                        key={step.tab}
                        type="button"
                        onClick={() => setActiveIdx(idx)}
                        className={`flex w-full items-center gap-2 rounded-anypoint px-2.5 py-1.5 text-left text-xs font-medium transition-anypoint ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-composer-label-muted hover:bg-composer-surface-muted"
                        }`}
                      >
                        <MuleIcon tab={step.tab} size={14} className="opacity-80 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{step.label}</span>
                        <span
                          className={`shrink-0 rounded-full text-[10px] font-semibold w-4 h-4 flex items-center justify-center ${
                            isActive
                              ? "bg-primary text-white"
                              : "bg-composer-surface-muted text-composer-label-muted"
                          }`}
                        >
                          {step.order}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — why this step, in this order */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between border-b border-composer-border px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                Step {active.order} of {STEPS.length}
              </p>
              <h2
                id="methodology-modal-title"
                className="mt-0.5 text-lg font-semibold tracking-tight text-gray-900"
              >
                {active.label}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-4 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            <div className="rounded-anypoint border border-composer-border bg-composer-surface-muted/40 px-3 py-2.5 text-xs leading-relaxed text-composer-label-muted">
              <p className="font-semibold text-composer-label">Best-practice order</p>
              <p className="mt-1">
                There is a best-practice order to composing an Agent Network. Each step should be validated, and your design intent should stay clear.
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>Project details</li>
                <li>Exchange assets (LLM / MCP / Agent assets to be used)</li>
                <li>A2A broker security (how consumers connect)</li>
                <li>A2A broker card</li>
                <li>AgentScript: general instructions</li>
                <li>AgentScript: LLM settings</li>
                <li>AgentScript: available actions</li>
                <li>AgentScript: graph composition</li>
              </ol>
              <p className="mt-2">
                Why this works: each step provides required context for the next, so by the time you compose the graph, your broker is secure, well-defined, and execution-ready.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-anypoint border border-composer-border bg-composer-surface-muted">
                <MuleIcon tab={active.tab} size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{active.headline}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-composer-label-muted">{active.why}</p>
              </div>
            </div>

            {/* Step progress strip */}
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  aria-label={`Go to step ${i + 1}`}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i === activeIdx
                      ? "bg-primary"
                      : i < activeIdx
                      ? "bg-primary/30"
                      : "bg-composer-border"
                  }`}
                />
              ))}
            </div>

            <div className="rounded-anypoint border border-composer-border bg-composer-surface-muted/40 px-3 py-2.5 text-xs leading-relaxed text-composer-label-muted">
              Prefer to build without gating? You can switch off{" "}
              <span className="font-semibold">Ordered tabs (Gated)</span> in the left navigation at any time.
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-composer-border px-5 py-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => onDontShowAgainChange(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-composer-border text-primary focus:ring-primary"
              />
              Don&apos;t show this again
            </label>

            <div className="flex gap-2">
              {helpModeEnabled ? (
                <button
                  type="button"
                  onClick={onDisableHighlights}
                  className="rounded-anypoint border border-composer-border px-3 py-1.5 text-sm text-composer-label hover:bg-composer-surface-muted"
                >
                  Turn off highlights
                </button>
              ) : null}
              {activeIdx < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setActiveIdx((i) => i + 1)}
                  className="rounded-anypoint border border-composer-border px-3 py-1.5 text-sm text-composer-label hover:bg-composer-surface-muted"
                >
                  Next step
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-anypoint-button bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-600"
              >
                Start modeling
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
