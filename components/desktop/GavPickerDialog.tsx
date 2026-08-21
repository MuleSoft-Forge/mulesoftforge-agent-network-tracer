"use client";

/**
 * Picks a `groupId:assetId:version` from what is actually published in the
 * selected business group, instead of asking the operator to type coordinates
 * from memory.
 *
 * This matters most for the version: teardown is irreversible either way, and a
 * soft delete reserves the coordinates permanently, so a mistyped version is
 * not something you can retry your way out of.
 *
 * Both `unpublish` and `undeploy` take `--gav`, so one picker serves both — the
 * CLI resolves the deployed resources for a GAV remotely, given an environment.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import {
  useExchangeNetworkList,
  type ExchangeNetworkListItem,
} from "@/components/main-content/useExchangeNetworkList";

export interface GavSelection {
  gav: string;
  assetId: string;
}

interface GavPickerDialogProps {
  /** Business group to list from. */
  orgId: string;
  onSelect: (selection: GavSelection) => void;
  onClose: () => void;
}

function networkKey(network: ExchangeNetworkListItem): string {
  return `${network.groupId}:${network.assetId}`;
}

/** Exchange reports lifecycle state per version; it decides hard-delete eligibility. */
function statusBadgeClass(status: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "development":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "deprecated":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "published":
    case "stable":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

export default function GavPickerDialog({ orgId, onSelect, onClose }: GavPickerDialogProps) {
  const [term, setTerm] = useState("");
  const [submittedTerm, setSubmittedTerm] = useState<string | undefined>(undefined);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { networks, loading, error, refresh } = useExchangeNetworkList(orgId, submittedTerm);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    searchInputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Narrow what came back without another round trip; pressing Enter re-queries
  // Exchange instead, which is what finds assets the default term missed.
  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return networks;
    return networks.filter(
      (n) =>
        n.name.toLowerCase().includes(needle) ||
        n.assetId.toLowerCase().includes(needle)
    );
  }, [networks, term]);

  const runSearch = () => setSubmittedTerm(term.trim() || undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gav-picker-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="gav-picker-title" className="text-sm font-semibold text-gray-900">
              Choose a published agent network
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Listed from Exchange for the selected business group.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Filter, or press Enter to search Exchange…"
              aria-label="Filter agent networks"
              className="w-full rounded-xl border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error && <p className="text-xs text-amber-600">{error}</p>}

          {!error && loading && networks.length === 0 && (
            <p className="text-xs text-gray-500">Loading agent networks…</p>
          )}

          {!error && !loading && visible.length === 0 && (
            <p className="text-xs text-gray-500">
              No agent networks matched. Exchange search is keyword-based, so try the asset name and
              press Enter — or close this and enter coordinates manually.
            </p>
          )}

          <ul className="flex flex-col gap-1.5">
            {visible.map((network) => {
              const key = networkKey(network);
              const expanded = expandedKey === key;
              return (
                <li key={key} className="rounded-lg border border-gray-200">
                  <button
                    type="button"
                    onClick={() => setExpandedKey(expanded ? null : key)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-gray-900">{network.name}</span>
                      <span className="block truncate font-mono text-[11px] text-gray-500">
                        {network.groupId}:{network.assetId}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-500">
                      {network.versions.length}{" "}
                      {network.versions.length === 1 ? "version" : "versions"}
                    </span>
                  </button>

                  {expanded && (
                    <div className="flex flex-wrap gap-1.5 border-t border-gray-200 px-3 py-2">
                      {network.versions.map((v) => (
                        <button
                          key={v.version}
                          type="button"
                          onClick={() =>
                            onSelect({
                              gav: `${network.groupId}:${network.assetId}:${v.version}`,
                              assetId: network.assetId,
                            })
                          }
                          className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] transition-colors hover:border-primary/40 hover:bg-primary/5"
                        >
                          <span className="font-mono text-gray-900">{v.version}</span>
                          {v.status && (
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[10px] ${statusBadgeClass(v.status)}`}
                            >
                              {v.status}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
