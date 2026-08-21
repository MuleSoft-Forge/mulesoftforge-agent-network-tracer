"use client";

import { muleIconForGraphNodeKind } from "@/lib/composer/mule-icons";
import { type MuleIconKey, muleIconPath } from "@/lib/composer/mule-icons";

type KindIconProps = {
  kind?: string;
  iconName?: MuleIconKey;
  size?: number;
  className?: string;
};

/** Graph canvas node kind icon (wraps {@link MuleIcon} resolution). */
export function KindIcon({ kind, iconName, size = 16, className }: KindIconProps) {
  const src = iconName ? muleIconPath(iconName) : muleIconForGraphNodeKind(kind);
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
