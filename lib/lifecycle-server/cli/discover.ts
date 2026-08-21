/**
 * Locate the Anypoint CLI and verify the agent-fabric plugin inside the
 * container. Simpler than the desktop discovery (electron/cli/discover.js)
 * because the image installs both globally on a known PATH — but we still probe
 * so a broken image fails a health check instead of every job.
 */

import { execFile } from "node:child_process";
import { config } from "../config";

const PROBE_TIMEOUT_MS = 20000;

export type CliUnavailableReason =
  | "cli-not-found"
  | "cli-not-runnable"
  | "plugin-not-installed"
  | "detect-failed";

export interface CliDetection {
  available: boolean;
  cliPath: string;
  version: string | null;
  pluginInstalled: boolean;
  reason: CliUnavailableReason | null;
  hint: string | null;
}

interface ProbeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function probe(cliPath: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      cliPath,
      args,
      { timeout: PROBE_TIMEOUT_MS, shell: false, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" } },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    );
  });
}

function hasAgentNetworkTopic(text: string): boolean {
  const value = String(text || "");
  return /\bagent-network\b/i.test(value) && /\b(project|setup)\b/i.test(value);
}

function hasKnownAgentFabricPlugin(text: string): boolean {
  const value = String(text || "").toLowerCase();
  return (
    value.includes("mulesoft-anypoint-cli-agent-fabric-plugin") ||
    value.includes("anypoint-cli-agent-fabric-plugin")
  );
}

export async function detectCli(): Promise<CliDetection> {
  const cliPath = config.anypointCliPath;

  const versionProbe = await probe(cliPath, ["--version"]);
  const version = (versionProbe.stdout || versionProbe.stderr).trim().split("\n")[0] || null;

  if (!versionProbe.ok) {
    return {
      available: false,
      cliPath,
      version,
      pluginInstalled: false,
      reason: "cli-not-runnable",
      hint: `Anypoint CLI at "${cliPath}" failed to run. ${versionProbe.stderr.trim()}`.trim(),
    };
  }

  const help = await probe(cliPath, ["agent-network", "--help"]);
  let pluginInstalled = hasAgentNetworkTopic(`${help.stdout}\n${help.stderr}`);
  if (!pluginInstalled) {
    const plugins = await probe(cliPath, ["plugins"]);
    pluginInstalled = plugins.ok && hasKnownAgentFabricPlugin(`${plugins.stdout}\n${plugins.stderr}`);
  }

  if (!pluginInstalled) {
    return {
      available: false,
      cliPath,
      version,
      pluginInstalled: false,
      reason: "plugin-not-installed",
      hint: "The agent-fabric plugin is not installed, so `agent-network` commands are unavailable.",
    };
  }

  return { available: true, cliPath, version, pluginInstalled: true, reason: null, hint: null };
}
