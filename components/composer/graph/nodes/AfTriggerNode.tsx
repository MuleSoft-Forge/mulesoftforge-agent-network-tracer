"use client";

import type { Node, NodeProps } from "@xyflow/react";
import type { AgentFabricGraphNodeData } from "@/lib/composer/agentfabric-graph-types";
import { KindIcon } from "@/components/composer/graph/KindIcon";
import { NodeHandles, AF_TRIGGER_SIDES } from "@/components/composer/graph/nodes/NodeHandles";
import { NodeIssueDot } from "@/components/composer/graph/nodes/NodeDetail";

export function AfTriggerNode({ data, selected }: NodeProps<Node<AgentFabricGraphNodeData>>) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-teal-50 px-5 py-3.5 shadow-md transition-all ${
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-teal-400 hover:border-teal-500 hover:shadow-lg"
      }`}
    >
      <NodeHandles
        sides={AF_TRIGGER_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor="#2dd4bf"
        compatibilityByHandle={data.handleCompatibility}
      />
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100">
        <KindIcon kind="trigger" size={20} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-semibold text-teal-700">{data.label}</div>
          <NodeIssueDot severity={data.issueSeverity} summary={data.issueSummary} />
        </div>
        {data.subtitle ? <div className="text-xs text-teal-600/70">{data.subtitle}</div> : null}
      </div>
    </div>
  );
}
