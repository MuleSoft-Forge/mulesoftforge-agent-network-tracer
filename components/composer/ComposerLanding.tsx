"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Boxes, Loader2, Sparkles } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { Button } from "@/components/composer/ui";
import BusinessGroupSelector from "@/components/BusinessGroupSelector";
import {
  useExchangeNetworkList,
  type ExchangeNetworkListItem,
} from "@/components/main-content/useExchangeNetworkList";
import { useExchangeNetworkImport } from "@/components/composer/useExchangeNetworkImport";

function networkKey(n: Pick<ExchangeNetworkListItem, "groupId" | "assetId">): string {
  return `${n.groupId}:${n.assetId}`;
}

export default function ComposerLanding({
  onEnter,
}: {
  onEnter: (importWarnings?: string[]) => void;
}) {
  const { dispatch } = useComposer();
  const [name, setName] = useState("");

  // Selected Business Group (org id) drives both the new-network org and the
  // Exchange list scope.
  const [orgId, setOrgId] = useState("");

  const { networks, loading, error, refresh } = useExchangeNetworkList(orgId);
  const { importNetwork, importing, error: importError } = useExchangeNetworkImport();

  const [selectedKey, setSelectedKey] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");

  const selectedNetwork = useMemo(
    () => networks.find((n) => networkKey(n) === selectedKey),
    [networks, selectedKey]
  );

  function handleBusinessGroupSelect(value: string) {
    setOrgId(value);
    setSelectedKey("");
    setSelectedVersion("");
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

  const noBusinessGroup = !orgId;

  return (
    <div className="flex h-full flex-col items-center justify-center bg-gray-50 px-6 py-10">
      <div className="w-full max-w-3xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Agent Network Composer</h1>
          <p className="mt-1 text-sm text-gray-500">
            Choose a business group, then start a new agent network or open an existing one from Anypoint Exchange.
          </p>
        </div>

        <div className="mx-auto mb-6 max-w-md">
          <BusinessGroupSelector onSelect={handleBusinessGroupSelect} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* New Agent Network */}
          <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-gray-900">New Agent Network</h2>
            <p className="mt-1 text-xs text-gray-500">
              Start from a blank network with one broker, ready to compose assets, LLMs, and a graph.
            </p>
            <div className="mt-4 flex-1">
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
            </div>
            <Button
              variant="primary"
              className="mt-4 w-full"
              disabled={noBusinessGroup}
              onClick={handleCreateNew}
            >
              Create blank network <ArrowRight className="h-4 w-4" />
            </Button>
            {noBusinessGroup ? (
              <p className="mt-2 text-center text-[11px] text-gray-400">Select a business group first.</p>
            ) : null}
          </div>

          {/* Select Existing from Exchange */}
          <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-teal/10 text-teal-700">
              <Boxes className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-gray-900">Select existing from Exchange</h2>
            <p className="mt-1 text-xs text-gray-500">
              Import a published agent network and edit it as a Composer project.
            </p>

            <div className="mt-4 flex-1 space-y-3">
              {noBusinessGroup ? (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  Select a business group to list its agent networks.
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
                  Open in Composer <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
