"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Plus, X, Loader2 } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { importAsset } from "@/lib/composer/factory";
import { connectionNameForAsset } from "@/lib/composer/model";
import type { AssetKind } from "@/lib/composer/model";
import { Button, KindBadge } from "@/components/composer/ui";

interface SearchResult {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  kind: AssetKind;
  rawType?: string;
}

const KIND_FILTERS: Array<{ value: AssetKind; label: string }> = [
  { value: "agent", label: "Agents" },
  { value: "mcp", label: "MCP Servers" },
  { value: "llm", label: "LLMs" },
];

export default function AssetPicker({ onClose }: { onClose: () => void }) {
  const { project, dispatch } = useComposer();
  const orgId = project.identity.organizationId;
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<AssetKind[]>(["agent", "mcp", "llm"]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingKeys = new Set(project.assets.map((a) => `${a.groupId}:${a.assetId}`));

  const runSearch = useCallback(async () => {
    if (!orgId) {
      setError("No organization id set. Fill in project identity first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        q: query,
        kinds: kinds.join(","),
      });
      const res = await fetch(`/api/exchange/search?${params.toString()}`);
      if (!res.ok) {
        setError(res.status === 401 ? "Not signed in." : `Search failed (${res.status}).`);
        setResults([]);
        return;
      }
      const data = (await res.json()) as { results: SearchResult[] };
      setResults(data.results ?? []);
    } catch {
      setError("Search request failed.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, query, kinds]);

  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds]);

  function toggleKind(k: AssetKind) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  function handleImport(r: SearchResult) {
    const asset = importAsset({
      kind: r.kind,
      groupId: r.groupId,
      assetId: r.assetId,
      version: r.version ?? "1.0.0",
      name: r.name,
    });
    dispatch({ type: "addAsset", asset });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Compose from Exchange</h2>
            <p className="text-xs text-gray-500">Pick existing published assets — you compose, never create.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                placeholder="Search Exchange assets…"
                className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Button variant="primary" onClick={() => void runSearch()}>
              Search
            </Button>
          </div>
          <div className="mt-2 flex gap-1.5">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => toggleKind(f.value)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  kinds.includes(f.value)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-gray-300 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : error ? (
            <div className="px-4 py-10 text-center text-sm text-red-500">{error}</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">No assets found.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map((r) => {
                const already = existingKeys.has(`${r.groupId}:${r.assetId}`);
                return (
                  <li key={`${r.groupId}:${r.assetId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                    <KindBadge kind={r.kind} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                      <p className="truncate font-mono text-[11px] text-gray-400">
                        {r.assetId} · {r.version ?? "?"}
                      </p>
                    </div>
                    <Button variant={already ? "ghost" : "secondary"} disabled={already} onClick={() => handleImport(r)}>
                      {already ? "Added" : <><Plus className="h-3.5 w-3.5" /> Add</>}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5">
          <span className="text-xs text-gray-400">{project.assets.length} composed</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
