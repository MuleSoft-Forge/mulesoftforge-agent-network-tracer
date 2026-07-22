"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import type { AgentFabricGraphNodeData } from "@/lib/composer/agentfabric-graph-types";
import { parseProtocolOutputs, routerOutputHandleId } from "@/lib/composer/agentfabric-graph";
import { NodeHandles } from "@/components/composer/graph/nodes/NodeHandles";

const ROUTER_ACCENT = "#f59e0b";

export function AfRouterNode({ data, selected }: NodeProps<Node<AgentFabricGraphNodeData>>) {
  const outputs = parseProtocolOutputs(data.outputs);
  const connected = data.connectedHandles;

  return (
    <div
      className={`min-w-60 rounded-xl border bg-amber-50 shadow-md transition-colors ${
        selected
          ? "border-blue-400 ring-2 ring-blue-400/20"
          : "border-amber-300 hover:border-amber-400"
      }`}
    >
      <NodeHandles
        sides={{ top: { type: "target" }, left: { type: "target" } }}
        connectedHandles={connected}
        accentColor={ROUTER_ACCENT}
      />
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100">
          <GitBranch size={16} className="text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-amber-800">{data.label}</div>
          <div className="text-xs text-amber-700/70">{data.subtitle ?? "router"}</div>
          {outputs.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {outputs.map((output) => {
                const handleId = routerOutputHandleId(output);
                const isConnected = connected?.has(handleId) ?? false;
                return (
                  <li
                    key={handleId}
                    className="relative flex items-center justify-between rounded bg-amber-100/60 px-2 py-0.5 text-xs text-amber-800"
                  >
                    <span className="truncate">{output}</span>
                    <Handle
                      id={handleId}
                      type="source"
                      position={Position.Right}
                      className={
                        isConnected
                          ? "!h-[7px] !w-[7px] !border-[1.5px] !border-white !shadow-sm"
                          : "!h-[5px] !w-[5px] !border !border-gray-300/50 !bg-transparent"
                      }
                      style={{
                        top: "50%",
                        right: -4,
                        ...(isConnected ? { backgroundColor: ROUTER_ACCENT } : {}),
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
