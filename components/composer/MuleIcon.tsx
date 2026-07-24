"use client";

import type { AssetKind, GraphNodeKind } from "@/lib/composer/model";
import type { BuilderPanelTab } from "@/lib/composer/mule-icons";
import {
  type MuleIconKey,
  muleIconForAssetKind,
  muleIconForConnectionKind,
  muleIconForGraphNodeKind,
  muleIconForPanelTab,
  muleIconPath,
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
};

function resolveSrc(props: MuleIconProps): string | undefined {
  if (props.name) return muleIconPath(props.name);
  if (props.assetKind) return muleIconForAssetKind(props.assetKind);
  if (props.tab) return muleIconForPanelTab(props.tab);
  if (props.connectionKind) return muleIconForConnectionKind(props.connectionKind);
  if (props.kind) return muleIconForGraphNodeKind(props.kind);
  return undefined;
}

export function MuleIcon({ size = 16, className, ...props }: MuleIconProps) {
  const src = resolveSrc(props);
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
