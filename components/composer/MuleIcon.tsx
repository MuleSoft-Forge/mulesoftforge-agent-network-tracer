"use client";

import type { AssetKind, GraphNodeKind } from "@/lib/composer/model";
import type { BuilderPanelTab } from "@/lib/composer/mule-icons";
import {
  type MuleIconKey,
  muleIconForAssetKind,
  muleIconForConnectionKind,
  muleIconForGraphNodeKind,
  muleIconForPanelTab,
  muleIconPathWithTone,
} from "@/lib/composer/mule-icons";

type MuleIconProps = {
  /** Explicit icon key from the MuleSoft media set. */
  name?: MuleIconKey;
  /** Graph node kind (trigger, generator, …). */
  kind?: GraphNodeKind | string;
  /** Exchange asset kind (agent, mcp, llm). */
  assetKind?: AssetKind;
  /** Builder sidebar panel tab. */
  tab?: BuilderPanelTab;
  /** Exchange metadata connection kind (agent, a2a, mcp, llm, broker). */
  connectionKind?: string;
  size?: number;
  className?: string;
  /** Pick light or dark SVG variants where available (exchange, graph, a2a, …). */
  tone?: "light" | "dark";
};

const PANEL_TAB_ICON_KEY: Partial<Record<BuilderPanelTab, MuleIconKey>> = {
  assets: "exchange",
  graph: "graph",
  access: "a2a",
  "a2a-card": "a2a",
  behavior: "genai",
};

function resolveSrc(props: MuleIconProps): string | undefined {
  const tone = props.tone ?? "light";
  if (props.name) return muleIconPathWithTone(props.name, tone);
  if (props.assetKind) return muleIconForAssetKind(props.assetKind);
  if (props.tab) {
    const key = PANEL_TAB_ICON_KEY[props.tab];
    if (key) return muleIconPathWithTone(key, tone);
    return muleIconForPanelTab(props.tab);
  }
  if (props.connectionKind) return muleIconForConnectionKind(props.connectionKind);
  if (props.kind) return muleIconForGraphNodeKind(props.kind);
  return undefined;
}

export function MuleIcon({ size = 16, className, tone = "light", ...props }: MuleIconProps) {
  const src = resolveSrc({ ...props, tone });
  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className ?? ""}`}
      draggable={false}
    />
  );
}
