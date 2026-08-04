"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktop, isDesktop } from "./bridge";
import {
  defaultDeployOptions,
  deployOptionsReady,
  propertiesFromVariables,
  type DeployOptions,
  type ProjectDeployVariable,
} from "./deploy-options";
import { getLastProjectDir, setLastProjectDir } from "./last-project-path";
import type {
  CliCommand,
  CliDetection,
  CliRunEvent,
  CliRunResult,
  PluginInstallResult,
} from "./types";

export interface LogLine {
  channel: "stdout" | "stderr" | "meta";
  text: string;
}

export interface CliRunState {
  /** Command currently running, or null when idle. */
  running: CliCommand | null;
  runId: string | null;
  log: LogLine[];
  /** Result of the last completed run. */
  lastResult: (CliRunResult & { command: CliCommand }) | null;
}

const IDLE: CliRunState = { running: null, runId: null, log: [], lastResult: null };

/**
 * Drives Anypoint CLI `agent-network project build|publish|deploy` over the
 * desktop bridge, exposing detection state, a live log, and cancel.
 *
 * On the web (no bridge) `supported` is false and run() is a no-op.
 */
export function useAgentNetworkCli() {
  const supported = isDesktop();

  const [detection, setDetection] = useState<CliDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [projectVariables, setProjectVariables] = useState<ProjectDeployVariable[]>([]);
  const [projectMetaLoading, setProjectMetaLoading] = useState(false);
  const [projectMetaError, setProjectMetaError] = useState<string | null>(null);
  const [deployOptions, setDeployOptions] = useState<DeployOptions>(() => defaultDeployOptions());
  const [state, setState] = useState<CliRunState>(IDLE);
  const [projectDirSource, setProjectDirSource] = useState<"manual" | "remembered" | null>(null);

  // Keep the active runId in a ref so the event listener never goes stale.
  const runIdRef = useRef<string | null>(null);

  const appendLog = useCallback((line: LogLine) => {
    setState((prev) => ({ ...prev, log: [...prev.log, line] }));
  }, []);

  const loadProjectDeployMeta = useCallback(async (dir: string) => {
    const desktop = getDesktop();
    if (!desktop) return;
    setProjectMetaLoading(true);
    setProjectMetaError(null);
    try {
      const result = await desktop.cli.readProjectDeployMeta(dir);
      if (!result.ok) {
        setProjectVariables([]);
        setProjectMetaError(result.error);
        setDeployOptions(defaultDeployOptions());
        return;
      }
      setProjectVariables(result.meta.variables);
      setDeployOptions({
        ...defaultDeployOptions(),
        properties: propertiesFromVariables(result.meta.variables),
      });
    } finally {
      setProjectMetaLoading(false);
    }
  }, []);

  /** Re-run CLI preflight. */
  const detect = useCallback(async () => {
    const desktop = getDesktop();
    if (!desktop) return;
    setDetecting(true);
    try {
      setDetection(await desktop.cli.detect());
    } finally {
      setDetecting(false);
    }
  }, []);

  // Restore the last on-disk project opened in Builder or Lifecycle.
  useEffect(() => {
    if (!supported || projectDir) return;
    const remembered = getLastProjectDir();
    if (!remembered) return;

    const desktop = getDesktop();
    if (!desktop) return;

    let cancelled = false;
    void desktop.cli.readProjectDeployMeta(remembered).then((result) => {
      if (cancelled || !result.ok) return;
      setProjectDir(remembered);
      setProjectDirSource("remembered");
    });

    return () => {
      cancelled = true;
    };
  }, [supported, projectDir]);

  // Detect once on mount (desktop only).
  useEffect(() => {
    if (supported) void detect();
  }, [supported, detect]);

  // Load deploy variables when the project folder changes.
  useEffect(() => {
    if (!supported || !projectDir) {
      setProjectVariables([]);
      setProjectMetaError(null);
      setDeployOptions(defaultDeployOptions());
      return;
    }
    void loadProjectDeployMeta(projectDir);
  }, [supported, projectDir, loadProjectDeployMeta]);

  // Subscribe to streamed run events for the lifetime of the component.
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;

    const unsubscribe = desktop.cli.onEvent((event: CliRunEvent) => {
      switch (event.type) {
        case "start":
          runIdRef.current = event.runId;
          setState((prev) => ({
            ...prev,
            runId: event.runId,
            log: [...prev.log, { channel: "meta", text: `$ ${event.commandLine}` }],
          }));
          break;
        case "output":
          // Chunks arrive mid-line; split so the log stays line-oriented.
          setState((prev) => ({
            ...prev,
            log: [...prev.log, { channel: event.channel, text: event.chunk }],
          }));
          break;
        case "error":
          setState((prev) => ({
            ...prev,
            log: [...prev.log, { channel: "stderr", text: event.message }],
          }));
          break;
        case "end":
          setState((prev) => ({
            ...prev,
            log: [
              ...prev.log,
              {
                channel: event.ok ? "meta" : "stderr",
                text: event.ok
                  ? "✅ Completed successfully."
                  : "❌ Deployment failed.",
              },
            ],
          }));
          break;
      }
    });

    return unsubscribe;
  }, []);

  /** Open the native folder picker. */
  const chooseProject = useCallback(async () => {
    const desktop = getDesktop();
    if (!desktop) return null;
    const dir = await desktop.cli.pickProject();
    if (dir) {
      setProjectDir(dir);
      setProjectDirSource("manual");
      setLastProjectDir(dir);
    }
    return dir;
  }, []);

  /** Run one lifecycle command against the selected project. */
  const run = useCallback(
    async (command: CliCommand): Promise<CliRunResult | null> => {
      const desktop = getDesktop();
      if (!desktop || !projectDir) return null;

      if (command === "deploy") {
        const readiness = deployOptionsReady(deployOptions, projectVariables);
        if (!readiness.ok) {
          appendLog({ channel: "stderr", text: readiness.reason });
          return { ok: false, error: readiness.reason };
        }
      }

      setState({ running: command, runId: null, log: [], lastResult: null });
      try {
        const result = await desktop.cli.run(
          command,
          projectDir,
          command === "deploy" ? deployOptions : undefined
        );
        setState((prev) => ({
          ...prev,
          running: null,
          lastResult: { ...result, command },
          // Surface start-up failures (CLI missing, bad project dir) that never streamed.
          log: result.error
            ? [...prev.log, { channel: "stderr", text: result.error }]
            : prev.log,
        }));
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          running: null,
          lastResult: { command, ok: false, error: message },
          log: [...prev.log, { channel: "stderr", text: message }],
        }));
        return null;
      } finally {
        runIdRef.current = null;
      }
    },
    [projectDir, deployOptions, projectVariables, appendLog]
  );

  /**
   * Install the agent-fabric plugin, streaming progress into the same log.
   * Detection state is refreshed from the result so the UI unlocks immediately.
   */
  const installPlugin = useCallback(async (): Promise<PluginInstallResult | null> => {
    const desktop = getDesktop();
    if (!desktop) return null;

    setInstalling(true);
    setState((prev) => ({ ...prev, log: [], lastResult: null }));
    try {
      const result = await desktop.cli.installPlugin();
      if (result.detection) setDetection(result.detection);
      if (result.error) {
        appendLog({ channel: "stderr", text: result.error });
      } else if (result.ok && result.pkg) {
        appendLog({ channel: "meta", text: `✅ Installed ${result.pkg}.` });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog({ channel: "stderr", text: message });
      return null;
    } finally {
      setInstalling(false);
      runIdRef.current = null;
    }
  }, [appendLog]);

  /** Cancel the in-flight run, if any. */
  const cancel = useCallback(async () => {
    const desktop = getDesktop();
    const runId = runIdRef.current ?? state.runId;
    if (!desktop || !runId) return false;
    appendLog({ channel: "meta", text: "Cancelling…" });
    return desktop.cli.cancel(runId);
  }, [state.runId, appendLog]);

  const clearLog = useCallback(() => {
    setState((prev) => ({ ...prev, log: [], lastResult: null }));
  }, []);

  const deployReady = deployOptionsReady(deployOptions, projectVariables).ok;

  return {
    supported,
    detection,
    detecting,
    detect,
    installing,
    installPlugin,
    projectDir,
    setProjectDir,
    projectDirSource,
    chooseProject,
    projectVariables,
    projectMetaLoading,
    projectMetaError,
    deployOptions,
    setDeployOptions,
    deployReady,
    run,
    cancel,
    clearLog,
    ...state,
    busy: state.running !== null || installing,
  };
}
