// Locate the Anypoint CLI and verify the agent-fabric plugin is present.
//
// Runs in the Electron MAIN process only. Detection is deliberately explicit so
// the UI can say "CLI missing" or "plugin missing" instead of surfacing a raw
// ENOENT from spawn.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CLI_BIN = "anypoint-cli-v4";
const PROBE_TIMEOUT_MS = 20000;

/** Extra places to look when PATH is missing (GUI apps on macOS don't inherit shell PATH). */
function candidateDirs() {
  const home = os.homedir();
  const dirs = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
  ];

  // nvm installs: ~/.nvm/versions/node/<version>/bin
  const nvmVersions = path.join(home, ".nvm", "versions", "node");
  try {
    for (const v of fs.readdirSync(nvmVersions)) {
      dirs.push(path.join(nvmVersions, v, "bin"));
    }
  } catch {
    // no nvm — fine
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) dirs.push(path.join(appData, "npm"));
  }

  return dirs;
}

function binaryNames() {
  return process.platform === "win32" ? [`${CLI_BIN}.cmd`, `${CLI_BIN}.exe`, CLI_BIN] : [CLI_BIN];
}

/**
 * Resolve an absolute path to the CLI binary, or null.
 * We resolve an absolute path (rather than relying on PATH at spawn time) because
 * a packaged macOS app launched from Finder has a minimal PATH.
 */
function resolveCliPath() {
  // 1. Explicit override wins — lets users point at a non-standard install.
  const override = process.env.ANYPOINT_CLI_PATH;
  if (override && fs.existsSync(override)) return override;

  // 2. Anything already on PATH.
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  for (const dir of [...pathDirs, ...candidateDirs()]) {
    for (const name of binaryNames()) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full)) return full;
      } catch {
        // unreadable dir — skip
      }
    }
  }

  return null;
}

/**
 * Resolve a Node binary to execute JS-based CLIs. GUI apps on macOS (Finder,
 * Dock) inherit a minimal PATH without nvm/fnm/homebrew, so `#!/usr/bin/env node`
 * wrappers fail with "env: node: No such file or directory" even when the CLI
 * itself was found under ~/.nvm/.../bin/.
 */
function resolveNodeBinary(cliPath) {
  const override = process.env.ANYPOINT_NODE_PATH;
  if (override && fs.existsSync(override)) return override;

  const nodeName = process.platform === "win32" ? "node.exe" : "node";

  // nvm/fnm/homebrew: node sits next to anypoint-cli-v4 in the same bin dir.
  const sibling = path.join(path.dirname(cliPath), nodeName);
  if (fs.existsSync(sibling)) return sibling;

  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...candidateDirs()]) {
    const full = path.join(dir, nodeName);
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      // unreadable dir — skip
    }
  }

  return null;
}

/** PATH + env for spawning the CLI from a packaged app (minimal inherited PATH). */
function buildCliEnv(cliPath, nodePath) {
  const prepend = new Set(
    [nodePath ? path.dirname(nodePath) : null, path.dirname(cliPath), ...candidateDirs()].filter(Boolean)
  );
  const existing = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const pathValue = [...prepend, ...existing].filter((dir, i, all) => all.indexOf(dir) === i).join(path.delimiter);

  return { ...process.env, PATH: pathValue, FORCE_COLOR: "0" };
}

/**
 * Build execFile/spawn args for a CLI shim. Uses an explicit Node binary when
 * available so we never rely on `/usr/bin/env node` + PATH.
 */
function buildCliInvocation(cliPath, args) {
  const nodePath = resolveNodeBinary(cliPath);
  const env = buildCliEnv(cliPath, nodePath);

  if (nodePath) {
    return { executable: nodePath, args: [cliPath, ...args], env, nodePath };
  }

  return { executable: cliPath, args, env, nodePath: null };
}

/** Run the CLI with fixed args and capture output. Never uses a shell. */
function probe(cliPath, args) {
  const { executable, args: execArgs, env } = buildCliInvocation(cliPath, args);

  return new Promise((resolve) => {
    execFile(
      executable,
      execArgs,
      { timeout: PROBE_TIMEOUT_MS, shell: false, windowsHide: true, env },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      }
    );
  });
}

/**
 * Full preflight.
 * @returns {Promise<{available:boolean, cliPath:string|null, version:string|null,
 *                    pluginInstalled:boolean, reason:string|null, hint:string|null}>}
 */
async function detectCli() {
  const cliPath = resolveCliPath();

  if (!cliPath) {
    return {
      available: false,
      cliPath: null,
      version: null,
      pluginInstalled: false,
      reason: "cli-not-found",
      hint: `Could not find ${CLI_BIN}. Install it with "npm i -g anypoint-cli-v4", or set ANYPOINT_CLI_PATH to its location.`,
    };
  }

  const versionProbe = await probe(cliPath, ["--version"]);
  const version = (versionProbe.stdout || versionProbe.stderr).trim().split("\n")[0] || null;

  if (!versionProbe.ok) {
    const nodePath = resolveNodeBinary(cliPath);
    const nodeHint = nodePath
      ? ""
      : " Node.js was not found on PATH (common when the app is launched from Finder). Install Node globally, or set ANYPOINT_NODE_PATH to your node binary.";
    return {
      available: false,
      cliPath,
      version,
      pluginInstalled: false,
      reason: "cli-not-runnable",
      hint: `Found ${cliPath} but it failed to run.${nodeHint} ${versionProbe.stderr.trim()}`.trim(),
    };
  }

  // The agent-fabric plugin supplies the `agent-network` command topic. When it
  // is absent the CLI prints "Command agent-network not found" — and (observed
  // on 1.6.25) still exits 0, so we must inspect the text, not just the code.
  const help = await probe(cliPath, ["agent-network", "--help"]);
  const combined = `${help.stdout}\n${help.stderr}`;
  const pluginInstalled = !/not found/i.test(combined);

  if (!pluginInstalled) {
    return {
      available: false,
      cliPath,
      version,
      pluginInstalled: false,
      reason: "plugin-not-installed",
      hint:
        "The Anypoint CLI agent-fabric plugin is not installed, so `agent-network` commands are unavailable. " +
        `Install it with "${CLI_BIN} plugins:install <agent-fabric-plugin>".`,
    };
  }

  return {
    available: true,
    cliPath,
    version,
    pluginInstalled: true,
    reason: null,
    hint: null,
  };
}

module.exports = {
  detectCli,
  resolveCliPath,
  resolveNodeBinary,
  buildCliInvocation,
  CLI_BIN,
};
