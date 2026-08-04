"use client";

import { muleIconForGraphNodeKind } from "@/lib/composer/mule-icons";

type KindIconProps = {
  kind?: string;
  size?: number;
  className?: string;
};

/** Graph canvas node kind icon (wraps {@link MuleIcon} resolution). */
export function KindIcon({ kind, size = 16, className }: KindIconProps) {
  const src = muleIconForGraphNodeKind(kind);
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
