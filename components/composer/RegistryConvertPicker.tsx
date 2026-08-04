"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { useComposer } from "@/lib/composer/store";
import { fetchMcpMetadataFromApi } from "@/components/composer/useMcpTools";
import type { RegistryEntityKind } from "@/lib/composer/registry/convert-to-dependencies";
import { registryKindToAssetKind } from "@/lib/composer/registry/convert-to-dependencies";
import { Button, KindBadge } from "@/components/composer/ui";

interface SearchResult {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  kind: "agent" | "mcp" | "llm";
}

export default function RegistryConvertPicker({
  registryKind,
  entityKey,
  onClose,
}: {
  registryKind: RegistryEntityKind;
  entityKey: string;
  onClose: () => void;
}) {
  const { project, dispatch } = useComposer();
  const orgId = project.identity.organizationId;
  const assetKind = registryKindToAssetKind(registryKind);
  const [query, setQuery] = useState(entityKey.replace(/_/g, " "));
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [convertingKey, setConvertingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(async () => {
    if (!orgId) {
      setError("Set organization id in Project identity before searching Exchange.");
      return;
    }
    const requestId = ++requestIdRef.current;
    const isStale = () => requestIdRef.current !== requestId;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        q: query,
        kinds: assetKind,
      });
      const res = await fetch(`/api/exchange/search?${params.toString()}`);
      if (isStale()) return;
      if (!res.ok) {
        setError(res.status === 401 ? "Not signed in." : `Search failed (${res.status}).`);
        setResults([]);
        return;
      }
      const data = (await res.json()) as { results: SearchResult[] };
      if (isStale()) return;
      setResults((data.results ?? []).filter((r) => r.kind === assetKind));
    } catch {
      if (isStale()) return;
      setError("Search request failed.");
      setResults([]);
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [orgId, query, assetKind]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

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

  async function handleSelect(result: SearchResult) {
    const key = `${result.groupId}:${result.assetId}`;
    if (convertingKey) return;

    setConvertingKey(key);
    setError(null);
    try {
      let meta: unknown;
      if (result.kind === "mcp" && orgId) {
        try {
          meta = await fetchMcpMetadataFromApi(orgId, {
            id: "pending",
            kind: "mcp",
            groupId: result.groupId,
            assetId: result.assetId,
            version: result.version ?? "1.0.0",
            name: result.name,
            baseName: result.name,
          });
        } catch {
          meta = undefined;
        }
      }

      dispatch({
        type: "convertRegistryEntityToDependency",
        registryKind,
        entityKey,
        groupId: result.groupId,
        assetId: result.assetId,
        version: result.version ?? "1.0.0",
        name: result.name,
        ...(meta !== undefined ? { meta } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed.");
    } finally {
      setConvertingKey(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registry-convert-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <MuleIcon name="exchange" size={20} />
            <div>
              <h2 id="registry-convert-title" className="text-sm font-semibold text-gray-900">
                Link Exchange dependency
              </h2>
              <p className="text-xs text-gray-500">
                Replace registry-local <span className="font-mono">{entityKey}</span> with a published asset.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                placeholder="Search Exchange assets…"
                aria-label="Search Exchange assets"
                className="w-full rounded-md border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void runSearch()} disabled={loading}>
              Search
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? <p className="mb-3 text-xs text-red-700">{error}</p> : null}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching Exchange…
            </div>
          ) : results.length === 0 ? (
            <p className="text-sm text-gray-400">No matching {assetKind} assets found.</p>
          ) : (
            <ul className="space-y-2">
              {results.map((result) => {
                const key = `${result.groupId}:${result.assetId}`;
                const converting = convertingKey === key;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={convertingKey !== null}
                      onClick={() => void handleSelect(result)}
                      className="flex w-full items-center gap-3 rounded-md border border-gray-200 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                    >
                      <KindBadge kind={result.kind} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{result.name}</p>
                        <p className="truncate font-mono text-[11px] text-gray-500">
                          {result.groupId}:{result.assetId}:{result.version ?? "?"}
                        </p>
                      </div>
                      {converting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-200 px-4 py-2.5 text-[11px] text-gray-500">
          The yaml connection keeps its name; <span className="font-mono">ref.name</span> updates to the Exchange asset id
          if it differs from the registry key.
        </div>
      </div>
    </div>
  );
}
