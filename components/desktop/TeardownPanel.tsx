"use client";

/**
 * Teardown controls for `agent-network project undeploy` / `unpublish`.
 *
 * Kept separate from the build/deploy card because the risk profile is
 * different: these remove things, and one of them (`--hard-delete`) is
 * irreversible.
 *
 * The target is always chosen from Exchange through the picker. The CLI also
 * accepts a local project path, and coordinates can be typed by hand, but both
 * let you aim a delete at something that is not what you think it is — a bundle
 * that was never published, or a version that differs by one character. Picking
 * from the live list means the thing named on the button is the thing that
 * exists.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { List, Loader2, ServerCrash, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import GavPickerDialog, { type GavSelection } from "@/components/desktop/GavPickerDialog";
import ActiveContractsDialog, {
  type ActiveContractSummary,
} from "@/components/desktop/ActiveContractsDialog";
import { readAnypointUiContext, UI_CONTEXT_CHANGED_EVENT } from "@/lib/anypoint/ui-context";
import type { RemovalOptions } from "@/lib/lifecycle/types";

/**
 * Exchange erases the asset either way; the modes differ only in whether the
 * coordinates can be used again.
 *
 * Hard delete is also conditional — Anypoint restricts it to roughly the first
 * seven days of an asset's life and lets an org disable it outright — so it is
 * offered rather than defaulted, and the CLI reports the refusal if it is not
 * allowed. See docs.mulesoft.com/exchange/lifecycle.
 */
type DeleteMode = "soft" | "hard";

interface AnypointEnvironment {
  id: string;
  name: string;
  type?: string;
}

/**
 * Deliberate second step for unpublish. It restates the exact target and the
 * consequence of the chosen mode, which is the part worth checking — the risk
 * here is removing the wrong thing, not clicking too fast.
 */
function UnpublishConfirmDialog({
  target,
  assetId,
  deleteMode,
  environment,
  onCancel,
  onConfirm,
}: {
  target: string;
  assetId: string;
  deleteMode: DeleteMode;
  environment: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus Cancel, not the destructive action, so a stray Enter cannot confirm.
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unpublish-confirm-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xl">
        <div className="flex items-start gap-2 border-b border-gray-200 px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <h2 id="unpublish-confirm-title" className="text-sm font-semibold text-red-900">
            Unpublish {assetId || "this asset"}?
          </h2>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-gray-600">This removes from Exchange:</p>
          <p className="mt-1 break-all rounded-lg bg-gray-50 px-2.5 py-2 font-mono text-xs text-gray-900">
            {target || "the loaded project"}
          </p>
          <p className="mt-3 text-xs text-gray-700">
            {deleteMode === "hard" ? (
              <>
                <span className="font-medium">Hard delete.</span> The asset is erased and its
                coordinates are freed, so you can republish this version. This cannot be undone.
              </>
            ) : (
              <>
                <span className="font-medium">Soft delete.</span> The asset is erased and its
                coordinates stay reserved, so this version can never be republished. This cannot be
                undone.
              </>
            )}
          </p>
          {environment && (
            <p className="mt-2 text-[11px] text-gray-500">
              Anypoint will refuse this if the network still has active instances in {environment}.
            </p>
          )}
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

interface TeardownPanelProps {
  busy: boolean;
  runningCommand: "unpublish" | "undeploy" | null;
  onRun: (command: "unpublish" | "undeploy", removal: RemovalOptions) => void;
}

export default function TeardownPanel({ busy, runningCommand, onRun }: TeardownPanelProps) {
  const [target, setTarget] = useState<GavSelection | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [contextEnvId, setContextEnvId] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<AnypointEnvironment[]>([]);
  // Hard by default. Both modes are equally unrecoverable, so soft buys no
  // safety — it only burns the coordinates, which breaks the common case of
  // removing a version in order to republish it. A hard delete that Anypoint
  // refuses costs one retry; a soft delete that succeeds costs the version.
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("hard");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Pre-flight check for active API-instance contracts, run right before an
  // undeploy job is submitted. Anypoint refuses to remove an instance that
  // still has an approved contract, so this surfaces them up front instead of
  // letting the CLI fail mid-run.
  const [contractsCheck, setContractsCheck] = useState<
    | { status: "idle" }
    | { status: "checking" }
    | { status: "found"; contracts: ActiveContractSummary[] }
    | { status: "warning"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    const syncFromUiContext = () => {
      const ctx = readAnypointUiContext();
      setOrgId(ctx?.orgId ?? null);
      setContextEnvId(ctx?.envId ?? null);
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

  useEffect(() => {
    if (!orgId) {
      setEnvironments([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/accounts/organizations/${encodeURIComponent(orgId)}/environments`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { data?: AnypointEnvironment[] }) => {
        if (cancelled) return;
        setEnvironments(Array.isArray(body.data) ? body.data.filter((e) => e.type !== "design") : []);
      })
      .catch(() => {
        if (!cancelled) setEnvironments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Inherited from the left menu, like the deploy card — one environment for the
  // page. The CLI takes the name, the context stores the id, so this resolves it.
  const selectedEnvironment = environments.find((env) => env.id === contextEnvId) ?? null;
  const environment = selectedEnvironment?.name ?? "";

  // A business group change invalidates the pick: the listed assets belong to
  // the previous group, and its coordinates would not resolve in the new one.
  useEffect(() => {
    setTarget(null);
    setContractsCheck({ status: "idle" });
  }, [orgId]);

  // Any change to the target invalidates a previous contracts check — it was
  // answering "does the old target have active contracts?", which says
  // nothing about the newly picked one.
  useEffect(() => {
    setContractsCheck({ status: "idle" });
  }, [target]);

  const targetProblem = target ? null : "Choose a published network to remove.";

  const removal = useCallback(
    (command: "unpublish" | "undeploy"): RemovalOptions => ({
      ...(orgId ? { organizationId: orgId } : {}),
      ...(environment ? { environment } : {}),
      ...(target ? { gav: target.gav } : {}),
      ...(command === "unpublish" && deleteMode === "hard" ? { hardDelete: true } : {}),
    }),
    [orgId, environment, target, deleteMode]
  );

  const undeployProblem =
    targetProblem ?? (environment ? null : "Select an environment in the left menu.");
  // Unpublish is enabled as soon as it has a target. Because it is irreversible
  // it still needs a deliberate second step, but that belongs on the click, not
  // as a permanently disabled button — this runs repeatedly against the same
  // asset while iterating, and a retype-the-id gate every time is unusable.
  const unpublishProblem = targetProblem;

  function submitUndeploy() {
    setContractsCheck({ status: "idle" });
    onRun("undeploy", removal("undeploy"));
  }

  async function startUndeploy() {
    if (undeployProblem || !orgId || !contextEnvId || !target) return;
    setContractsCheck({ status: "checking" });
    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        environmentId: contextEnvId,
        gav: target.gav,
      });
      const res = await fetch(`/api/mulesoft/undeploy-contracts?${params.toString()}`);
      if (!res.ok) throw new Error(`Contract check failed (${res.status})`);
      const body = (await res.json()) as { contracts?: ActiveContractSummary[] };
      const contracts = body.contracts ?? [];
      if (contracts.length > 0) {
        setContractsCheck({ status: "found", contracts });
      } else {
        submitUndeploy();
      }
    } catch (err) {
      setContractsCheck({
        status: "warning",
        message:
          (err instanceof Error ? err.message : "Could not check for active contracts") +
          " — Anypoint will refuse the undeploy if any exist.",
      });
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-white p-4">
      {pickerOpen && orgId && (
        <GavPickerDialog
          orgId={orgId}
          onClose={() => setPickerOpen(false)}
          onSelect={(picked) => {
            setTarget(picked);
            setPickerOpen(false);
          }}
        />
      )}
      {contractsCheck.status === "found" && target && orgId && contextEnvId && (
        <ActiveContractsDialog
          target={target.gav}
          environment={environment}
          organizationId={orgId}
          environmentId={contextEnvId}
          contracts={contractsCheck.contracts}
          onCancel={() => setContractsCheck({ status: "idle" })}
          onProceed={submitUndeploy}
        />
      )}
      {confirming && target && (
        <UnpublishConfirmDialog
          target={target.gav}
          assetId={target.assetId}
          deleteMode={deleteMode}
          environment={environment}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onRun("unpublish", removal("unpublish"));
          }}
        />
      )}
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-900">
        <TriangleAlert className="h-4 w-4 text-red-600" aria-hidden />
        Teardown
      </h3>
      <p className="mt-1 text-xs text-gray-600">
        Undeploy stops a running network, which you can deploy again afterwards. Unpublish erases
        its Exchange asset and cannot be undone. Deploy variables do not apply here — teardown only
        needs to know what to remove.
      </p>

      <fieldset className="mt-4" disabled={busy}>
        <legend className="text-xs font-medium text-gray-700">What to remove</legend>

        {target ? (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-gray-900">{target.assetId}</p>
              <p className="truncate font-mono text-[11px] text-gray-500">{target.gav}</p>
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-700 transition-colors hover:border-primary/30 hover:text-primary"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={!orgId}
            title={
              orgId
                ? "List what is published in this business group"
                : "Select a business group first"
            }
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-xs text-gray-600 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <List className="h-3.5 w-3.5" />
            {orgId ? "Browse published networks…" : "Select a business group first"}
          </button>
        )}

        <div className="mt-3">
          <p className="text-xs font-medium text-gray-700">Environment</p>
          <div className="mt-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
            {selectedEnvironment
              ? `${selectedEnvironment.name}${selectedEnvironment.type ? ` (${selectedEnvironment.type})` : ""}`
              : contextEnvId
                ? `Resolving ${contextEnvId}…`
                : "Not selected in left menu"}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Inherited from the left menu. Required to undeploy. On unpublish it lets Anypoint refuse
            the delete while the network still has active instances.
          </p>
        </div>
      </fieldset>

      <div className="mt-4 flex flex-col gap-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <button
            type="button"
            title={
              undeployProblem ??
              "Checks for active API contracts, then removes the deployed network from the selected environment"
            }
            onClick={() => void startUndeploy()}
            disabled={busy || undeployProblem !== null || contractsCheck.status === "checking"}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {runningCommand === "undeploy" || contractsCheck.status === "checking" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ServerCrash className="h-3.5 w-3.5" />
            )}
            {contractsCheck.status === "checking" ? "Checking contracts…" : "Undeploy"}
          </button>
          <p className="mt-2 text-[11px] text-gray-600">
            Stops the running network. The Exchange asset stays, so you can deploy it again. Checks
            for active API contracts first and offers to revoke them.
          </p>
          {contractsCheck.status === "warning" && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-[11px] text-amber-800">{contractsCheck.message}</p>
                <button
                  type="button"
                  onClick={submitUndeploy}
                  className="mt-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] text-amber-800 transition-colors hover:bg-amber-100"
                >
                  Undeploy anyway
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <button
            type="button"
            title={unpublishProblem ?? "Removes the published asset from Exchange"}
            onClick={() => setConfirming(true)}
            disabled={busy || unpublishProblem !== null}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {runningCommand === "unpublish" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Unpublish
          </button>
          <p className="mt-2 text-[11px] text-gray-600">
            Erases the asset version from Exchange. Undeploy the network first if it is still
            running. Neither mode below can be undone.
          </p>

          <fieldset className="mt-3" disabled={busy}>
            <legend className="text-[11px] font-medium text-gray-700">Delete mode</legend>
            <label className="mt-1.5 flex items-start gap-1.5 text-[11px] text-gray-700">
              <input
                type="radio"
                name="teardown-delete-mode"
                checked={deleteMode === "hard"}
                onChange={() => setDeleteMode("hard")}
                className="mt-0.5 h-3.5 w-3.5 accent-red-600"
              />
              <span>
                <span className="font-medium">Hard delete.</span> Frees the coordinates so you can
                republish this same version. Anypoint permits it only for about seven days after
                the asset was created, and an org can disable it.
              </span>
            </label>
            <label className="mt-1.5 flex items-start gap-1.5 text-[11px] text-gray-700">
              <input
                type="radio"
                name="teardown-delete-mode"
                checked={deleteMode === "soft"}
                onChange={() => setDeleteMode("soft")}
                className="mt-0.5 h-3.5 w-3.5 accent-red-600"
              />
              <span>
                <span className="font-medium">Soft delete.</span> Use when a hard delete is
                refused. It reserves the coordinates permanently, so this version can never be
                republished.
              </span>
            </label>
          </fieldset>

        </div>
      </div>
    </div>
  );
}
