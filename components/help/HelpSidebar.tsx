"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  BookOpen,
  Radar,
  Boxes,
  Rocket,
  LifeBuoy,
  BookA,
  type LucideIcon,
} from "lucide-react";
import { HELP_PAGES, helpHref, type HelpPageId } from "@/lib/help/help-map";

const ICONS: Record<HelpPageId, LucideIcon> = {
  home: Compass,
  concepts: BookOpen,
  tracer: Radar,
  builder: Boxes,
  "build-publish": Rocket,
  troubleshooting: LifeBuoy,
  glossary: BookA,
};

/**
 * Left rail listing every help page. Highlights the current route. The hub
 * ("/help") is matched exactly; product pages match their own path.
 */
export default function HelpSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Help sections" className="space-y-0.5">
      {HELP_PAGES.map((page) => {
        const href = helpHref(page.id);
        const isActive = pathname === href;
        const Icon = ICONS[page.id];
        return (
          <Link
            key={page.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-anypoint px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-gradient-to-r from-primary/15 to-violet/15 text-primary"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-gray-400"}`} aria-hidden="true" />
            {page.title}
          </Link>
        );
      })}
    </nav>
  );
}
