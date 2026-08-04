"use client";

import { BookOpen, ExternalLink } from "lucide-react";

export default function DebugLoggingCard() {
  return (
    <div className="w-full max-w-sm h-full">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm h-full flex flex-col">
        <div className="space-y-3 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
              <BookOpen className="h-4 w-4 text-indigo-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">
              Enable Debug Logging for Agent Broker
            </h3>
          </div>
          <p className="text-xs text-gray-600">
            To get the best logging results during development, enable debug logging for your broker instances in Runtime Manager.
          </p>
          <div className="rounded-md bg-gray-50 border border-gray-200 p-2.5">
            <p className="text-xs font-medium text-gray-700 mb-2">Set these categories to DEBUG:</p>
            <div className="space-y-2 text-xs">
              <div>
                <p className="font-medium text-gray-700 mb-1">For Agent Broker:</p>
                <code className="block rounded bg-white px-2 py-1 font-mono text-[10px] border border-gray-300 text-gray-800">com.mulesoft.modules.agent.broker</code>
              </div>
              <div>
                <p className="font-medium text-gray-700 mb-1">For LLM Reasoning:</p>
                <code className="block rounded bg-white px-2 py-1 font-mono text-[10px] border border-gray-300 text-gray-800">INSECURE-LOGGING</code>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2.5">
              In Runtime Manager, select your broker application and set both categories to <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] border border-gray-300">DEBUG</code>.
            </p>
          </div>
          <div className="rounded-md bg-amber-50 border border-amber-200 p-2">
            <p className="text-[10px] text-amber-800">
              <strong>Note:</strong> By default, broker logs include actions but exclude reasoning data due to potential PII concerns.
            </p>
          </div>
          <a
            href="https://help.salesforce.com/s/articleView?id=005239306&type=1"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-indigo-700 hover:underline"
          >
            Learn more
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
