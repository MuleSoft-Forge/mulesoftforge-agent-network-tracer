"use client";

/**
 * Build / Publish / Deploy an Agent Network project by driving the Anypoint CLI.
 *
 * Desktop-only: spawning a CLI is impossible in a browser, so on the web this
 * renders an explanatory disabled state instead (see `supported`).
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  Hammer,
  Loader2,
  RefreshCw,
  Rocket,
  Terminal,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import BuildPublishWebLanding from "@/components/desktop/BuildPublishWebLanding";
import DeployOptionsPanel from "@/components/desktop/DeployOptionsPanel";
import CliActivityView from "@/components/desktop/CliActivityView";
import CliRawOutputView from "@/components/desktop/CliRawOutputView";
import { deployOptionsReady } from "@/lib/desktop/deploy-options";
import { useAgentNetworkCli } from "@/lib/desktop/useAgentNetworkCli";
import type { CliCommand } from "@/lib/desktop/types";

const COMMANDS: {
  key: CliCommand;
  label: string;
  hint: string;
  Icon: typeof Hammer;
}[] = [
  { key: "build", label: "Build", hint: "Serialize the project into target/", Icon: Hammer },
  { key: "publish", label: "Publish", hint: "Push assets to Exchange", Icon: Upload },
  { key: "deploy", label: "Deploy", hint: "Deploy the built network", Icon: Rocket },
];

export default function AgentNetworkLifecyclePanel() {
  const cli = useAgentNetworkCli();
  const logRef = useRef<HTMLDivElement>(null);
  const [showRawCli, setShowRawCli] = useState(false);

  // Keep the log pinned to the newest output.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cli.log, showRawCli]);

  useEffect(() => {
    if (cli.log.length === 0) setShowRawCli(false);
  }, [cli.log.length]);

  // --- Web build: the CLI cannot run in a browser. ---
  if (!cli.supported) {
    return <BuildPublishWebLanding />;
  }

  const detection = cli.detection;
  const cliReady = detection?.available === true;
  const deployReadiness = deployOptionsReady(cli.deployOptions, cli.projectVariables);
  // Offer one-click install only when the CLI itself is fine and the plugin is
  // the only thing missing — installing can't fix a missing CLI.
  const canInstallPlugin = detection?.reason === "plugin-not-installed";

  return (
    <div className="flex flex-col gap-4">
      {/* CLI status */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {cli.detecting ? (
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-gray-400" />
            ) : cliReady ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            )}
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Anypoint CLI</h3>
              {cli.detecting && <p className="mt-1 text-sm text-gray-500">Checking…</p>}
              {!cli.detecting && cliReady && (
                <p className="mt-1 text-xs text-gray-500">
                  {detection?.version}
                  <span className="mx-1.5 text-gray-300">•</span>
                  <span className="font-mono">{detection?.cliPath}</span>
                </p>
              )}
              {!cli.detecting && !cliReady && detection?.hint && (
                <p className="mt-1 max-w-2xl text-sm text-gray-600">{detection.hint}</p>
              )}
              {!cli.detecting && canInstallPlugin && (
                <button
                  type="button"
                  onClick={() => void cli.installPlugin()}
                  disabled={cli.busy}
                  className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {cli.installing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {cli.installing ? "Installing plugin…" : "Install plugin"}
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void cli.detect()}
            disabled={cli.detecting}
            className="shrink-0 flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${cli.detecting ? "animate-spin" : ""}`} />
            Re-check
          </button>
        </div>
      </div>

      {/* Project selection */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Project</h3>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void cli.chooseProject()}
            disabled={cli.busy}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {cli.projectDir ? "Change folder…" : "Choose folder…"}
          </button>
          <span className="truncate font-mono text-xs text-gray-500">
            {cli.projectDir ?? "No project selected"}
          </span>
        </div>
        {cli.projectDir && cli.projectDirSource === "remembered" ? (
          <p className="mt-2 text-xs text-primary">
            Using the project folder you opened or saved in Builder.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-gray-400">
          Pick the folder containing <span className="font-mono">exchange.json</span>.
        </p>
        {cli.projectMetaLoading && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Reading deploy variables…
          </p>
        )}
        {cli.projectMetaError && (
          <p className="mt-2 text-xs text-amber-600">{cli.projectMetaError}</p>
        )}
      </div>

      {/* Deploy options — required by agent-network project deploy */}
      {cli.projectDir && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Deploy Agent Network</h3>
          <p className="mt-1 text-xs text-gray-500">
            Environment, deployment target, and variables are passed to the CLI on deploy — matching
            Anypoint Code Builder.
          </p>
          <div className="mt-4">
            <DeployOptionsPanel
              options={cli.deployOptions}
              variables={cli.projectVariables}
              onChange={cli.setDeployOptions}
              disabled={cli.busy}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Lifecycle</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {COMMANDS.map(({ key, label, hint, Icon }) => {
            const isRunning = cli.running === key;
            const deployBlocked = key === "deploy" && !deployReadiness.ok;
            return (
              <button
                key={key}
                type="button"
                title={deployBlocked ? deployReadiness.reason : hint}
                onClick={() => void cli.run(key)}
                disabled={!cliReady || !cli.projectDir || cli.busy || deployBlocked}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                {label}
              </button>
            );
          })}

          {cli.busy && (
            <button
              type="button"
              onClick={() => void cli.cancel()}
              className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 transition-colors hover:bg-red-100"
            >
              <XCircle className="h-3.5 w-3.5" />
              Cancel
            </button>
          )}

          {cli.log.length > 0 && !cli.busy && (
            <button
              type="button"
              onClick={cli.clearLog}
              className="ml-auto flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {!cli.projectDir && cliReady && (
          <p className="mt-2 text-xs text-gray-400">Select a project folder to enable these actions.</p>
        )}
        {cli.projectDir && !deployReadiness.ok && cliReady && (
          <p className="mt-2 text-xs text-gray-400">Complete deploy options above to enable Deploy.</p>
        )}
      </div>

      {/* Activity */}
      {cli.log.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">
                {showRawCli ? "CLI output" : "Activity"}
              </h3>
              <button
                type="button"
                onClick={() => setShowRawCli((prev) => !prev)}
                className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              >
                <Terminal className="h-3 w-3" aria-hidden />
                {showRawCli ? "Show activity" : "Show CLI output"}
              </button>
            </div>
            {cli.lastResult && !cli.busy && (
              <span
                className={`flex items-center gap-1.5 text-xs ${
                  cli.lastResult.ok ? "text-green-600" : "text-red-600"
                }`}
              >
                {cli.lastResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {cli.lastResult.command}
              </span>
            )}
          </div>
          <div
            ref={logRef}
            className={`max-h-96 overflow-auto px-4 py-3 ${showRawCli ? "bg-gray-950" : ""}`}
          >
            {showRawCli ? (
              <CliRawOutputView log={cli.log} />
            ) : (
              <CliActivityView
                log={cli.log}
                command={cli.running ?? cli.lastResult?.command ?? undefined}
                busy={cli.busy}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
