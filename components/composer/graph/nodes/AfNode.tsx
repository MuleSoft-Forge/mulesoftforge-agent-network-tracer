"use client";

import type { Node, NodeProps } from "@xyflow/react";
import type { AgentFabricGraphNodeData } from "@/lib/composer/agentfabric-graph-types";
import { KindIcon } from "@/components/composer/graph/KindIcon";
import { NodeHandles, OVERVIEW_SIDES } from "@/components/composer/graph/nodes/NodeHandles";
import { accentForKind } from "@/components/composer/graph/kind-accent";

export function AfNode({ data, selected }: NodeProps<Node<AgentFabricGraphNodeData>>) {
  const kind = data.kind;
  const accent = accentForKind(kind);

  return (
    <div
      className={`min-w-56 overflow-hidden rounded-xl border bg-slate-50 shadow-md transition-colors ${
        selected
          ? "border-blue-400 ring-2 ring-blue-400/20"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <NodeHandles sides={OVERVIEW_SIDES} connectedHandles={data.connectedHandles} accentColor={accent} />
      <div className="flex items-stretch">
        <div className="w-1 shrink-0" style={{ backgroundColor: accent }} aria-hidden />
        <div className="flex flex-1 items-center gap-3 px-4 py-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: `${accent}1f` }}
          >
            <KindIcon kind={kind} size={18} />
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
            </div>
            {data.subtitle && data.subtitle !== kind ? (
              <div className="text-xs text-slate-600/70">{data.subtitle}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
