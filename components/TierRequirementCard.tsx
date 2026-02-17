"use client";

import { AlertCircle, ExternalLink } from "lucide-react";

export default function TierRequirementCard() {
  return (
    <div className="w-full max-w-sm h-full">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm h-full flex flex-col">
        <div className="space-y-3 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100">
              <AlertCircle className="h-4 w-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-semibold text-blue-900">
              Tasks Feature Requirements
            </h3>
          </div>
          <p className="text-xs text-blue-800">
            The Tasks feature requires an <strong>Anypoint Integration Advanced</strong> package or a <strong>Titanium</strong> subscription to Anypoint Platform.
          </p>
          <div className="rounded-md bg-white border border-blue-200 p-2.5">
            <p className="text-xs font-medium text-blue-900 mb-1.5">Required tiers:</p>
            <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
              <li>Anypoint Integration Advanced package</li>
              <li>Titanium subscription</li>
            </ul>
            <p className="text-xs text-blue-700 mt-2">
              Log search across applications is only available with these tiers. Single-application log search in Runtime Manager is available to all tiers.
            </p>
          </div>
          <a
            href="https://docs.mulesoft.com/monitoring/#log-search"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
          >
            Learn more about log search
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
