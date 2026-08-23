import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BetaBadge from "@/components/ui/BetaBadge";
import { HELP_PAGES, getHelpPage, helpHref, type HelpPageId } from "@/lib/help/help-map";
import OnThisPage from "@/components/help/OnThisPage";

/**
 * Per-page shell: title + blurb, the prose column, and the "On this page" rail.
 * Every content page renders its body inside one of these so headings, TOC, and
 * prev/next flow stay consistent. Pass the same pageId used in the help map.
 */
export default function HelpFrame({
  pageId,
  beta,
  children,
}: {
  pageId: HelpPageId;
  /** Show a Beta badge next to the title (Tracer / Builder / Build & Publish). */
  beta?: boolean;
  children: ReactNode;
}) {
  const page = getHelpPage(pageId);

  // Prev/next follow sidebar order so a reader can walk the whole centre.
  const index = HELP_PAGES.findIndex((p) => p.id === pageId);
  const prev = index > 0 ? HELP_PAGES[index - 1] : null;
  const next = index < HELP_PAGES.length - 1 ? HELP_PAGES[index + 1] : null;

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1 pb-16">
        <header className="mb-8">
          <h1 className="flex flex-wrap items-center gap-2 text-3xl font-bold tracking-tight text-gray-900">
            {page.title}
            {beta ? <BetaBadge /> : null}
          </h1>
          <p className="mt-2 text-base text-gray-500">{page.blurb}</p>
        </header>

        {children}

        <nav className="mt-16 flex items-stretch justify-between gap-4 border-t border-gray-100 pt-6" aria-label="More help pages">
          {prev ? (
            <Link
              href={helpHref(prev.id)}
              className="group flex flex-1 flex-col items-start rounded-anypoint border border-gray-200 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
              </span>
              <span className="mt-1 font-medium text-gray-800 group-hover:text-primary">{prev.title}</span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {next ? (
            <Link
              href={helpHref(next.id)}
              className="group flex flex-1 flex-col items-end rounded-anypoint border border-gray-200 p-4 text-right transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="flex items-center gap-1 text-xs text-gray-400">
                Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="mt-1 font-medium text-gray-800 group-hover:text-primary">{next.title}</span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
      </article>

      {page.anchors.length > 0 ? (
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-auto py-1">
            <OnThisPage anchors={page.anchors} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
