"use client";

/**
 * "Stubborn" teardown — deletes Exchange assets through the API, not the CLI.
 *
 * Why this exists: the Anypoint CLI (and the normal Unpublish above) resolve a
 * delete through the v1 asset op, which returns 403 for MAF/agent asset types.
 * When that happens the network is gone from the deploy view but individual
 * agent/mcp/llm assets are left ORPHANED in Exchange — they show in no
 * network-scoped listing and the CLI cannot remove them.
 *
 * This panel enumerates the entire business group (all asset types) so those
 * orphans are visible, and force-deletes each one — every published version —
 * through `DELETE /exchange/api/v2/assets/...` with the trusted-manager headers
 * the CLI never sends. It also takes typed coordinates, so a known orphan can be
 * removed even if the scan does not surface it.
 *
 * The delete uses the signed-in user's token (the app requests `manage:exchange`).
 * A 403 means that user, or the org's policy, will not permit the delete — the
 * result line says so rather than failing silently.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { readAnypointUiContext, UI_CONTEXT_CHANGED_EVENT } from "@/lib/anypoint/ui-context";

type DeleteMode = "hard" | "soft";

interface GroupAsset {
  groupId: string;
  assetId: string;
  name: string;
  version: string;
  type: string;
}

interface DeleteTarget {
  groupId: string;
  assetId: string;
  name: string;
  /** A specific version, or null to resolve and delete every version. */
  version: string | null;
}

interface VersionOutcome {
  version: string;
  ok: boolean;
  label: string;
  hint?: string | null;
}

interface TargetOutcome {
  running: boolean;
  done: boolean;
  allOk: boolean;
  lines: VersionOutcome[];
  error?: string;
}

function assetKey(a: { groupId: string; assetId: string }): string {
  return `${a.groupId}:${a.assetId}`;
}

function typeBadgeClass(type: string): string {
  switch (type.toLowerCase()) {
    case "agent-network":
      return "bg-purple-50 text-purple-700 border-purple-200";
    case "agent":
    case "agent-domain":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "mcp":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "llm":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "policy":
      return "bg-gray-100 text-gray-600 border-gray-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

/** Deliberate second step. Restates the exact target and the irreversible mode. */
function ConfirmDeleteDialog({
  target,
  deleteMode,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  deleteMode: DeleteMode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onCancel]);

  const coords = `${target.groupId}:${target.assetId}:${target.version ?? "(all versions)"}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stubborn-confirm-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xl">
        <div className="flex items-start gap-2 border-b border-gray-200 px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <h2 id="stubborn-confirm-title" className="text-sm font-semibold text-red-900">
            Force delete {target.name || target.assetId}?
          </h2>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-gray-600">This deletes from Exchange via the API:</p>
          <p className="mt-1 break-all rounded-lg bg-gray-50 px-2.5 py-2 font-mono text-xs text-gray-900">
            {coords}
          </p>
          <p className="mt-3 text-xs text-gray-700">
            {target.version === null ? (
              <>Every published version of this asset will be removed. </>
            ) : (
              <>This one version will be removed. </>
            )}
            {deleteMode === "hard" ? (
              <>
                <span className="font-medium">Hard delete</span> frees the coordinates. This cannot
                be undone.
              </>
            ) : (
              <>
                <span className="font-medium">Soft delete</span> reserves the coordinates
                permanently. This cannot be undone.
              </>
            )}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleteMode === "hard" ? "Hard delete" : "Soft delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StubbornTeardownPanel() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("hard");

  const [scan, setScan] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; assets: GroupAsset[] }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const [outcomes, setOutcomes] = useState<Record<string, TargetOutcome>>({});
  const [confirming, setConfirming] = useState<DeleteTarget | null>(null);

  // Manual "delete by coordinates" fallback for a known orphan the scan misses.
  const [manualAssetId, setManualAssetId] = useState("");
  const [manualVersion, setManualVersion] = useState("");

  useEffect(() => {
    const syncFromUiContext = () => {
      const ctx = readAnypointUiContext();
      setOrgId(ctx?.orgId ?? null);
    };
    syncFromUiContext();
    window.addEventListener("focus", syncFromUiContext);
    window.addEventListener("storage", syncFromUiContext);
    window.addEventListener(UI_CONTEXT_CHANGED_EVENT, syncFromUiContext);
    return () => {
      window.removeEventListener("focus", syncFromUiContext);
      window.removeEventListener("storage", syncFromUiContext);
      window.removeEventListener(UI_CONTEXT_CHANGED_EVENT, syncFromUiContext);
    };
  }, []);

  // A business-group change invalidates the scan and every result: the listed
  // assets and coordinates belong to the previous group.
  useEffect(() => {
    setScan({ status: "idle" });
    setOutcomes({});
  }, [orgId]);

  const runScan = useCallback(async () => {
    if (!orgId) return;
    setScan({ status: "loading" });
    setOutcomes({});
    try {
      const res = await fetch(
        `/api/exchange/assets?organizationId=${encodeURIComponent(orgId)}`
      );
      if (!res.ok) throw new Error(`Scan failed (HTTP ${res.status})`);
      const body = (await res.json()) as { assets?: GroupAsset[] };
      setScan({ status: "done", assets: body.assets ?? [] });
    } catch (err) {
      setScan({
        status: "error",
        message: err instanceof Error ? err.message : "Could not list assets",
      });
    }
  }, [orgId]);

  /** Resolve the versions to delete for a target (specific one, or all of them). */
  const resolveVersions = useCallback(
    async (target: DeleteTarget): Promise<string[]> => {
      if (target.version) return [target.version];
      const params = new URLSearchParams({
        organizationId: target.groupId,
        assetId: target.assetId,
      });
      const res = await fetch(`/api/exchange/versions?${params.toString()}`);
      if (res.status === 404) return []; // already gone
      if (!res.ok) throw new Error(`Could not list versions (HTTP ${res.status})`);
      const body = (await res.json()) as { versions?: Array<{ version: string }> };
      return (body.versions ?? []).map((v) => v.version).filter(Boolean);
    },
    []
  );

  const runDelete = useCallback(
    async (target: DeleteTarget) => {
      const key = assetKey(target);
      setOutcomes((prev) => ({
        ...prev,
        [key]: { running: true, done: false, allOk: false, lines: [] },
      }));

      let versions: string[];
      try {
        versions = await resolveVersions(target);
      } catch (err) {
        setOutcomes((prev) => ({
          ...prev,
          [key]: {
            running: false,
            done: true,
            allOk: false,
            lines: [],
            error: err instanceof Error ? err.message : "Version lookup failed",
          },
        }));
        return;
      }

      if (versions.length === 0) {
        setOutcomes((prev) => ({
          ...prev,
          [key]: {
            running: false,
            done: true,
            allOk: true,
            lines: [{ version: "—", ok: true, label: "Nothing to delete (already gone)" }],
          },
        }));
        return;
      }

      let allOk = true;
      for (const version of versions) {
        let line: VersionOutcome;
        try {
          const res = await fetch("/api/exchange/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groupId: target.groupId,
              assetId: target.assetId,
              version,
              deleteType: deleteMode === "hard" ? "hard-delete" : "soft-delete",
            }),
          });
          const body = (await res.json()) as {
            ok?: boolean;
            statusLabel?: string;
            error?: string | null;
            hint?: string | null;
          };
          const ok = Boolean(body.ok);
          if (!ok) allOk = false;
          line = {
            version,
            ok,
            label: body.statusLabel ?? (ok ? "OK" : "Failed"),
            // Prefer the actionable hint (403/404/409 guidance) over the raw
            // Exchange error string; fall back to the error for other statuses.
            hint: ok ? null : body.hint || body.error || null,
          };
        } catch (err) {
          allOk = false;
          line = {
            version,
            ok: false,
            label: "Request failed",
            hint: err instanceof Error ? err.message : "Network error",
          };
        }
        // Stream each version result so the delete is visible as it happens.
        setOutcomes((prev) => {
          const cur = prev[key] ?? { running: true, done: false, allOk: true, lines: [] };
          return { ...prev, [key]: { ...cur, lines: [...cur.lines, line] } };
        });
      }

      setOutcomes((prev) => {
        const cur = prev[key] ?? { running: true, done: false, allOk, lines: [] };
        return { ...prev, [key]: { ...cur, running: false, done: true, allOk } };
      });
    },
    [deleteMode, resolveVersions]
  );

  const startDelete = (target: DeleteTarget) => setConfirming(target);

  const confirmDelete = () => {
    const target = confirming;
    setConfirming(null);
    if (target) void runDelete(target);
  };

  const manualTarget: DeleteTarget | null = useMemo(() => {
    if (!orgId) return null;
    const assetId = manualAssetId.trim();
    if (!assetId) return null;
    return {
      groupId: orgId,
      assetId,
      name: assetId,
      version: manualVersion.trim() || null,
    };
  }, [orgId, manualAssetId, manualVersion]);

  const anyRunning = Object.values(outcomes).some((o) => o.running);

  return (
    <div className="rounded-xl border border-red-200 bg-white p-4">
      {confirming && (
        <ConfirmDeleteDialog
          target={confirming}
          deleteMode={deleteMode}
          onCancel={() => setConfirming(null)}
          onConfirm={confirmDelete}
        />
      )}

      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-900">
        <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden />
        Stubborn teardown (API)
      </h3>
      <p className="mt-1 text-xs text-gray-600">
        Deletes Exchange assets directly through the API when the CLI cannot — the case that leaves
        orphaned agent, MCP and LLM assets behind after a network is gone. Lists the whole business
        group so those orphans are visible, and removes every published version. Irreversible.
      </p>

      <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
        <p className="text-[11px] text-amber-800">
          Uses your signed-in user token. If the delete returns 403, that user (or the org policy)
          cannot delete the asset — sign in with a user that has Exchange delete permission.
        </p>
      </div>

      {/* Delete mode */}
      <fieldset className="mt-3" disabled={anyRunning}>
        <legend className="text-[11px] font-medium text-gray-700">Delete mode</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
            <input
              type="radio"
              name="stubborn-delete-mode"
              checked={deleteMode === "hard"}
              onChange={() => setDeleteMode("hard")}
              className="h-3.5 w-3.5 accent-red-600"
            />
            <span>
              <span className="font-medium">Hard</span> — frees coordinates
            </span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
            <input
              type="radio"
              name="stubborn-delete-mode"
              checked={deleteMode === "soft"}
              onChange={() => setDeleteMode("soft")}
              className="h-3.5 w-3.5 accent-red-600"
            />
            <span>
              <span className="font-medium">Soft</span> — reserves coordinates
            </span>
          </label>
        </div>
      </fieldset>

      {/* Scan the business group */}
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-700">Assets in this business group</p>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={!orgId || scan.status === "loading" || anyRunning}
            title={orgId ? "List every asset in this business group" : "Select a business group first"}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-700 transition-colors hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scan.status === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {scan.status === "done" ? "Rescan" : "Scan"}
          </button>
        </div>

        {!orgId && (
          <p className="mt-2 text-[11px] text-gray-400">Select a business group in the left menu.</p>
        )}

        {scan.status === "error" && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
            {scan.message}
          </p>
        )}

        {scan.status === "done" && scan.assets.length === 0 && (
          <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] text-gray-600">
            No assets found in this business group. If you know an orphan exists, delete it by
            coordinates below.
          </p>
        )}

        {scan.status === "done" && scan.assets.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {scan.assets.map((asset) => {
              const key = assetKey(asset);
              const outcome = outcomes[key];
              return (
                <li
                  key={key}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-gray-900">
                          {asset.name}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${typeBadgeClass(asset.type)}`}
                        >
                          {asset.type}
                        </span>
                      </div>
                      <p className="truncate font-mono text-[11px] text-gray-500">
                        {asset.groupId}:{asset.assetId}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        startDelete({
                          groupId: asset.groupId,
                          assetId: asset.assetId,
                          name: asset.name,
                          version: null,
                        })
                      }
                      disabled={anyRunning || outcome?.done}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {outcome?.running ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : outcome?.done ? (
                        outcome.allOk ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <TriangleAlert className="h-3 w-3" />
                        )
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {outcome?.done ? (outcome.allOk ? "Deleted" : "Failed") : "Force delete"}
                    </button>
                  </div>
                  {outcome && (outcome.lines.length > 0 || outcome.error) && (
                    <div className="mt-2 space-y-0.5 border-t border-gray-200 pt-2">
                      {outcome.error && (
                        <p className="text-[11px] text-red-700">{outcome.error}</p>
                      )}
                      {outcome.lines.map((line, i) => (
                        <p
                          key={`${line.version}-${i}`}
                          className={`text-[11px] ${line.ok ? "text-gray-600" : "text-red-700"}`}
                        >
                          <span className="font-mono">{line.version}</span> → {line.label}
                          {line.hint ? ` — ${line.hint}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Delete by coordinates */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-medium text-gray-700">Delete by coordinates</p>
        <p className="mt-1 text-[11px] text-gray-500">
          For a known orphan the scan does not surface. Group id defaults to the selected business
          group. Leave version blank to delete every version.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={manualAssetId}
            onChange={(e) => setManualAssetId(e.target.value)}
            placeholder="asset-id (e.g. github-search-agent)"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-gray-900 focus:border-primary/40 focus:outline-none"
          />
          <input
            type="text"
            value={manualVersion}
            onChange={(e) => setManualVersion(e.target.value)}
            placeholder="version (optional)"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-gray-900 focus:border-primary/40 focus:outline-none sm:w-40"
          />
          <button
            type="button"
            onClick={() => manualTarget && startDelete(manualTarget)}
            disabled={!manualTarget || anyRunning}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Force delete
          </button>
        </div>
        {manualTarget &&
          outcomes[assetKey(manualTarget)] &&
          (() => {
            const o = outcomes[assetKey(manualTarget)];
            return (
              <div className="mt-2 space-y-0.5">
                {o.error && <p className="text-[11px] text-red-700">{o.error}</p>}
                {o.lines.map((line, i) => (
                  <p
                    key={`${line.version}-${i}`}
                    className={`text-[11px] ${line.ok ? "text-gray-600" : "text-red-700"}`}
                  >
                    <span className="font-mono">{line.version}</span> → {line.label}
                    {line.hint ? ` — ${line.hint}` : ""}
                  </p>
                ))}
              </div>
            );
          })()}
      </div>

      {scan.status === "done" && (
        <p className="mt-3 flex items-center gap-1 text-[11px] text-gray-400">
          <RefreshCw className="h-3 w-3" aria-hidden />
          Rescan after deleting to confirm the group is clear.
        </p>
      )}
    </div>
  );
}
