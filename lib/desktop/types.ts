/**
 * Types for the Electron desktop bridge (`window.desktop`).
 *
 * The bridge only exists in the packaged/dev desktop app. In the browser build
 * `window.desktop` is undefined, so every consumer must feature-detect — see
 * `isDesktop()` in `lib/desktop/bridge.ts`.
 */

import type { DeployOptions, ProjectDeployMeta } from "./deploy-options";

export type { DeployOptions, DeployProperty, DeployTargetKind, ProjectDeployMeta, ProjectDeployVariable } from "./deploy-options";

export interface LocalProjectFileEntry {
  filename: string;
  content: string;
}

/** Which lifecycle command to run. Mirrors the allowlist in electron/cli/runner.js. */
export type CliCommand = "build" | "publish" | "deploy";

/** Why the CLI is unavailable, when it is. */
export type CliUnavailableReason =
  | "cli-not-found"
  | "cli-not-runnable"
  | "plugin-not-installed"
  | "detect-failed";

export interface CliDetection {
  available: boolean;
  cliPath: string | null;
  version: string | null;
  pluginInstalled: boolean;
  reason: CliUnavailableReason | null;
  /** Human-readable remediation text, shown directly in the UI. */
  hint: string | null;
}

/** Label used for streamed events; includes the plugin install pseudo-command. */
export type CliRunLabel = CliCommand | "install-plugin";

/** Streamed events emitted while a command runs. */
export type CliRunEvent =
  | { runId: string; type: "start"; command: CliRunLabel; cliPath: string; commandLine: string }
  | { runId: string; type: "output"; channel: "stdout" | "stderr"; chunk: string }
  | { runId: string; type: "end"; exitCode: number | null; ok: boolean; json: unknown }
  | { runId: string; type: "error"; message: string };

export interface CliRunResult {
  runId?: string;
  ok: boolean;
  exitCode?: number | null;
  output?: string;
  json?: unknown;
  /** Set when the command could not start (CLI missing, invalid project dir, …). */
  error?: string;
  code?: CliUnavailableReason;
}

/** Result of attempting to install the agent-fabric plugin. */
export interface PluginInstallResult {
  ok: boolean;
  /** The package that succeeded, when one did. */
  pkg: string | null;
  output: string;
  /** Fresh detection after the attempt, so the UI can update without re-probing. */
  detection: CliDetection | null;
  error?: string;
  code?: CliUnavailableReason;
}

export interface DesktopAuthApi {
  /** True when the OS keychain / DPAPI backend is available. */
  encryptionAvailable(): Promise<boolean>;
  hasSavedCredentials(): Promise<boolean>;
  saveCredentials(payload: {
    username: string;
    password: string;
    region: string;
    expiresAt?: number;
  }): Promise<{ ok: boolean; error?: string }>;
  clearCredentials(): Promise<{ ok: boolean }>;
  clearAllSettings(): Promise<{ ok: boolean }>;
  notifySignOut(): Promise<{ ok: boolean }>;
}

export interface DesktopCliApi {
  detect(): Promise<CliDetection>;
  pickProject(options?: { purpose?: "open" | "save" }): Promise<string | null>;
  readProjectDeployMeta(projectDir: string): Promise<
    { ok: true; meta: ProjectDeployMeta } | { ok: false; error: string }
  >;
  readLocalProject(projectDir: string): Promise<
    { ok: true; entries: LocalProjectFileEntry[] } | { ok: false; error: string }
  >;
  writeLocalProject(
    projectDir: string,
    entries: LocalProjectFileEntry[]
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  run(
    command: CliCommand,
    projectDir: string,
    deploy?: DeployOptions
  ): Promise<CliRunResult>;
  /** Install the agent-fabric plugin; package names are fixed in the main process. */
  installPlugin(): Promise<PluginInstallResult>;
  cancel(runId: string): Promise<boolean>;
  /** Subscribe to run events; returns an unsubscribe function. */
  onEvent(listener: (event: CliRunEvent) => void): () => void;
}

export interface DesktopApi {
  isDesktop: true;
  platform: string;
  auth: DesktopAuthApi;
  cli: DesktopCliApi;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
