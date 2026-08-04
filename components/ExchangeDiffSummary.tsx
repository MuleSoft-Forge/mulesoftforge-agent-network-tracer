"use client";

import { Plus, Minus, RefreshCw, Equal } from "lucide-react";
import type { GraphDiff } from "@/lib/adapters/exchange-to-canonical";

interface ExchangeDiffSummaryProps {
  diff: GraphDiff;
  beforeVersion: string;
  afterVersion: string;
}

export default function ExchangeDiffSummary({
  diff,
  beforeVersion,
  afterVersion,
}: ExchangeDiffSummaryProps) {
  const hasChanges =
    diff.addedNodes.length > 0 ||
    diff.removedNodes.length > 0 ||
    diff.changedNodes.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Comparison: {beforeVersion} → {afterVersion}
        </h3>
      </div>

      {!hasChanges ? (
        <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
          <Equal className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-600">
            No differences in network topology between these versions.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {diff.addedNodes.length > 0 && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <Plus className="h-3.5 w-3.5 text-green-600" />
                <span className="text-xs font-semibold text-green-700">
                  Added ({diff.addedNodes.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {diff.addedNodes.map((n) => (
                  <div key={n.id} className="flex items-center gap-2 text-xs text-green-800">
                    <span className="font-medium">{n.label}</span>
                    <span className="text-green-600">{n.type}</span>
                    <span className="text-green-500">{n.version}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {diff.removedNodes.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <Minus className="h-3.5 w-3.5 text-red-600" />
                <span className="text-xs font-semibold text-red-700">
                  Removed ({diff.removedNodes.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {diff.removedNodes.map((n) => (
                  <div key={n.id} className="flex items-center gap-2 text-xs text-red-800">
                    <span className="font-medium">{n.label}</span>
                    <span className="text-red-600">{n.type}</span>
                    <span className="text-red-500">{n.version}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {diff.changedNodes.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs font-semibold text-amber-700">
                  Changed ({diff.changedNodes.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {diff.changedNodes.map(({ before, after }) => (
                  <div key={after.id} className="flex items-center gap-2 text-xs text-amber-800">
                    <span className="font-medium">{after.label}</span>
                    <span className="text-amber-600">
                      {before.version} → {after.version}
                    </span>
                    {before.type !== after.type && (
                      <span className="text-amber-500">
                        {before.type} → {after.type}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {diff.unchangedNodes.length > 0 && (
            <div className="text-[10px] text-gray-400">
              {diff.unchangedNodes.length} unchanged node{diff.unchangedNodes.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
