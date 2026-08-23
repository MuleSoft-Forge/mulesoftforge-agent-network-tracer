"use client";

import { useEffect, useState } from "react";
import type { HelpAnchor } from "@/lib/help/help-map";

/**
 * Right-hand "On this page" rail with scroll-spy. Observes each anchored
 * section and highlights whichever is nearest the top of the viewport. Clicking
 * a link jumps to the section (native hash scroll; sections carry scroll-mt).
 */
export default function OnThisPage({ anchors }: { anchors: HelpAnchor[] }) {
  const [activeId, setActiveId] = useState<string | null>(anchors[0]?.id ?? null);

  useEffect(() => {
    if (anchors.length === 0) return;
    const els = anchors
      .map((a) => document.getElementById(a.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Prefer the topmost section currently intersecting the trigger band.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      // Trigger band sits just below the sticky header; -70% bottom margin means
      // a heading becomes "active" once it crosses into the top third.
      { rootMargin: "-88px 0px -70% 0px", threshold: 0 }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [anchors]);

  if (anchors.length === 0) return null;

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">On this page</p>
      <ul className="space-y-1 border-l border-gray-200">
        {anchors.map((a) => {
          const isActive = a.id === activeId;
          return (
            <li key={a.id}>
              <a
                href={`#${a.id}`}
                onClick={() => setActiveId(a.id)}
                className={`-ml-px block border-l-2 py-1 pl-3 transition-colors ${
                  isActive
                    ? "border-primary font-medium text-primary"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
                }`}
              >
                {a.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
