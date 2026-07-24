"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { useComposer } from "@/lib/composer/store";
import { Button } from "@/components/composer/ui";
import BusinessGroupSelector from "@/components/BusinessGroupSelector";
import {
  useExchangeNetworkList,
  type ExchangeNetworkListItem,
} from "@/components/main-content/useExchangeNetworkList";
import { useExchangeNetworkImport } from "@/components/composer/useExchangeNetworkImport";
import { useLocalProjectImport } from "@/components/composer/useLocalProjectImport";
import type { LocalProjectImportResult } from "@/components/composer/useLocalProjectImport";

const SIDEBAR_EXPANDED_KEY = "agent-network-sidebar-expanded";

function getStoredExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    return v !== "false";
  } catch {
    return true;
  }
}

function networkKey(n: Pick<ExchangeNetworkListItem, "groupId" | "assetId">): string {
  return `${n.groupId}:${n.assetId}`;
}

export default function ComposerLanding({
  onEnter,
}: {
  onEnter: (importWarnings?: string[]) => void;
}) {
  const { dispatch } = useComposer();
  const [expanded, setExpanded] = useState(true);
  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState("");

  const { networks, loading, error, refresh } = useExchangeNetworkList(orgId);
  const { importNetwork, importing, error: importError } = useExchangeNetworkImport();
  const {
    importing: localImporting,
    error: localError,
    sourceLabel: localSourceLabel,
    folderInputRef,
    zipInputRef,
    importFromFolder,
    importFromZip,
    clearSelection: clearLocalSelection,
  } = useLocalProjectImport();

  const [localPending, setLocalPending] = useState<LocalProjectImportResult | null>(null);

  const [selectedKey, setSelectedKey] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");

  const selectedNetwork = useMemo(
    () => networks.find((n) => networkKey(n) === selectedKey),
    [networks, selectedKey]
  );

  useEffect(() => {
    setExpanded(getStoredExpanded());
  }, []);

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  function handleBusinessGroupSelect(value: string) {
    if (!value) {
      setOrgId("");
      setSelectedKey("");
      setSelectedVersion("");
      setLocalPending(null);
      clearLocalSelection();
      return;
    }
    setOrgId(value);
    setSelectedKey("");
    setSelectedVersion("");
    setLocalPending(null);
    clearLocalSelection();
  }

  function handleCreateNew() {
    if (!orgId) return;
    dispatch({ type: "resetProject", organizationId: orgId });
    const trimmed = name.trim();
    if (trimmed) dispatch({ type: "setIdentity", patch: { name: trimmed } });
    onEnter();
  }

  async function handleImport() {
    if (!selectedNetwork || !selectedVersion) return;
    const result = await importNetwork(
      { groupId: selectedNetwork.groupId, assetId: selectedNetwork.assetId, name: selectedNetwork.name },
      selectedVersion
    );
    if (!result) return;
    dispatch({ type: "loadProject", project: result.project });
    if (!result.project.identity.organizationId && orgId) {
      dispatch({ type: "setIdentity", patch: { organizationId: orgId } });
    }
    onEnter(result.warnings);
  }

  async function handleLocalFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setLocalPending(null);
    const result = await importFromFolder(files, orgId || undefined);
    if (result) setLocalPending(result);
  }

  async function handleLocalZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalPending(null);
    const result = await importFromZip(file, orgId || undefined);
    if (result) setLocalPending(result);
  }

  function handleOpenLocal() {
    if (!localPending) return;
    dispatch({ type: "loadProject", project: localPending.project });
    if (!localPending.project.identity.organizationId && orgId) {
      dispatch({ type: "setIdentity", patch: { organizationId: orgId } });
    }
    onEnter(localPending.warnings);
  }

  const noBusinessGroup = !orgId;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left sidebar — same shell as Tracer (LeftSidebar) */}
      <div
        className={`flex h-full min-h-0 shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] ${
          expanded ? "w-72" : "w-12"
        }`}
      >
        <div className="flex h-10 items-center justify-end border-b border-gray-100 px-2">
          <button
            type="button"
            onClick={handleToggle}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {expanded ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>

        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            !expanded ? "w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none" : ""
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <BusinessGroupSelector onSelect={handleBusinessGroupSelect} />
          </div>

          <div className="border-t border-gray-200 bg-white px-3 py-2">
            <p className="text-xs text-gray-600">
              Questions:{" "}
              <a
                href="mailto:jeffcock@mulesoftforge.com"
                className="text-primary hover:text-indigo-700 hover:underline"
              >
                Ask Me
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-gradient-to-br from-gray-50 via-white to-gray-50 px-6 py-10">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold text-gray-900">Agent Network Builder</h1>
            <p className="mt-1 text-sm text-gray-500">
              Start a new agent network, open one from Exchange, or load an existing project from your machine.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {/* New Agent Network */}
            <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <MuleIcon name="agentNetwork" size={22} />
              </div>
              <h2 className="text-sm font-semibold text-gray-900">New Agent Network</h2>
              <p className="mt-1 text-xs text-gray-500">
                Start from a blank network with one broker, ready to compose assets, LLMs, and a graph.
              </p>
              <div className="mt-4 flex-1">
                {noBusinessGroup ? (
                  <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    Select a business group in the sidebar to list its agent networks.
                  </p>
                ) : (
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Network name (optional)
                    </span>
                    <input
                      type="text"
                      value={name}
                      placeholder="My Agent Network"
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateNew();
                      }}
                      className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                )}
              </div>
              <Button
                variant="primary"
                className="mt-4 w-full"
                disabled={noBusinessGroup}
                onClick={handleCreateNew}
              >
                Create blank network <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Select Existing from Exchange */}
            <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-teal/10">
                <MuleIcon name="exchange" size={22} />
              </div>
              <h2 className="text-sm font-semibold text-gray-900">Select from Exchange</h2>
              <p className="mt-1 text-xs text-gray-500">
                Import a published agent network and edit it as a Builder project.
              </p>

              <div className="mt-4 flex-1 space-y-3">
                {noBusinessGroup ? (
                  <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    Select a business group in the sidebar to list its agent networks.
                  </p>
                ) : loading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agent networks…
                  </div>
                ) : error ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-600">{error}</p>
                    <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => void refresh()}>
                      Retry
                    </Button>
                  </div>
                ) : networks.length === 0 ? (
                  <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    No agent networks found in this organization.
                  </p>
                ) : (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Agent network
                      </span>
                      <select
                        value={selectedKey}
                        onChange={(e) => {
                          setSelectedKey(e.target.value);
                          setSelectedVersion("");
                        }}
                        className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">Select a network…</option>
                        {networks.map((n) => (
                          <option key={networkKey(n)} value={networkKey(n)}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Version
                      </span>
                      <select
                        value={selectedVersion}
                        onChange={(e) => setSelectedVersion(e.target.value)}
                        disabled={!selectedNetwork}
                        className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        <option value="">Select a version…</option>
                        {selectedNetwork?.versions.map((v) => (
                          <option key={v.version} value={v.version}>
                            {v.version}
                            {v.status ? ` (${v.status})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    {importError ? (
                      <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
                        {importError}
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              <Button
                variant="primary"
                className="mt-4 w-full"
                disabled={noBusinessGroup || !selectedNetwork || !selectedVersion || importing}
                onClick={() => void handleImport()}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                  </>
                ) : (
                  <>
                    Open in Builder <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            {/* Select local existing project */}
            <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                <MuleIcon name="implement" size={22} />
              </div>
              <h2 className="text-sm font-semibold text-gray-900">Select local project</h2>
              <p className="mt-1 text-xs text-gray-500">
                Open an agent network project folder or zip from your machine (exchange.json, agent-network.yaml,
                brokers/*.agent).
              </p>

              <div className="mt-4 flex-1 space-y-3">
                <input
                  ref={folderInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                  onChange={(e) => void handleLocalFolderChange(e)}
                />
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(e) => void handleLocalZipChange(e)}
                />

                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={localImporting}
                  onClick={() => folderInputRef.current?.click()}
                >
                  {localImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Reading project…
                    </>
                  ) : (
                    <>Choose project folder</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={localImporting}
                  onClick={() => zipInputRef.current?.click()}
                >
                  Choose project zip
                </Button>

                {localSourceLabel && localPending ? (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-800">
                    Ready: <span className="font-medium">{localSourceLabel}</span>
                    {localPending.project.identity.name ? (
                      <> · {localPending.project.identity.name}</>
                    ) : null}
                  </p>
                ) : null}

                {localError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
                    {localError}
                  </p>
                ) : null}

                {!orgId ? (
                  <p className="text-[11px] text-gray-400">
                    Select a business group in the sidebar to fill in missing org ids when opening.
                  </p>
                ) : null}
              </div>

              <Button
                variant="primary"
                className="mt-4 w-full"
                disabled={!localPending || localImporting}
                onClick={handleOpenLocal}
              >
                Open in Builder <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
