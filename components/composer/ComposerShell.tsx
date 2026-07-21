"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, AlertTriangle, Network, GitBranch, PanelBottomClose, PanelBottomOpen } from "lucide-react";
import { ComposerProvider, useComposer } from "@/lib/composer/store";
import { validateProject } from "@/lib/composer/validate";
import { Button } from "@/components/composer/ui";
import AssetPicker from "@/components/composer/AssetPicker";
import BrokerGraphEditor from "@/components/composer/BrokerGraphEditor";
import TopologyView from "@/components/composer/TopologyView";
import NodeInspector from "@/components/composer/NodeInspector";
import ProjectPanels from "@/components/composer/ProjectPanels";
import FilePreview from "@/components/composer/FilePreview";

type CenterTab = "graph" | "topology";

function ValidationStrip() {
  const { project } = useComposer();
  const result = useMemo(() => validateProject(project), [project]);
  if (result.errors.length === 0 && result.warnings.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" /> Valid
      </div>
    );
  }
  const first = result.errors[0] ?? result.warnings[0];
  return (
    <div className="flex items-center gap-1.5 text-xs" title={first?.message}>
      <AlertTriangle className={`h-3.5 w-3.5 ${result.errors.length ? "text-red-500" : "text-amber-500"}`} />
      <span className="text-gray-600">
        {result.errors.length} error{result.errors.length === 1 ? "" : "s"}, {result.warnings.length} warning
        {result.warnings.length === 1 ? "" : "s"}
      </span>
      {first && <span className="max-w-[280px] truncate text-gray-400">· {first.message}</span>}
    </div>
  );
}

function Inner() {
  const { project, dispatch } = useComposer();
  const [tab, setTab] = useState<CenterTab>("graph");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);

  // Pull org id from the signed-in profile once.
  useEffect(() => {
    if (project.identity.organizationId) return;
    let cancelled = false;
    fetch("/api/auth/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { organization?: { id?: string } } | null) => {
        if (!cancelled && p?.organization?.id) {
          dispatch({ type: "setIdentity", patch: { organizationId: p.organization.id } });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900">Agent Network Composer</h1>
          <span className="text-gray-300">/</span>
          <span className="max-w-[220px] truncate text-sm text-gray-600">{project.identity.name}</span>
        </div>
        <ValidationStrip />
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-gray-300 p-0.5">
            <button
              onClick={() => setTab("graph")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${tab === "graph" ? "bg-primary/10 text-primary" : "text-gray-500"}`}
            >
              <GitBranch className="h-3.5 w-3.5" /> Broker graph
            </button>
            <button
              onClick={() => setTab("topology")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${tab === "topology" ? "bg-primary/10 text-primary" : "text-gray-500"}`}
            >
              <Network className="h-3.5 w-3.5" /> Topology
            </button>
          </div>
          <Button variant="ghost" onClick={() => setPreviewOpen((v) => !v)} title="Toggle file preview">
            {previewOpen ? <PanelBottomClose className="h-4 w-4" /> : <PanelBottomOpen className="h-4 w-4" />}
          </Button>
          <Button variant="primary" onClick={() => setPickerOpen(true)}>
            <Boxes className="h-4 w-4" /> Compose from Exchange
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-gray-200 bg-white">
          {tab === "graph" ? (
            <BrokerGraphEditor selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
          ) : (
            <TopologyView />
          )}
        </div>
        <div className="w-[380px] shrink-0 overflow-hidden bg-white">
          {selectedNodeId ? (
            <NodeInspector nodeId={selectedNodeId} onDeleted={() => setSelectedNodeId(null)} />
          ) : (
            <ProjectPanels />
          )}
        </div>
      </div>

      {previewOpen && (
        <div className="h-[35vh] shrink-0 border-t border-gray-200 bg-white">
          <FilePreview />
        </div>
      )}

      {pickerOpen && <AssetPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
}

export default function ComposerShell() {
  return (
    <ComposerProvider>
      <Inner />
    </ComposerProvider>
  );
}
