"use client";

/**
 * Web Build & Publish, backed by the remote (Railway) lifecycle backend.
 *
 * Unlike the desktop panel (which spawns the CLI locally), this uploads a
 * project bundle to the hosted backend, which runs the allowlisted CLI command
 * and streams the result back. Shown on the web only when the backend is
 * configured for this deployment.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileArchive,
  FolderOpen,
  Lightbulb,
  Loader2,
  Rocket,
  Terminal,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import DeployOptionsPanel from "@/components/desktop/DeployOptionsPanel";
import CliActivityView from "@/components/desktop/CliActivityView";
import CliRawOutputView from "@/components/desktop/CliRawOutputView";
import DeployDiagnosisDialog, {
  type RuntimeManagerLogGroup,
} from "@/components/desktop/DeployDiagnosisDialog";
import TeardownPanel from "@/components/desktop/TeardownPanel";
import StubbornTeardownPanel from "@/components/desktop/StubbornTeardownPanel";
import { formatRawCliLog } from "@/lib/desktop/cli-output-parser";
import { diagnoseDeployOutput } from "@/lib/lifecycle/deploy-diagnostics";
import type { LogLine } from "@/lib/lifecycle/log-lines";
import {
  defaultDeployOptions,
  deployOptionsReady,
  propertiesFromVariables,
  type DeployOptions,
  type ProjectDeployVariable,
} from "@/lib/desktop/deploy-options";
import { flattenExchangeDeployVariables } from "@/lib/desktop/exchange-deploy-variables";
import {
  canPickDirectory,
  readDirectoryBundle,
  readZipBundle,
  type LoadedBundle,
} from "@/lib/lifecycle/read-project-bundle";
import { useRemoteAgentNetworkCli } from "@/lib/lifecycle/useRemoteAgentNetworkCli";
import { type CliCommand, type RemovalOptions } from "@/lib/lifecycle/types";
import { loadComposerProjectFromSession } from "@/lib/composer/session-persistence";
import { serializeProject } from "@/lib/composer/serialize";
import { validateProject } from "@/lib/composer/validate";
import type { ComposerProject } from "@/lib/composer/model";
import { assertProjectAgentScriptsConform } from "@/lib/composer/agentscript-conformance";

interface LifecycleConfigCli {
  available: boolean;
  version: string | null;
  cliPath: string | null;
  pluginInstalled: boolean;
  reason: string | null;
  hint: string | null;
}

interface LifecycleConfigResponse {
  enabled?: boolean;
  cli?: LifecycleConfigCli;
}

// Anypoint model: there is no standalone build — publish and deploy each build
// the project first (the worker chains build in).
const COMMANDS: { key: CliCommand; label: string; hint: string; Icon: typeof Upload }[] = [
  { key: "publish", label: "Publish", hint: "Builds and publishes assets to Exchange", Icon: Upload },
  { key: "deploy", label: "Deploy", hint: "Builds and deploys the agent network", Icon: Rocket },
];

/**
 * Stop button for the active run. Rendered in every section that can start a
 * job, so whichever region the user is looking at, cancelling is in reach
 * without scrolling — and it is the only enabled control while a job runs.
 */
function CancelRunButton({
  busy,
  cancelling,
  onCancel,
  className,
}: {
  busy: boolean;
  cancelling: boolean;
  onCancel: () => void;
  className?: string;
}) {
  if (!busy) return null;
  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={cancelling}
      title={cancelling ? "Cancellation sent to the lifecycle worker" : "Stop the running CLI command"}
      className={`flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60 ${className ?? ""}`}
    >
      {cancelling ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <XCircle className="h-3.5 w-3.5" />
      )}
      {cancelling ? "Cancelling…" : "Cancel run"}
    </button>
  );
}

const VALIDATION_TAB_PRIORITY: Record<string, number> = {
  graph: 0,
  behavior: 1,
  actions: 2,
  llms: 3,
  access: 4,
  assets: 5,
  identity: 6,
  registry: 7,
  variables: 8,
  "a2a-card": 9,
};

function summarizeValidationErrors(
  errors: ReadonlyArray<{ message: string; location: { tab: string } }>
): string {
  if (!errors.length) return "it has validation errors";

  const sorted = [...errors].sort((a, b) => {
    const aRank = VALIDATION_TAB_PRIORITY[a.location.tab] ?? Number.MAX_SAFE_INTEGER;
    const bRank = VALIDATION_TAB_PRIORITY[b.location.tab] ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
  const uniqueMessages = Array.from(
    new Set(sorted.map((issue) => issue.message.trim()).filter(Boolean))
  );
  const top = uniqueMessages.slice(0, 3).join("; ");
  const remaining = uniqueMessages.length - 3;
  return remaining > 0 ? `${top} (+${remaining} more)` : top;
}

function isEffectivelyEmptyBuilderProject(project: ComposerProject): boolean {
  if (project.identity.name.trim() || project.identity.assetId.trim()) return false;
  if (project.assets.length > 0) return false;
  if (project.customVariables.length > 0) return false;
  return project.brokers.every(
    (broker) =>
      !broker.name.trim() &&
      broker.nodes.length === 0 &&
      broker.actions.length === 0 &&
      broker.llmBindings.length === 0
  );
}

interface JsonAssetSummary {
  assetId: string;
  version?: string;
  url?: string;
  type?: string;
  action?: string;
}

interface JsonErrorSummary {
  code: number;
  message: string;
}

interface ParsedCliSummary {
  assets: JsonAssetSummary[];
  errors: JsonErrorSummary[];
}

function balancedJsonEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractJsonBlocks(text: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const end = balancedJsonEnd(text, i);
    if (end === -1) continue;
    const candidate = text.slice(i, end + 1);
    try {
      out.push(JSON.parse(candidate) as unknown);
      i = end;
    } catch {
      // not valid JSON at this offset
    }
  }
  return out;
}

function parseCliSummary(log: Array<{ text: string }>): ParsedCliSummary {
  const text = log.map((line) => line.text).join("\n");
  const jsonValues = extractJsonBlocks(text);
  const assets = new Map<string, JsonAssetSummary>();
  const errors = new Map<number, JsonErrorSummary>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;

    const assetId = typeof record.assetId === "string" ? record.assetId : null;
    const version = typeof record.version === "string" ? record.version : undefined;
    const url = typeof record.url === "string" ? record.url : undefined;
    const type = typeof record.type === "string" ? record.type : undefined;
    const action = typeof record.action === "string" ? record.action : undefined;
    if (assetId && (version || url || action || type)) {
      const key = `${assetId}:${version ?? ""}:${action ?? ""}:${type ?? ""}:${url ?? ""}`;
      assets.set(key, { assetId, version, url, type, action });
    }

    const nestedError =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    const errorCode =
      typeof record.errorCode === "number"
        ? record.errorCode
        : typeof nestedError?.errorCode === "number"
          ? nestedError.errorCode
          : null;
    const errorMessage =
      typeof record.errorMessage === "string"
        ? record.errorMessage
        : typeof nestedError?.errorMessage === "string"
          ? nestedError.errorMessage
          : null;
    if (typeof errorCode === "number" && typeof errorMessage === "string" && errorMessage.trim()) {
      errors.set(errorCode, { code: errorCode, message: errorMessage.trim() });
    }

    for (const nested of Object.values(record)) visit(nested);
  };

  for (const value of jsonValues) visit(value);
  return { assets: Array.from(assets.values()), errors: Array.from(errors.values()) };
}

const RUNTIME_LOG_HEADER_RE = /^—\s*Runtime Manager log\s*·\s*(.+?)\s*—$/;

/**
 * Reconstruct the Runtime Manager log blocks the worker streamed after a failed
 * deploy. Each block is a `— Runtime Manager log · <name> —` meta header
 * followed by its `stderr` log lines, up to the next meta line.
 */
function extractRuntimeManagerLogs(log: LogLine[]): RuntimeManagerLogGroup[] {
  const groups: RuntimeManagerLogGroup[] = [];
  let current: RuntimeManagerLogGroup | null = null;

  for (const entry of log) {
    const text = entry.text.replace(/\n+$/, "");
    if (entry.channel === "meta") {
      const match = RUNTIME_LOG_HEADER_RE.exec(text.trim());
      current = match ? { deployment: match[1], lines: [] } : null;
      if (current) groups.push(current);
      continue;
    }
    if (current && entry.channel === "stderr") {
      for (const part of text.split("\n")) {
        if (part.trim()) current.lines.push(part);
      }
      continue;
    }
    current = null;
  }

  return groups.filter((group) => group.lines.length > 0);
}

export default function RemoteLifecyclePanel() {
  const cli = useRemoteAgentNetworkCli();
  const [activeAction, setActiveAction] = useState<CliCommand | "publishAndDeploy" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [runtimeCli, setRuntimeCli] = useState<LifecycleConfigCli | null>(null);
  const [runtimeCliLoading, setRuntimeCliLoading] = useState(true);
  const [bundle, setBundle] = useState<LoadedBundle | null>(null);
  const [variables, setVariables] = useState<ProjectDeployVariable[]>([]);
  const [deployOptions, setDeployOptions] = useState<DeployOptions>(() => defaultDeployOptions());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRawCli, setShowRawCli] = useState(false);
  const [hasBuilderProject, setHasBuilderProject] = useState(false);
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const diagnosedJobRef = useRef<string | null>(null);

  const deployReadiness = useMemo(
    () => deployOptionsReady(deployOptions, variables),
    [deployOptions, variables]
  );
  const parsedSummary = useMemo(() => parseCliSummary(cli.log), [cli.log]);

  // After a failed publish/deploy, scan the CLI output for known error
  // signatures so we can offer a real fix instead of the raw cascade.
  const failedCommand =
    cli.lastResult && !cli.lastResult.ok ? cli.lastResult.command : null;
  const diagnoses = useMemo(
    () =>
      failedCommand
        ? diagnoseDeployOutput({ command: failedCommand, output: formatRawCliLog(cli.log) })
        : [],
    [failedCommand, cli.log]
  );
  const runtimeManagerLogs = useMemo(
    () => (failedCommand ? extractRuntimeManagerLogs(cli.log) : []),
    [failedCommand, cli.log]
  );

  // Pop the diagnosis once per finished job, but leave it reopenable afterwards.
  useEffect(() => {
    if (cli.busy || diagnoses.length === 0) return;
    const jobKey = cli.jobId ?? "no-job";
    if (diagnosedJobRef.current === jobKey) return;
    diagnosedJobRef.current = jobKey;
    setShowDiagnosis(true);
  }, [cli.busy, diagnoses.length, cli.jobId]);
  useEffect(() => {
    const refreshBuilderProjectPresence = () => {
      try {
        const project = loadComposerProjectFromSession();
        setHasBuilderProject(Boolean(project && !isEffectivelyEmptyBuilderProject(project)));
      } catch {
        setHasBuilderProject(false);
      }
    };

    refreshBuilderProjectPresence();
    window.addEventListener("focus", refreshBuilderProjectPresence);
    document.addEventListener("visibilitychange", refreshBuilderProjectPresence);
    window.addEventListener("storage", refreshBuilderProjectPresence);
    return () => {
      window.removeEventListener("focus", refreshBuilderProjectPresence);
      document.removeEventListener("visibilitychange", refreshBuilderProjectPresence);
      window.removeEventListener("storage", refreshBuilderProjectPresence);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadRuntimeCli = async () => {
      setRuntimeCliLoading(true);
      try {
        const res = await fetch("/api/lifecycle/config", { cache: "no-store" });
        const data = (res.ok ? await res.json() : {}) as LifecycleConfigResponse;
        if (!cancelled) {
          setRuntimeCli(data.cli ?? null);
        }
      } catch {
        if (!cancelled) {
          setRuntimeCli(null);
        }
      } finally {
        if (!cancelled) {
          setRuntimeCliLoading(false);
        }
      }
    };
    void loadRuntimeCli();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cli.busy) {
      setActiveAction(null);
      setCancelling(false);
    }
  }, [cli.busy]);

  function requestCancel() {
    setCancelling(true);
    void cli.cancel();
  }

  function applyBundle(loaded: LoadedBundle) {
    setBundle(loaded);
    setVariables(loaded.variables);
    setDeployOptions({
      ...defaultDeployOptions(),
      properties: propertiesFromVariables(loaded.variables),
    });
    setLoadError(null);
  }

  async function loadFromComposerSession() {
    setLoadError(null);
    const project = loadComposerProjectFromSession();
    if (!project) {
      setLoadError("No Builder draft found in this browser session. Open Builder first, then try again.");
      return;
    }
    if (isEffectivelyEmptyBuilderProject(project)) {
      setLoadError("You have no project in Builder yet. Create one first, then try again.");
      return;
    }

    // Gate on the same validation Builder uses for export, so an empty or
    // incomplete draft (e.g. missing trigger) can't be sent to the CLI only to
    // fail there.
    const validation = validateProject(project);
    if (!validation.ok) {
      setLoadError(
        `Builder project isn't ready to publish: ${summarizeValidationErrors(
          validation.errors
        )}. Fix the errors in Builder, then try again.`
      );
      return;
    }
    try {
      await assertProjectAgentScriptsConform(project);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Builder project failed AgentScript conformance validation."
      );
      return;
    }

    const files = serializeProject(project);
    const entries = files.map((file) => ({
      filename: file.path,
      content: file.content,
    }));
    const exchange = entries.find((entry) => entry.filename === "exchange.json");
    if (!exchange) {
      setLoadError("Builder project is missing exchange.json.");
      return;
    }

    try {
      const parsed = JSON.parse(exchange.content) as { metadata?: { variables?: unknown }; name?: unknown; assetId?: unknown };
      const variables = flattenExchangeDeployVariables(parsed.metadata?.variables);
      const projectName =
        (typeof parsed.name === "string" && parsed.name.trim()) ||
        (typeof parsed.assetId === "string" && parsed.assetId.trim()) ||
        "Agent Network";
      applyBundle({ entries, projectName, variables });
    } catch {
      setLoadError("Builder project exchange.json is invalid JSON.");
    }
  }

  async function onZipChosen(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setLoadError(null);
    try {
      applyBundle(await readZipBundle(file));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not read that zip.");
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onPickFolder() {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await readDirectoryBundle();
      if (loaded) applyBundle(loaded);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not read that folder.");
    } finally {
      setLoading(false);
    }
  }

  async function runPublishAndDeploy() {
    if (!bundle || cli.busy) return;
    setActiveAction("publishAndDeploy");
    await cli.submit({
      command: "deploy",
      project: bundle.entries,
      deploy: deployOptions,
      variables,
    });
  }

  function run(command: CliCommand) {
    if (!bundle) return;
    setActiveAction(command);
    void cli.submit({
      command,
      project: bundle.entries,
      deploy: command === "deploy" ? deployOptions : undefined,
      variables,
    });
  }

  function runTeardown(command: "unpublish" | "undeploy", removal: RemovalOptions) {
    setActiveAction(command);
    // Teardown always names a published asset by GAV, so the worker acts on
    // Exchange directly and needs no bundle — whatever is loaded here is
    // irrelevant to it.
    void cli.submit({ command, project: [], removal });
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden />
        <div>
          <p className="font-semibold text-blue-900">Runs on the hosted lifecycle worker (Fly.io)</p>
          <p className="mt-0.5 leading-relaxed text-blue-800/90">
            Your project bundle is uploaded to the server, which runs the Anypoint CLI and streams
            results back. Authentication is handled server-side using your signed-in user token, and
            secrets are never exposed to browser JavaScript.
          </p>
          <p className="mt-2 text-xs text-blue-900/90">
            {runtimeCliLoading
              ? "Server Anypoint CLI: checking…"
              : runtimeCli?.available
                ? `Server Anypoint CLI: ${runtimeCli.version ?? "unknown version"} (${runtimeCli.cliPath ?? "default path"})`
                : `Server Anypoint CLI: unavailable${runtimeCli?.hint ? ` — ${runtimeCli.hint}` : ""}`}
          </p>
        </div>
      </div>

      {/*
        Ship and teardown sit side by side rather than stacked: they are
        independent workflows that need different inputs (deploy variables mean
        nothing to a removal), and stacking them made the page read as one long
        sequence you were meant to work through in order. Loading a project
        belongs to the ship column too — teardown never reads it.
      */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* Project bundle */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">Project</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadFromComposerSession}
                disabled={loading || cli.busy || !hasBuilderProject}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                title={
                  hasBuilderProject
                    ? "Use the current Builder draft from this browser session"
                    : "No Builder project detected yet"
                }
              >
                <Upload className="h-3.5 w-3.5" />
                Use current Builder project
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || cli.busy}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
              >
                <FileArchive className="h-3.5 w-3.5" />
                Upload .zip
              </button>
              {canPickDirectory() && (
                <button
                  type="button"
                  onClick={() => void onPickFolder()}
                  disabled={loading || cli.busy}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Choose folder…
                </button>
              )}
              {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              <span className="truncate font-mono text-xs text-gray-500">
                {bundle
                  ? `${bundle.projectName} · ${bundle.entries.length} files`
                  : "No project loaded"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => void onZipChosen(e.target.files?.[0])}
              />
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Preferred: load your current Builder draft. Upload/folder are fallback options when
              needed.
            </p>
            {loadError && <p className="mt-2 text-xs text-amber-600">{loadError}</p>}
            <CancelRunButton
              busy={cli.busy}
              cancelling={cancelling}
              onCancel={requestCancel}
              className="mt-3"
            />
          </div>

          {/* Deploy options */}
          {bundle && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">Deploy Agent Network</h3>
              <p className="mt-1 text-xs text-gray-500">
                Environment, deployment target, and variables are passed to the CLI on deploy.
              </p>
              <div className="mt-4">
                <DeployOptionsPanel
                  options={deployOptions}
                  variables={variables}
                  onChange={setDeployOptions}
                  disabled={cli.busy}
                />
              </div>
              <CancelRunButton
                busy={cli.busy}
                cancelling={cancelling}
                onCancel={requestCancel}
                className="mt-3"
              />
            </div>
          )}

          {/* Lifecycle actions */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">Lifecycle</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {COMMANDS.map(({ key, label, hint, Icon }) => {
                const isRunning = cli.running === key && activeAction !== "publishAndDeploy";
                const deployBlocked = key === "deploy" && !deployReadiness.ok;
                return (
                  <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <button
                      type="button"
                      title={deployBlocked ? deployReadiness.reason : hint}
                      onClick={() => run(key)}
                      disabled={!bundle || cli.busy || deployBlocked}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                      {label}
                    </button>
                    {key === "publish" && (
                      <ul className="mt-2 list-disc pl-4 text-[11px] text-gray-600">
                        <li>Build validates the project and generates deployment assets.</li>
                        <li>Publish pushes those assets to Exchange.</li>
                      </ul>
                    )}
                    {key === "deploy" && (
                      <ul className="mt-2 list-disc pl-4 text-[11px] text-gray-600">
                        <li>Build validates the project and generates deployment assets.</li>
                        <li>Deploy applies the network to your selected environment and gateway.</li>
                      </ul>
                    )}
                  </div>
                );
              })}

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <button
                  type="button"
                  title={
                    !deployReadiness.ok
                      ? deployReadiness.reason
                      : "Runs one deploy job (includes build and any required publish) to avoid double publish"
                  }
                  onClick={() => void runPublishAndDeploy()}
                  disabled={!bundle || cli.busy || !deployReadiness.ok}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {activeAction === "publishAndDeploy" && cli.running === "deploy" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                  Publish &amp; Deploy
                </button>
                <ul className="mt-2 list-disc pl-4 text-[11px] text-gray-600">
                  <li>Build validates the project and generates deployment assets.</li>
                  <li>Publish pushes those assets to Exchange.</li>
                  <li>Deploy applies the network to your selected environment and gateway.</li>
                </ul>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CancelRunButton busy={cli.busy} cancelling={cancelling} onCancel={requestCancel} />

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
            {!bundle && (
              <p className="mt-2 text-xs text-gray-400">Load a project to enable these actions.</p>
            )}
            {bundle && !deployReadiness.ok && (
              <p className="mt-2 text-xs text-gray-400">
                Complete deploy options above to enable Deploy.
              </p>
            )}
          </div>
        </div>

        {/*
          All teardown lives in this right column: the CLI-based teardown and
          the API-based "stubborn" teardown that removes orphans the CLI leaves
          behind (403 on MAF/agent types). Both cards are collapsed by default.
        */}
        <div className="flex flex-col gap-4">
          <TeardownPanel
            busy={cli.busy}
            runningCommand={
              cli.running === "unpublish" || cli.running === "undeploy" ? cli.running : null
            }
            onRun={runTeardown}
          />
          <StubbornTeardownPanel />
        </div>
      </div>

      {/* Activity */}
      {(cli.busy || cli.log.length > 0) && (
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
            <CancelRunButton busy={cli.busy} cancelling={cancelling} onCancel={requestCancel} />
            {diagnoses.length > 0 && !cli.busy && (
              <button
                type="button"
                onClick={() => setShowDiagnosis(true)}
                className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100"
              >
                <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                View suggested fix
              </button>
            )}
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
            className={`max-h-[72vh] min-h-[24rem] overflow-auto px-4 py-3 ${showRawCli ? "bg-gray-950" : ""}`}
          >
            {cli.busy && cli.log.length === 0 ? (
              <div className="flex h-40 items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {cli.status === "queued"
                  ? "Queued — waiting for a free slot on the lifecycle worker…"
                  : "Starting the CLI — waiting for its first output…"}
              </div>
            ) : null}
            {!showRawCli &&
              (parsedSummary.assets.length > 0 || parsedSummary.errors.length > 0) && (
                <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <p className="text-xs font-semibold text-indigo-900">Parsed summary</p>
                  {parsedSummary.assets.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {parsedSummary.assets.map((asset, index) => (
                        <p
                          key={`asset-${asset.assetId}-${asset.version ?? ""}-${index}`}
                          className="text-xs text-indigo-900"
                        >
                          <span className="font-mono">{asset.assetId}</span>
                          {asset.version ? ` v${asset.version}` : ""}
                          {asset.type ? ` · ${asset.type}` : ""}
                          {asset.action ? ` · ${asset.action}` : ""}
                          {asset.url ? (
                            <>
                              {" · "}
                              <a
                                href={asset.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline underline-offset-2"
                              >
                                Exchange link
                              </a>
                            </>
                          ) : null}
                        </p>
                      ))}
                    </div>
                  )}
                  {parsedSummary.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {parsedSummary.errors.map((error) => (
                        <p key={`error-${error.code}`} className="text-xs text-red-800">
                          Error {error.code}: {error.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
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

      {showDiagnosis && diagnoses.length > 0 && (
        <DeployDiagnosisDialog
          diagnoses={diagnoses}
          command={failedCommand}
          runtimeLogs={runtimeManagerLogs}
          onClose={() => setShowDiagnosis(false)}
        />
      )}
    </div>
  );
}
