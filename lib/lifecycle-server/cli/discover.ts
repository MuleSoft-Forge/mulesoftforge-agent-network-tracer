/**
 * Locate the Anypoint CLI and verify the agent-fabric plugin inside the
 * container. Simpler than the desktop discovery (electron/cli/discover.js)
 * because the image installs both globally on a known PATH — but we still probe
 * so a broken image fails a health check instead of every job.
 */

import { execFile } from "node:child_process";
import { config } from "../config";
import { withCliLock } from "./cli-lock";

const PROBE_TIMEOUT_MS = 20000;

// The CLI and agent-fabric plugin are installed into the image at build time
// and cannot change while a machine is alive, so a successful detection is
// valid for the life of the process. Re-probing on every /lifecycle and /ops
// request is exactly what let concurrent CLI spawns collide and hang, so cache
// aggressively. Failures get a short TTL so a transient stall self-heals.
const SUCCESS_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 1000;

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

async function runDetection(): Promise<CliDetection> {
  const cliPath = config.anypointCliPath;
  const abortController = new AbortController();

  return withCliLock<CliDetection>(
    abortController.signal,
    async () => {
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
    },
    () => ({
      available: false,
      cliPath,
      version: null,
      pluginInstalled: false,
      reason: "detect-failed",
      hint: "CLI detection was aborted before probe start.",
    })
  );
}

let cached: { at: number; result: CliDetection } | null = null;
let inFlight: Promise<CliDetection> | null = null;

function isFresh(entry: { at: number; result: CliDetection }): boolean {
  const ttl = entry.result.available ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
  return Date.now() - entry.at < ttl;
}

/**
 * Detect the CLI once and cache it. A successful detection is stable for the
 * life of the process (the image is immutable), so subsequent callers get an
 * instant, spawn-free answer. Concurrent callers share a single in-flight probe
 * so they can never race each other into the CLI's concurrent-launch hang.
 * Pass `{ force: true }` to bypass the cache (e.g. an explicit operator re-check).
 */
export async function detectCli(options?: { force?: boolean }): Promise<CliDetection> {
  if (!options?.force && cached && isFresh(cached)) {
    return cached.result;
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = runDetection()
    .then((result) => {
      cached = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
