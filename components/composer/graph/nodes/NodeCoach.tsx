"use client";

import type { ReactNode } from "react";
import { Bug, CircleHelp, CornerDownRight, Plus, X } from "lucide-react";
import { NodeToolbar, Position } from "@xyflow/react";
import type {
  NextStepSuggestion,
  NodeCoachData,
  NodeCoachItem,
  NodeCoachPanel,
} from "@/lib/composer/agentfabric-graph-types";
import { KindIcon } from "@/components/composer/graph/KindIcon";
import { accentForKind } from "@/components/composer/graph/kind-accent";

/** Popup geometry, shared with the editor so it can pick a side that fits. */
export const COACH_POPUP_WIDTH = 288;
export const COACH_POPUP_OFFSET = 16;

const TIER_BADGE: Record<NodeCoachItem["tier"], { label: string; className: string }> = {
  required: { label: "Required", className: "bg-red-50 text-red-600 ring-red-200" },
  recommended: { label: "Recommended", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  optional: { label: "Optional", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

function CoachButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {icon}
      {label}
      {badge ? (
        <span className="rounded-full bg-red-100 px-1 text-[9px] font-semibold text-red-600">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function PanelShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="nodrag nopan rounded-lg border border-primary/30 bg-white p-2.5 text-left shadow-2xl"
      style={{ width: COACH_POPUP_WIDTH }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-0.5 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
            <Bug className="h-2.5 w-2.5" />
            ANT Coach
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">{title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close coach"
          className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {children}
    </div>
  );
}

function NodeAdvicePanel({ coach }: { coach: NodeCoachData }) {
  return (
    <PanelShell
      title="Node playbook"
      subtitle={`${coach.nodeName} — ${coach.outcome}`}
      onClose={coach.onClose}
    >
      {coach.items.length === 0 ? (
        <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] leading-snug text-emerald-700">
          No blockers on this node.
        </p>
      ) : (
        <div className="mt-2 space-y-1">
          {coach.items.map((item) => {
            const badge = TIER_BADGE[item.tier];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => coach.onFocusItem(item)}
                className="block w-full rounded border border-slate-200 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <span
                  className={`inline-block rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset ${badge.className}`}
                >
                  {badge.label}
                </span>
                <span className="mt-1 block text-[11px] font-medium leading-snug text-slate-800">
                  {item.title}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
                  {item.why}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}

function NextStepRow({
  suggestion,
  onAdd,
}: {
  suggestion: NextStepSuggestion;
  onAdd: (kind: NextStepSuggestion["kind"]) => void;
}) {
  const accent = accentForKind(suggestion.kind);
  return (
    <button
      type="button"
      onClick={() => onAdd(suggestion.kind)}
      className="group flex w-full items-start gap-2 rounded border border-slate-200 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span
        className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{ backgroundColor: `${accent}1f` }}
      >
        <KindIcon kind={suggestion.kind} size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-slate-800">{suggestion.kind}</span>
          <Plus className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-primary" />
        </span>
        <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
          {suggestion.reason}
        </span>
        {suggestion.detail ? (
          <span className="mt-1 block text-[10px] leading-snug text-slate-400">
            {suggestion.detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function NextStepPanel({ coach }: { coach: NodeCoachData }) {
  return (
    <PanelShell
      title="Next move"
      subtitle={`Best follow-up plays after ${coach.nodeName}, with why each one works.`}
      onClose={coach.onClose}
    >
      <div className="mt-2 space-y-1">
        {coach.nextSteps.map((suggestion) => (
          <NextStepRow key={suggestion.kind} suggestion={suggestion} onAdd={coach.onAddNext} />
        ))}
      </div>
    </PanelShell>
  );
}

/**
 * Coaching controls pinned to the bottom of a node card. The advice itself
 * lives in popups so an unopened coach costs no canvas space, and the popups
 * render through {@link NodeToolbar} so they stay legible at any zoom.
 */
export function NodeCoachFooter({ coach }: { coach: NodeCoachData }) {
  const openPanel: NodeCoachPanel | null = coach.openPanel;
  const blocking = coach.items.filter((item) => item.tier === "required").length;

  return (
    <>
      <div className="nodrag flex items-center gap-1 border-t border-slate-200/70 px-2 py-1">
        <CoachButton
          active={openPanel === "node"}
          onClick={() => coach.onOpen("node")}
          icon={<CircleHelp className="h-3 w-3" />}
          label="Node tips"
          badge={blocking}
        />
        {coach.nextSteps.length > 0 ? (
          <CoachButton
            active={openPanel === "next"}
            onClick={() => coach.onOpen("next")}
            icon={<CornerDownRight className="h-3 w-3" />}
            label="What next?"
          />
        ) : null}
      </div>
      <NodeToolbar
        isVisible={openPanel !== null}
        position={coach.openSide === "left" ? Position.Left : Position.Right}
        offset={COACH_POPUP_OFFSET}
        align="start"
      >
        {openPanel === "node" ? <NodeAdvicePanel coach={coach} /> : null}
        {openPanel === "next" ? <NextStepPanel coach={coach} /> : null}
      </NodeToolbar>
    </>
  );
}
