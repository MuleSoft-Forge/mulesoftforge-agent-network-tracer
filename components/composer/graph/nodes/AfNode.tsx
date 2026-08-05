"use client";

import type { Node, NodeProps } from "@xyflow/react";
import type { AgentFabricGraphNodeData } from "@/lib/composer/agentfabric-graph-types";
import { KindIcon } from "@/components/composer/graph/KindIcon";
import {
  AF_TERMINAL_SIDES,
  NodeHandles,
  OVERVIEW_SIDES,
} from "@/components/composer/graph/nodes/NodeHandles";
import { NodeIssueDot, NodeSummaryChips } from "@/components/composer/graph/nodes/NodeDetail";
import { accentForKind } from "@/components/composer/graph/kind-accent";
import { useNodeDetailLevel } from "@/components/composer/graph/nodes/use-node-detail-level";

export function AfNode({ data, selected }: NodeProps<Node<AgentFabricGraphNodeData>>) {
  const kind = data.kind;
  const accent = accentForKind(kind);
  const sides = data.terminal ? AF_TERMINAL_SIDES : OVERVIEW_SIDES;
  const detail = useNodeDetailLevel();
  const showDetail = detail === "full";

  return (
    <div
      className={`min-w-56 max-w-72 overflow-hidden rounded-xl border bg-slate-50 shadow-md transition-colors ${
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <NodeHandles sides={sides} connectedHandles={data.connectedHandles} accentColor={accent} />
      <div className="flex items-stretch">
        <div className="w-1 shrink-0" style={{ backgroundColor: accent }} aria-hidden />
        <div className="flex flex-1 items-start gap-3 px-4 py-3">
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: `${accent}1f` }}
          >
            <KindIcon
              kind={kind}
              iconName={kind === "executor" ? data.executorIconKind : undefined}
              size={18}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-slate-800">{data.label}</div>
              {kind ? (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style={{ backgroundColor: `${accent}1f`, color: accent }}
                >
                  {kind}
                </span>
              ) : null}
              <NodeIssueDot severity={data.issueSeverity} summary={data.issueSummary} />
            </div>
            {data.subtitle && data.subtitle !== kind ? (
              <div className="truncate text-xs text-slate-600/70">{data.subtitle}</div>
            ) : null}
            {showDetail ? (
              <>
                <NodeSummaryChips chips={data.summaryChips} accent={accent} />
                {data.preview ? (
                  <p
                    className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-slate-500"
                    title={data.preview}
                  >
                    {data.preview}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
