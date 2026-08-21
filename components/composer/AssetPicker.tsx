"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Plus, X, Loader2 } from "lucide-react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { useComposer } from "@/lib/composer/store";
import { importAsset } from "@/lib/composer/factory";
import { exchangeDependencyAssets } from "@/lib/composer/model";
import { connectionNameForAsset } from "@/lib/composer/model";
import type { AssetKind } from "@/lib/composer/model";
import { fetchMcpMetadataFromApi } from "@/components/composer/useMcpTools";
import type { ExchangePolicyOption } from "@/components/composer/useExchangePolicies";
import { Button, KindBadge } from "@/components/composer/ui";

interface AssetSearchResult {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  kind: AssetKind;
  rawType?: string;
  source: "business-group" | "mulesoft-supplied";
  governed: boolean;
}

interface PolicySearchResult {
  groupId: string;
  assetId: string;
  name: string;
  version: string;
  provider: "mulesoft" | "organization";
  injectionPoint: "inbound" | "outbound";
  source: "business-group" | "mulesoft-supplied";
}

type SearchResult = AssetSearchResult | PolicySearchResult;
type KindFilterValue = AssetKind | "policy";

const KIND_FILTERS: Array<{ value: KindFilterValue; label: string }> = [
  { value: "agent", label: "Agents" },
  { value: "mcp", label: "MCP Servers" },
  { value: "llm", label: "LLMs" },
  { value: "policy", label: "Policies" },
];

export default function AssetPicker({ onClose }: { onClose: () => void }) {
  const { project, dispatch } = useComposer();
  const orgId = project.identity.organizationId;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilterValue>("llm");
  const [includeBusinessGroup, setIncludeBusinessGroup] = useState(true);
  const [includeMulesoftSupplied, setIncludeMulesoftSupplied] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const existingAssetKeys = new Set(project.assets.map((a) => `${a.groupId}:${a.assetId}`));
  const existingPolicyKeys = new Set(
    (project.unmatchedDependencies ?? [])
      .filter((dep) => dep.classifier === "schema")
      .map((dep) => `${dep.groupId}:${dep.assetId}:${dep.version}`)
  );

  function resultKey(r: SearchResult): string {
    return `${r.groupId}:${r.assetId}`;
  }

  function isPolicyResult(r: SearchResult): r is PolicySearchResult {
    return "injectionPoint" in r;
  }

  // Toggling filters while a search is in flight must not let the older result
  // set land after the newer one.
  const requestIdRef = useRef(0);

  const runSearch = useCallback(async () => {
    if (!orgId) {
      setError("No organization id set. Fill in project identity first.");
      return;
    }
    const requestId = ++requestIdRef.current;
    const isStale = () => requestIdRef.current !== requestId;

    setLoading(true);
    setError(null);
    try {
      if (kind === "policy") {
        const params = new URLSearchParams({ organizationId: orgId });
        const res = await fetch(`/api/exchange/policies?${params.toString()}`);
        if (isStale()) return;
        if (!res.ok) {
          setError(res.status === 401 ? "Not signed in." : `Policy search failed (${res.status}).`);
          setResults([]);
          return;
        }
        const data = (await res.json()) as { inbound: ExchangePolicyOption[]; outbound: ExchangePolicyOption[] };
        if (isStale()) return;
        const sourceFiltered = [...(data.inbound ?? []), ...(data.outbound ?? [])].filter((p) => {
          const isOrg = p.provider === "organization";
          return (isOrg && includeBusinessGroup) || (!isOrg && includeMulesoftSupplied);
        });
        const q = query.trim().toLowerCase();
        const queryFiltered = q
          ? sourceFiltered.filter((p) =>
              [p.name, p.assetId, p.groupId, p.version ?? "", p.description ?? ""].some((v) =>
                v.toLowerCase().includes(q)
              )
            )
          : sourceFiltered;
        const byKey = new Map<string, PolicySearchResult>();
        for (const p of queryFiltered) {
          if (!p.version) continue;
          const key = `${p.groupId}:${p.assetId}:${p.version}`;
          if (byKey.has(key)) continue;
          byKey.set(key, {
            groupId: p.groupId,
            assetId: p.assetId,
            name: p.name,
            version: p.version,
            provider: p.provider,
            injectionPoint: p.injectionPoint,
            source: p.provider === "organization" ? "business-group" : "mulesoft-supplied",
          });
        }
        setResults(Array.from(byKey.values()));
      } else {
        const params = new URLSearchParams({
          organizationId: orgId,
          q: query,
          kinds: kind,
          includeBusinessGroup: String(includeBusinessGroup),
          includeMulesoftSupplied: String(includeMulesoftSupplied),
        });
        const res = await fetch(`/api/exchange/search?${params.toString()}`);
        if (isStale()) return;
        if (!res.ok) {
          setError(res.status === 401 ? "Not signed in." : `Search failed (${res.status}).`);
          setResults([]);
          return;
        }
        const data = (await res.json()) as { results: AssetSearchResult[] };
        if (isStale()) return;
        setResults(data.results ?? []);
      }
    } catch {
      if (isStale()) return;
      setError("Search request failed.");
      setResults([]);
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [orgId, query, kind, includeBusinessGroup, includeMulesoftSupplied]);

  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;

  // Re-run on filter change only — searching on every keystroke of `query`
  // would hammer Exchange, so text is submitted via Enter or the button.
  useEffect(() => {
    void runSearchRef.current();
  }, [kind, includeBusinessGroup, includeMulesoftSupplied]);

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

  async function handleImport(r: AssetSearchResult) {
    const key = resultKey(r);
    if (existingAssetKeys.has(key) || importingKey !== null) return;

    setImportingKey(key);
    try {
      let meta: unknown;
      if (r.kind === "mcp" && orgId) {
        try {
          const assetStub = {
            id: "pending",
            kind: "mcp" as const,
            groupId: r.groupId,
            assetId: r.assetId,
            version: r.version ?? "1.0.0",
            name: r.name,
            baseName: r.name,
          };
          meta = await fetchMcpMetadataFromApi(orgId, assetStub);
        } catch {
          meta = undefined;
        }
      }
      const asset = importAsset({
        kind: r.kind,
        groupId: r.groupId,
        assetId: r.assetId,
        version: r.version ?? "1.0.0",
        name: r.name,
        ...(meta ? { meta } : {}),
      });
      dispatch({ type: "addAsset", asset });
    } finally {
      setImportingKey(null);
    }
  }

  function handleAddPolicy(r: PolicySearchResult) {
    dispatch({
      type: "upsertUnmatchedDependency",
      dependency: {
        groupId: r.groupId,
        assetId: r.assetId,
        version: r.version,
        classifier: "schema",
        packaging: "zip",
      },
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-picker-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <MuleIcon name="exchange" size={20} />
            <div>
              <h2 id="asset-picker-title" className="text-sm font-semibold text-gray-900">Compose from Exchange</h2>
              <p className="text-xs text-gray-500">Pick existing published assets — you compose, never create.</p>
            </div>
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
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                placeholder="Search Exchange assets…"
                aria-label="Search Exchange assets"
                className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Button variant="primary" onClick={() => void runSearch()} disabled={loading}>
              Search
            </Button>
          </div>
          <div className="mt-2 flex gap-1.5">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setKind(f.value)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  kind === f.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-gray-300 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {f.value === "policy" ? <MuleIcon name="exchange" size={12} /> : <MuleIcon assetKind={f.value} size={12} />}
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-600">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeBusinessGroup}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (!next && !includeMulesoftSupplied) {
                    // Keep at least one scope selected to avoid blank searches.
                    return;
                  }
                  setIncludeBusinessGroup(next);
                }}
              />
              Business Group
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeMulesoftSupplied}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (!next && !includeBusinessGroup) {
                    // Keep at least one scope selected to avoid blank searches.
                    return;
                  }
                  setIncludeMulesoftSupplied(next);
                }}
              />
              MuleSoft Supplied
            </label>
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
              {results.map((r, i) => {
                const key = resultKey(r);
                const already = isPolicyResult(r)
                  ? existingPolicyKeys.has(`${r.groupId}:${r.assetId}:${r.version}`)
                  : existingAssetKeys.has(key);
                const isImporting = importingKey === key;
                return (
                  <li key={`${r.groupId}:${r.assetId}:${isPolicyResult(r) ? "policy" : r.kind}:${i}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                    {isPolicyResult(r) ? (
                      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        policy
                      </span>
                    ) : (
                      <KindBadge kind={r.kind} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                        {r.source === "mulesoft-supplied" ? (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              !isPolicyResult(r) && r.governed
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-gray-100 text-gray-500"
                            }`}
                            title={
                              !isPolicyResult(r) && r.governed
                                ? "Governed — an instance of this MuleSoft-supplied asset exists in your org."
                                : isPolicyResult(r)
                                  ? "MuleSoft-supplied policy template."
                                  : "Not governed in your org — no instance found."
                            }
                          >
                            {!isPolicyResult(r) && r.governed ? "Governed" : "MuleSoft"}
                          </span>
                        ) : null}
                        {isPolicyResult(r) ? (
                          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                            {r.injectionPoint}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate font-mono text-[11px] text-gray-400">
                        {r.assetId} · {isPolicyResult(r) ? r.version : r.version ?? "?"}
                      </p>
                    </div>
                    <Button
                      variant={already ? "ghost" : "secondary"}
                      disabled={already || (!isPolicyResult(r) && importingKey !== null)}
                      onClick={() => {
                        if (isPolicyResult(r)) {
                          handleAddPolicy(r);
                        } else {
                          void handleImport(r);
                        }
                      }}
                    >
                      {already ? (
                        "Added"
                      ) : !isPolicyResult(r) && isImporting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…
                        </>
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" /> Add
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5">
          <span className="text-xs text-gray-400">{exchangeDependencyAssets(project).length} Exchange dependencies</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
