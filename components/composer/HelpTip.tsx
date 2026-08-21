"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ExternalLink, HelpCircle, X } from "lucide-react";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";
import { useHelpMode } from "@/lib/composer/help/help-mode";

const POPOVER_WIDTH = 320;
const POPOVER_WIDTH_WITH_IMAGE = 400;
const VIEWPORT_PAD = 12;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{children}</p>
  );
}

interface PopoverPosition {
  top: number;
  left: number;
  maxHeight: number;
}

function computePopoverPosition(anchor: DOMRect, popoverWidth: number): PopoverPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor.left;
  if (left + popoverWidth > vw - VIEWPORT_PAD) {
    left = vw - popoverWidth - VIEWPORT_PAD;
  }
  left = Math.max(VIEWPORT_PAD, left);

  const spaceBelow = vh - anchor.bottom - VIEWPORT_PAD;
  const spaceAbove = anchor.top - VIEWPORT_PAD;
  const preferBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;

  let top: number;
  let maxHeight: number;
  if (preferBelow) {
    top = anchor.bottom + 6;
    maxHeight = Math.min(vh * 0.7, spaceBelow - 6);
  } else {
    maxHeight = Math.min(vh * 0.7, spaceAbove - 6);
    top = anchor.top - 6 - maxHeight;
    top = Math.max(VIEWPORT_PAD, top);
    maxHeight = Math.min(maxHeight, anchor.top - 6 - top);
  }

  return { top, left, maxHeight: Math.max(120, maxHeight) };
}

function HelpPopover({
  entry,
  position,
  popoverWidth,
  menuRef,
  onClose,
}: {
  entry: HelpEntry;
  position: PopoverPosition;
  popoverWidth: number;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label={`${entry.title} help`}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: popoverWidth,
        maxHeight: position.maxHeight,
      }}
      className="z-[200] overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl"
    >
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">{entry.title}</p>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={entry.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Full reference
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close help"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-primary">{entry.tagline}</p>
      </div>

      <div className="space-y-3 px-3 py-2.5">
        <section>
          <SectionLabel>What it does</SectionLabel>
          <p className="text-xs leading-relaxed text-gray-600">{entry.whatItDoes}</p>
        </section>

        {entry.image ? (
          <section>
            <SectionLabel>On Exchange</SectionLabel>
            {/* eslint-disable-next-line @next/next/no-img-element -- help screenshot from /public */}
            <img
              src={entry.image.src}
              alt={entry.image.alt}
              className="w-full rounded-md border border-gray-200"
            />
            {entry.image.caption ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">{entry.image.caption}</p>
            ) : null}
          </section>
        ) : null}

        <section>
          <SectionLabel>When to use</SectionLabel>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-gray-600">
            {entry.whenToUse.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        {entry.whenNotToUse && entry.whenNotToUse.length > 0 ? (
          <section>
            <SectionLabel>Instead, consider</SectionLabel>
            <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-gray-600">
              {entry.whenNotToUse.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {entry.example ? (
          <section>
            <SectionLabel>{entry.example.caption}</SectionLabel>
            <pre className="overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] leading-relaxed text-gray-800">
              <code>{entry.example.code}</code>
            </pre>
          </section>
        ) : null}

        {entry.gotchas && entry.gotchas.length > 0 ? (
          <section className="rounded-md bg-amber-50 px-2 py-1.5">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" aria-hidden />
              <ul className="space-y-0.5 text-[11px] leading-relaxed text-amber-800">
                {entry.gotchas.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default function HelpTip({
  entry,
  label,
  align: _align,
  stopPropagation = false,
}: {
  entry: HelpEntry;
  label?: string;
  align?: "left" | "right";
  stopPropagation?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { helpMode } = useHelpMode();

  const popoverWidth = entry.image ? POPOVER_WIDTH_WITH_IMAGE : POPOVER_WIDTH;

  const updatePosition = useCallback(() => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setPosition(computePopoverPosition(anchor, popoverWidth));
  }, [popoverWidth]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label ?? `About the ${entry.title}`}
        aria-expanded={open}
        title={entry.tagline}
        className={`inline-flex rounded p-0.5 transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${
          helpMode
            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
            : "text-primary hover:bg-primary/10"
        }`}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && mounted && position
        ? createPortal(
            <HelpPopover
              entry={entry}
              position={position}
              popoverWidth={popoverWidth}
              menuRef={menuRef}
              onClose={() => setOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  );
}
