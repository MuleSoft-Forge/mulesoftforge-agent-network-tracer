import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Info,
  Lightbulb,
  TriangleAlert,
  OctagonAlert,
  Camera,
  Link2,
} from "lucide-react";
import { helpHref, type HelpPageId } from "@/lib/help/help-map";

/* ------------------------------------------------------------------ headings */

/**
 * Anchored section heading. The `id` is the deep-link target; `scroll-mt`
 * keeps it clear of the sticky app header, and a hover "#" copies the anchor.
 */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="group scroll-mt-24 mt-12 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2 text-xl font-semibold text-gray-900"
    >
      <span>{children}</span>
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="opacity-0 transition-opacity group-hover:opacity-100 text-gray-300 hover:text-primary"
      >
        <Link2 className="h-4 w-4" aria-hidden="true" />
      </a>
    </h2>
  );
}

export function H3({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3
      id={id}
      className="group scroll-mt-24 mt-8 mb-3 flex items-center gap-2 text-base font-semibold text-gray-900"
    >
      <span>{children}</span>
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="opacity-0 transition-opacity group-hover:opacity-100 text-gray-300 hover:text-primary"
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </h3>
  );
}

/* --------------------------------------------------------------------- prose */

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mb-6 text-lg leading-relaxed text-gray-600">{children}</p>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mb-4 leading-relaxed text-gray-700">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mb-4 ml-5 list-disc space-y-1.5 text-gray-700 marker:text-gray-300">{children}</ul>;
}

export function LI({ children }: { children: ReactNode }) {
  return <li className="leading-relaxed">{children}</li>;
}

/** Inline monospace token for UI labels, filenames, code refs. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800 ring-1 ring-inset ring-gray-200">
      {children}
    </code>
  );
}

/** A keyboard key. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-gray-300 border-b-2 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700 shadow-sm">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ callouts */

type Tone = "info" | "tip" | "warn" | "danger";

const TONE: Record<Tone, { icon: typeof Info; ring: string; bg: string; text: string; iconColor: string }> = {
  info: { icon: Info, ring: "ring-navy/20", bg: "bg-navy/5", text: "text-gray-700", iconColor: "text-navy" },
  tip: { icon: Lightbulb, ring: "ring-teal/30", bg: "bg-teal/5", text: "text-gray-700", iconColor: "text-teal" },
  warn: { icon: TriangleAlert, ring: "ring-amber-300/60", bg: "bg-amber-50", text: "text-amber-900", iconColor: "text-amber-500" },
  danger: { icon: OctagonAlert, ring: "ring-red-300/60", bg: "bg-red-50", text: "text-red-900", iconColor: "text-red-500" },
};

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div className={`my-5 rounded-anypoint ${t.bg} p-4 ring-1 ring-inset ${t.ring}`}>
      <div className="flex gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.iconColor}`} aria-hidden="true" />
        <div className={`min-w-0 text-sm leading-relaxed ${t.text}`}>
          {title ? <p className="mb-1 font-semibold">{title}</p> : null}
          <div className="space-y-2 [&_code]:bg-white/60">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- steps list */

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="my-5 space-y-4">{children}</ol>;
}

export function Step({ n, title, children }: { n: number; title?: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-sm font-semibold text-white shadow-sm">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {title ? <p className="font-semibold text-gray-900">{title}</p> : null}
        <div className="text-gray-700 [&>p]:mb-2">{children}</div>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- screenshots */

/**
 * A documentation figure. When `src` points at an image under
 * /public/images/help it renders that; otherwise it renders a labeled
 * placeholder that doubles as a capture spec — the route + UI state to shoot,
 * and the filename to drop in. Ratio defaults to a wide UI capture.
 */
export function Shot({
  src,
  alt,
  caption,
  route,
  state,
  ratio = "16/10",
}: {
  src?: string;
  alt: string;
  caption?: string;
  /** App route the screenshot is taken on, e.g. "/builder". */
  route?: string;
  /** UI state to set up before capturing. */
  state?: string;
  ratio?: string;
}) {
  return (
    <figure className="my-6">
      {src ? (
        <div
          className="relative w-full overflow-hidden rounded-anypoint border border-gray-200 bg-gray-50 shadow-sm"
          style={{ aspectRatio: ratio.replace("/", " / ") }}
        >
          <Image src={src} alt={alt} fill sizes="(max-width: 900px) 100vw, 820px" className="object-contain" />
        </div>
      ) : (
        <div
          className="flex w-full flex-col items-center justify-center gap-2 rounded-anypoint border-2 border-dashed border-gray-300 bg-gray-50/70 p-6 text-center"
          style={{ aspectRatio: ratio.replace("/", " / ") }}
        >
          <Camera className="h-7 w-7 text-gray-400" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-600">{alt}</p>
          {(route || state) && (
            <p className="max-w-md text-xs text-gray-400">
              {route ? <span className="font-mono">{route}</span> : null}
              {route && state ? " · " : null}
              {state}
            </p>
          )}
          <span className="mt-1 rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            screenshot to add
          </span>
        </div>
      )}
      {caption ? (
        <figcaption className="mt-2 text-center text-xs text-gray-500">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------- linking */

/** In-prose link to another help page + anchor, always via helpHref. */
export function XLink({ to, anchor, children }: { to: HelpPageId; anchor?: string; children: ReactNode }) {
  return (
    <Link href={helpHref(to, anchor)} className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
      {children}
    </Link>
  );
}

/** External link with the right rel/target. */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
      {children}
    </a>
  );
}

/* ----------------------------------------------------------------- key/value */

/** A definition row used in glossary and "concept" lists. */
export function DefRow({ term, id, children }: { term: string; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={id ? "scroll-mt-24 border-b border-gray-100 py-3" : "border-b border-gray-100 py-3"}>
      <dt className="font-semibold text-gray-900">{term}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-gray-600">{children}</dd>
    </div>
  );
}

export function DefList({ children }: { children: ReactNode }) {
  return <dl className="my-4">{children}</dl>;
}
