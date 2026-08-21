"use client";

import { ExternalLink } from "lucide-react";
import {
  OBJECT_STORE_TTL_MAX_MS,
  OBJECT_STORE_TTL_VARIABLE,
  RUNTIME_SYSTEM_LIMITS_DOCS_URL,
} from "@/lib/composer/runtime-system-limits";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Shown where Object Store data is missing. Retention is a store-level setting
 * that varies by deployment, so this names the variable that raises it instead
 * of quoting a window this app cannot know without asking the platform.
 */
export default function ObjectStoreRetentionTip() {
  const maxDays = Math.round(OBJECT_STORE_TTL_MAX_MS / MS_PER_DAY);
  return (
    <p className="text-xs text-gray-500">
      Object Store retention is set per deployment, so how far back a task stays readable varies. To
      keep this history longer, set{" "}
      <code className="font-mono">{OBJECT_STORE_TTL_VARIABLE}</code> in the network&apos;s{" "}
      <code className="font-mono">exchange.json</code> and redeploy — {maxDays} days (
      {OBJECT_STORE_TTL_MAX_MS} ms) is the maximum.{" "}
      <a
        href={RUNTIME_SYSTEM_LIMITS_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline"
      >
        MuleSoft docs
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </p>
  );
}
