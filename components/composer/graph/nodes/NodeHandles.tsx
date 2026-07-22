"use client";

import { Handle, Position, type HandleType } from "@xyflow/react";

export type HandleSide = "top" | "bottom" | "left" | "right";

interface SideConfig {
  type: HandleType;
}

export interface NodeHandlesProps {
  sides: Partial<Record<HandleSide, SideConfig>>;
  connectedHandles?: ReadonlySet<string>;
  accentColor?: string;
}

const UNCONNECTED =
  "!h-[5px] !w-[5px] !border !border-gray-300/50 !bg-transparent";
const CONNECTED_BASE = "!h-[7px] !w-[7px] !border-[1.5px] !border-white !shadow-sm";

function handleClass(connected: boolean): string {
  return connected ? CONNECTED_BASE : UNCONNECTED;
}

function handleStyle(connected: boolean, accentColor?: string, offset?: Record<string, string>): React.CSSProperties {
  return {
    ...offset,
    ...(connected && accentColor ? { backgroundColor: accentColor } : {}),
    ...(connected && !accentColor ? { backgroundColor: "#6b7280" } : {}),
  };
}

export function NodeHandles({ sides, connectedHandles, accentColor }: NodeHandlesProps) {
  const isConnected = (id: string) => connectedHandles?.has(id) ?? false;

  return (
    <>
      {sides.top ? (
        <Handle
          id="top"
          type={sides.top.type}
          position={Position.Top}
          className={handleClass(isConnected("top"))}
          style={handleStyle(isConnected("top"), accentColor, { left: "50%" })}
        />
      ) : null}
      {sides.bottom ? (
        <Handle
          id="bottom"
          type={sides.bottom.type}
          position={Position.Bottom}
          className={handleClass(isConnected("bottom"))}
          style={handleStyle(isConnected("bottom"), accentColor, { left: "50%" })}
        />
      ) : null}
      {sides.left ? (
        <Handle
          id="left"
          type={sides.left.type}
          position={Position.Left}
          className={handleClass(isConnected("left"))}
          style={handleStyle(isConnected("left"), accentColor, { top: "50%" })}
        />
      ) : null}
      {sides.right ? (
        <Handle
          id="right"
          type={sides.right.type}
          position={Position.Right}
          className={handleClass(isConnected("right"))}
          style={handleStyle(isConnected("right"), accentColor, { top: "50%" })}
        />
      ) : null}
    </>
  );
}

export const OVERVIEW_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: "target" },
  bottom: { type: "source" },
  left: { type: "target" },
  right: { type: "source" },
};

export const AF_TRIGGER_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  bottom: { type: "source" },
  right: { type: "source" },
};

export const AF_ROUTER_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: "target" },
  left: { type: "target" },
};
