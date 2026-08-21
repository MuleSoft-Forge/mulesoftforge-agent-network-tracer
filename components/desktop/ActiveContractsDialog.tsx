"use client";

/**
 * The biggest gotcha in undeploy: Anypoint refuses to remove an API instance
 * that still has an approved client-application contract on it. Rather than
 * let the CLI fail with that error mid-run, `TeardownPanel` checks for active
 * contracts before submitting the undeploy job and, if any exist, shows this
 * dialog so the operator can revoke them before continuing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";

export interface ActiveContractSummary {
  contractId: string;
  apiInstanceId: string;
  apiInstanceName?: string;
  applicationId?: string;
  applicationName?: string;
  approvedDate?: string | null;
}

interface RevokeResult {
  contractId: string;
  ok: boolean;
  message?: string;
}

interface ActiveContractsDialogProps {
  target: string;
  environment: string;
  organizationId: string;
  environmentId: string;
  contracts: ActiveContractSummary[];
  onCancel: () => void;
  /** Continue after revoking all active contracts. */
  onProceed: () => void;
}

function contractLabel(contract: ActiveContractSummary): string {
  return contract.applicationName || contract.applicationId || `Contract ${contract.contractId}`;
}

export default function ActiveContractsDialog({
  target,
  environment,
  organizationId,
  environmentId,
  contracts,
  onCancel,
  onProceed,
}: ActiveContractsDialogProps) {
  const [revoking, setRevoking] = useState(false);
  const [results, setResults] = useState<Map<string, RevokeResult> | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
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

  const allRevoked = useMemo(
    () => results !== null && contracts.every((c) => results.get(c.contractId)?.ok),
    [results, contracts]
  );
  const anyRevoked = useMemo(
    () => results !== null && contracts.some((c) => results.get(c.contractId)?.ok),
    [results, contracts]
  );

  async function revokeAll() {
    setRevoking(true);
    setRequestError(null);
    try {
      const res = await fetch("/api/mulesoft/undeploy-contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          environmentId,
          contracts: contracts.map((c) => ({
            apiInstanceId: c.apiInstanceId,
            contractId: c.contractId,
          })),
        }),
      });
      const body = (await res.json().catch(() => null)) as { results?: RevokeResult[] } | null;
      if (!res.ok || !body?.results) {
        throw new Error(`Revoke request failed (${res.status})`);
      }
      setResults(new Map(body.results.map((r) => [r.contractId, r])));
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Revoke request failed");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="active-contracts-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <div>
              <h2 id="active-contracts-title" className="text-sm font-semibold text-amber-900">
                {contracts.length} active contract{contracts.length === 1 ? "" : "s"} on this network
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Anypoint typically refuses to undeploy an API instance while an application still
                has approved access to it.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <p className="break-all rounded-lg bg-gray-50 px-2.5 py-2 font-mono text-xs text-gray-900">
            {target}
          </p>
          {environment && (
            <p className="mt-1 text-[11px] text-gray-500">in {environment}</p>
          )}

          <ul className="mt-3 flex flex-col gap-1.5">
            {contracts.map((contract) => {
              const result = results?.get(contract.contractId);
              return (
                <li
                  key={contract.contractId}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-gray-900">
                      {contractLabel(contract)}
                    </p>
                    <p className="truncate text-[11px] text-gray-500">
                      {contract.apiInstanceName ?? `API instance ${contract.apiInstanceId}`}
                    </p>
                    {result && !result.ok && result.message && (
                      <p className="mt-0.5 truncate text-[11px] text-red-600">{result.message}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {result ? (
                      result.ok ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                          <ShieldCheck className="h-3.5 w-3.5" /> Revoked
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-red-600">
                          <ShieldX className="h-3.5 w-3.5" /> Failed
                        </span>
                      )
                    ) : (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                        Approved
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {requestError && <p className="mt-3 text-xs text-red-600">{requestError}</p>}
          {results && !allRevoked && (
            <p className="mt-3 text-xs text-amber-700">
              {anyRevoked
                ? "Some contracts could not be revoked. Retry here, or cancel undeployment and revoke the remaining contracts manually in API Manager."
                : "None of these could be revoked automatically. Cancel undeployment and revoke the contracts manually in API Manager."}
            </p>
          )}
          {allRevoked && (
            <p className="mt-3 text-xs text-emerald-700">
              All contracts revoked. You can continue to undeploy.
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          {!allRevoked && (
            <button
              type="button"
              onClick={() => void revokeAll()}
              disabled={revoking}
              className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {revoking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              {results ? "Retry revoke" : "Revoke all and continue"}
            </button>
          )}
          {allRevoked ? (
            <button
              type="button"
              onClick={onProceed}
              className="rounded-xl bg-red-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700"
            >
              Continue to undeploy
            </button>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl bg-gray-700 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-800"
            >
              Cancel undeployment
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
