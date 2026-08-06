"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { AgentFabricGraphNodeData } from "@/lib/composer/agentfabric-graph-types";
import { KindIcon } from "@/components/composer/graph/KindIcon";
import { parseProtocolOutputs, routerOutputHandleId } from "@/lib/composer/agentfabric-graph";
import { NodeHandles } from "@/components/composer/graph/nodes/NodeHandles";
import { NodeIssueDot } from "@/components/composer/graph/nodes/NodeDetail";

const ROUTER_ACCENT = "#f59e0b";

function routerOutputDisplayLabel(output: string): string {
  if (output === "route") return "+ route";
  return output;
}

function isRouterSlotHandle(output: string): boolean {
  return output === "route" || output === "otherwise";
}

export function AfRouterNode({ data, selected }: NodeProps<Node<AgentFabricGraphNodeData>>) {
  const outputs = parseProtocolOutputs(data.outputs);
  const connected = data.connectedHandles;
  const compatibility = data.handleCompatibility ?? {};

  return (
    <div
      className={`min-w-60 rounded-xl border bg-amber-50 shadow-md transition-colors ${
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-amber-300 hover:border-amber-400"
      }`}
    >
      <NodeHandles
        sides={{ top: { type: "target" }, left: { type: "target" } }}
        connectedHandles={connected}
        accentColor={ROUTER_ACCENT}
        compatibilityByHandle={data.handleCompatibility}
      />
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100">
          <KindIcon kind="router" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-amber-800">{data.label}</div>
            <NodeIssueDot severity={data.issueSeverity} summary={data.issueSummary} />
          </div>
          <div className="text-xs text-amber-700/70">{data.subtitle ?? "router"}</div>
          {outputs.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {outputs.map((output) => {
                const handleId = routerOutputHandleId(output);
                const isConnected = connected?.has(handleId) ?? false;
                const isSlot = isRouterSlotHandle(output);
                const hint = compatibility[handleId];
                const isCompatible = hint === "compatible";
                const isIncompatible = hint === "incompatible";
                return (
                  <li
                    key={handleId}
                    className={`relative flex items-center justify-between rounded px-2 py-0.5 text-xs text-amber-800 ${
                      isSlot ? "border border-dashed border-amber-300/80 bg-amber-50/80" : "bg-amber-100/60"
                    }`}
                  >
                    <span className="truncate">{routerOutputDisplayLabel(output)}</span>
                    <Handle
                      id={handleId}
                      type="source"
                      position={Position.Right}
                      className={
                        isCompatible
                          ? "!h-[10px] !w-[10px] !border-[1.5px] !border-emerald-200 !bg-emerald-500 !shadow-[0_0_0_6px_rgba(16,185,129,0.15)]"
                          : isIncompatible
                            ? "!h-[10px] !w-[10px] !animate-pulse !border-[1.5px] !border-red-200 !bg-red-500 !shadow-[0_0_0_8px_rgba(239,68,68,0.15)]"
                            : isConnected
                              ? "!h-[9px] !w-[9px] !border-[1.5px] !border-white !shadow-sm"
                              : "!h-[7px] !w-[7px] !border !border-amber-400/70 !bg-white"
                      }
                      style={{
                        top: "50%",
                        right: -5,
                        ...(isConnected && !isCompatible && !isIncompatible ? { backgroundColor: ROUTER_ACCENT } : {}),
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
