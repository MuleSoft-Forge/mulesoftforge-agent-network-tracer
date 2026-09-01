import "server-only";
import { execFile } from "node:child_process";
import { config } from "@/lib/lifecycle-server/config";

const NPM_PACKAGE_CLI = "anypoint-cli-v4-public";
const NPM_PACKAGE_PLUGIN = "mulesoft-anypoint-cli-agent-fabric-plugin";
const PROBE_TIMEOUT_MS = 20_000;

interface ProbeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** The spawn error itself (e.g. ENOENT, timeout) — empty stdout/stderr alone can't tell those apart. */
  error: string | null;
}

export interface MulesoftVersions {
  cliPath: string;
  cliInstalledVersion: string | null;
  cliLatestVersion: string | null;
  pluginInstalledVersion: string | null;
  pluginLatestVersion: string | null;
  cliUpdateAvailable: boolean;
  pluginUpdateAvailable: boolean;
  cliDetected: boolean;
  pluginDetected: boolean;
  notes: string[];
}

function probe(command: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: PROBE_TIMEOUT_MS, shell: false, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" } },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || ""), error: error ? error.message : null });
      }
    );
  });
}

function firstLine(text: string): string | null {
  const line = text.trim().split("\n")[0]?.trim();
  return line ? line : null;
}

function normalizeVersion(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/);
  return match ? match[1] : null;
}

function compareVersions(installed: string | null, latest: string | null): boolean {
  if (!installed || !latest) return false;
  const installedParts = installed.split(".").map((part) => Number.parseInt(part, 10));
  const latestParts = latest.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < Math.max(installedParts.length, latestParts.length); i += 1) {
    const current = Number.isFinite(installedParts[i]) ? installedParts[i] : 0;
    const target = Number.isFinite(latestParts[i]) ? latestParts[i] : 0;
    if (current < target) return true;
    if (current > target) return false;
  }
  return false;
}

function parseInstalledPluginVersion(text: string): string | null {
  const value = text || "";
  const line = value
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().includes(NPM_PACKAGE_PLUGIN));
  if (!line) return null;
  const match = line.match(/(?:@|\s)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/);
  return match ? match[1] : null;
}

export async function readMulesoftVersions(): Promise<MulesoftVersions> {
  const notes: string[] = [];
  const cliPath = config.anypointCliPath;

  // anypoint-cli-v4 can't tolerate two of its own invocations starting at once on
  // the same machine — verified by reproduction, two concurrent calls reliably
  // hang until the probe timeout instead of running. Keep the two CLI probes
  // sequential; the npm registry probes are a different binary and can overlap.
  const npmProbes = Promise.all([
    probe("npm", ["view", NPM_PACKAGE_CLI, "version"]),
    probe("npm", ["view", NPM_PACKAGE_PLUGIN, "version"]),
  ]);
  const cliVersionProbe = await probe(cliPath, ["--version"]);
  const pluginListProbe = await probe(cliPath, ["plugins"]);
  const [cliLatestProbe, pluginLatestProbe] = await npmProbes;

  const cliInstalledVersion = normalizeVersion(
    firstLine(cliVersionProbe.stdout) ?? firstLine(cliVersionProbe.stderr)
  );
  const pluginInstalledVersion = parseInstalledPluginVersion(
    `${pluginListProbe.stdout}\n${pluginListProbe.stderr}`
  );
  const cliLatestVersion = normalizeVersion(firstLine(cliLatestProbe.stdout));
  const pluginLatestVersion = normalizeVersion(firstLine(pluginLatestProbe.stdout));

  if (!cliVersionProbe.ok) {
    const reason = cliVersionProbe.error ?? firstLine(cliVersionProbe.stderr) ?? "no output";
    notes.push(`CLI at "${cliPath}" did not run cleanly: ${reason}`);
  } else if (cliInstalledVersion === null) {
    notes.push(
      `CLI ran but its --version output didn't match the expected pattern: "${firstLine(cliVersionProbe.stdout) ?? firstLine(cliVersionProbe.stderr) ?? ""}"`
    );
  }
  if (!pluginListProbe.ok) {
    const reason = pluginListProbe.error ?? firstLine(pluginListProbe.stderr) ?? "no output";
    notes.push(`Could not list CLI plugins from this runtime: ${reason}`);
  } else if (pluginInstalledVersion === null) {
    notes.push(`CLI plugin list ran but didn't include ${NPM_PACKAGE_PLUGIN}.`);
  }
  if (!cliLatestProbe.ok) {
    notes.push(`Could not read latest ${NPM_PACKAGE_CLI} from npm.`);
  }
  if (!pluginLatestProbe.ok) {
    notes.push(`Could not read latest ${NPM_PACKAGE_PLUGIN} from npm.`);
  }

  return {
    cliPath,
    cliInstalledVersion,
    cliLatestVersion,
    pluginInstalledVersion,
    pluginLatestVersion,
    cliUpdateAvailable: compareVersions(cliInstalledVersion, cliLatestVersion),
    pluginUpdateAvailable: compareVersions(pluginInstalledVersion, pluginLatestVersion),
    cliDetected: cliInstalledVersion !== null,
    pluginDetected: pluginInstalledVersion !== null,
    notes,
  };
}
