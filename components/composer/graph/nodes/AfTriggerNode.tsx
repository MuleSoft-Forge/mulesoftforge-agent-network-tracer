"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import type { AgentFabricGraphNodeData } from "@/lib/composer/agentfabric-graph-types";
import { NodeHandles, AF_TRIGGER_SIDES } from "@/components/composer/graph/nodes/NodeHandles";

export function AfTriggerNode({ data, selected }: NodeProps<Node<AgentFabricGraphNodeData>>) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-teal-50 px-5 py-3.5 shadow-md transition-all ${
        selected
          ? "border-blue-400 ring-2 ring-blue-400/20"
          : "border-teal-400 hover:border-teal-500 hover:shadow-lg"
      }`}
    >
      <NodeHandles sides={AF_TRIGGER_SIDES} connectedHandles={data.connectedHandles} accentColor="#2dd4bf" />
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100">
        <MessageSquare size={18} className="text-teal-600" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-teal-700">{data.label}</div>
        {data.subtitle ? <div className="text-xs text-teal-600/70">{data.subtitle}</div> : null}
      </div>
    </div>
  );
}
