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
    label: "Project",
    order: 1,
    headline: "Ground every decision in a clear identity",
    why: "Asset ID, version, and organization must exist before anything else can reference them. Getting these right first means your Exchange listing, GAV coordinate, and downstream YAML are all coherent from the start — no renaming cascades later.",
  },
  {
    tab: "assets",
    group: "Agent network",
    label: "Exchange Assets",
    order: 2,
    headline: "Compose real connections before wiring anything",
    why: "LLMs, MCP servers, and agent dependencies must be declared as Exchange assets before the broker can reference them. Composing here creates the context.connections entries and exchange.json dependencies that the graph and AgentScript will draw on.",
  },
  {
    tab: "access",
    group: "Broker",
    label: "A2A Interface",
    order: 3,
    headline: "Decide how callers reach this broker first",
    why: "The inbound interface policies (auth, rate-limiting, observability) shape the security requirements that are automatically projected into the A2A card. Setting access before the card avoids hand-editing card.securitySchemes and card.securityRequirements.",
  },
  {
    tab: "a2a-card",
    group: "Broker",
    label: "A2A Card",
    order: 4,
    headline: "Make the public contract explicit and complete",
    why: "The card is what peer agents discover. It must accurately reflect the skills, capabilities, and security the broker will actually provide — not aspirational text. After the interface is set, derived security fields populate automatically so the card stays consistent.",
  },
  {
    tab: "behavior",
    group: "Broker",
    label: "AS Instructions",
    order: 5,
    headline: "Set the persona before you bind models or actions",
    why: "System instructions are the global identity of the broker's reasoning. Writing them before binding LLMs and actions keeps the prompt intentional rather than reverse-engineered from whatever model happened to be wired in first.",
  },
  {
    tab: "llms",
    group: "Broker",
    label: "AS LLM",
    order: 6,
    headline: "Bind the reasoning engine once the persona is clear",
    why: "Model choice, temperature, and reasoning effort should follow the instruction style, not drive it. Binding here lets you pick the right model tier for the sophistication of reasoning the instructions require.",
  },
  {
    tab: "actions",
    group: "Broker",
    label: "AS Actions",
    order: 7,
    headline: "Register every tool the graph will call",
    why: "Graph nodes reference actions as @actions.<name>. All tool bindings must exist before you build the graph so the node palette shows the right options and validation catches broken references immediately.",
  },
  {
    tab: "graph",
    group: "Broker",
    label: "AS Graph",
    order: 8,
    headline: "Compose the flow last, when all dependencies are declared",
    why: "The graph is the orchestration logic. With identity, assets, interface, card, instructions, LLMs, and actions already set, you can focus entirely on control flow — triggers, conditions, and hand-offs — without context-switching back to fix missing bindings.",
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
