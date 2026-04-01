"use client";

import { useEffect, useState } from "react";

type BuildInfo = {
  gitCommitSha: string | null;
  gitCommitRef: string | null;
  vercelEnv: string | null;
  vercelUrl: string | null;
};

/**
 * Shows which Git commit / Vercel env this tab is actually running — use to
 * verify production matches GitHub without guessing about cache or domains.
 */
export default function BuildStamp() {
  const [label, setLabel] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/build-info")
      .then((r) => r.json() as Promise<BuildInfo>)
      .then((d) => {
        if (cancelled) return;
        const sha = d.gitCommitSha?.trim();
        const short = sha ? sha.slice(0, 7) : "local";
        const env = d.vercelEnv ?? (sha ? "unknown" : "dev");
        setLabel(`${short} · ${env}`);
        setTitle(
          [
            sha ? `commit ${sha}` : "no VERCEL_GIT_COMMIT_SHA (local or non-Vercel)",
            d.gitCommitRef && `ref ${d.gitCommitRef}`,
            d.vercelUrl && `host ${d.vercelUrl}`,
          ]
            .filter(Boolean)
            .join("\n")
        );
      })
      .catch(() => {
        if (!cancelled) setLabel("build?");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!label) return null;

  return (
    <span
      className="hidden sm:inline text-[10px] text-gray-400 font-mono tabular-nums max-w-[140px] truncate"
      title={title || label}
    >
      {label}
    </span>
  );
}
