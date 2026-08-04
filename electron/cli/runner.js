// Spawn Anypoint CLI `agent-network project …` commands from the Electron main
// process and stream their output to the renderer.
//
// SECURITY MODEL
// The renderer is a webview loading localhost. It must never be able to run an
// arbitrary command, so:
//   * only the three commands in COMMANDS may run — the renderer picks a key,
//     it never supplies argv;
//   * spawn uses shell:false, so shell metacharacters in any path are inert;
//   * projectDir must be an existing directory containing exchange.json;
//   * no user-supplied flags are forwarded.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { killTree } = require("../kill-tree");

const { detectCli, buildCliInvocation } = require("./discover");
const { appendDeployArgv } = require("./deploy-argv");

/** Descriptor file the CLI itself requires (DESCRIPTOR_FILE in the plugin). */
const DESCRIPTOR_FILE = "exchange.json";

/**
 * The agent-fabric plugin that supplies `agent-network` commands, most-current
 * first. The scoped @mulesoft/… name in the plugin's own source is not published
 * publicly; these unscoped mirrors are. Verified installable: the first entry
 * installed v1.1.0 and registered the `agent-network` topic.
 * Hardcoded (never renderer-supplied) so this can't become arbitrary install.
 */
const PLUGIN_PACKAGES = [
  "mulesoft-anypoint-cli-agent-fabric-plugin",
  "anypoint-cli-agent-fabric-plugin",
];

/**
 * The only command shapes this app may invoke. `json:true` marks commands that
 * support --json (publish sets enableJsonFlag; build does not).
 */
const COMMANDS = {
  build: { argv: ["agent-network", "project", "build"], json: false },
  publish: { argv: ["agent-network", "project", "publish"], json: true },
  deploy: { argv: ["agent-network", "project", "deploy"], json: true },
};

/** Active runs, keyed by runId, so they can be cancelled. */
const active = new Map();
let runCounter = 0;

function nextRunId() {
  runCounter += 1;
  return `run-${runCounter}`;
}

/** Validate the project directory. Throws a user-readable Error. */
function assertValidProjectDir(projectDir) {
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new Error("A project directory is required.");
  }
  if (!path.isAbsolute(projectDir)) {
    throw new Error("Project directory must be an absolute path.");
  }

  let stat;
  try {
    stat = fs.statSync(projectDir);
  } catch {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${projectDir}`);
  }
  if (!fs.existsSync(path.join(projectDir, DESCRIPTOR_FILE))) {
    throw new Error(
      `Not an Agent Network project — ${DESCRIPTOR_FILE} not found in ${projectDir}.`
    );
  }
}

/**
 * Run one CLI command, streaming output via onEvent.
 *
 * @param {'build'|'publish'|'deploy'} command
 * @param {{projectDir:string, json?:boolean, deploy?:unknown}} opts
 * @param {(evt:{runId:string,type:string,[k:string]:any})=>void} onEvent
 * @returns {Promise<{runId:string, exitCode:number|null, ok:boolean, output:string, json:any}>}
 */
async function runCommand(command, opts, onEvent) {
  const spec = COMMANDS[command];
  if (!spec) throw new Error(`Unsupported command: ${command}`);

  const projectDir = opts && opts.projectDir;
  assertValidProjectDir(projectDir);

  const detection = await detectCli();
  if (!detection.available) {
    const err = new Error(detection.hint || "Anypoint CLI is unavailable.");
    err.code = detection.reason;
    throw err;
  }

  // argv is built here, never passed in from the renderer.
  const argv = [...spec.argv, "--path", projectDir];
  if (command === "deploy") {
    if (!opts.deploy) {
      throw new Error("Deploy options are required (environment, target, and variables).");
    }
    appendDeployArgv(argv, opts.deploy);
  }
  if (spec.json && opts.json !== false) argv.push("--json");

  const runId = nextRunId();
  const emit = (evt) => {
    try {
      onEvent({ runId, ...evt });
    } catch {
      // renderer went away mid-run; keep the child's lifecycle intact
    }
  };

  return spawnStreaming({
    runId,
    emit,
    cliPath: detection.cliPath,
    argv,
    cwd: projectDir,
    command,
    parseJson: spec.json,
  });
}

/**
 * Shared spawn + stream + resolve machinery used by runCommand and installPlugin.
 * argv is always constructed by this module, never supplied by the renderer.
 */
function spawnStreaming({ runId, emit, cliPath, argv, cwd, command, parseJson }) {
  emit({
    type: "start",
    command,
    cliPath,
    // Display string only — not re-parsed or executed anywhere.
    commandLine: `${path.basename(cliPath)} ${argv.join(" ")}`,
  });

  const { executable, args: execArgs, env } = buildCliInvocation(cliPath, argv);

  const child = spawn(executable, execArgs, {
    cwd,
    shell: false, // critical: no shell interpolation
    windowsHide: true,
    env,
  });

  active.set(runId, child);

  let output = "";
  const collect = (stream, channel) => {
    if (!stream) return;
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      emit({ type: "output", channel, chunk });
    });
  };
  collect(child.stdout, "stdout");
  collect(child.stderr, "stderr");

  return new Promise((resolve) => {
    child.on("error", (err) => {
      active.delete(runId);
      emit({ type: "error", message: err.message });
      resolve({ runId, exitCode: null, ok: false, output, json: null, error: err.message });
    });

    child.on("close", (exitCode) => {
      active.delete(runId);
      const json = parseJson ? extractLastJson(output) : null;
      const ok = exitCode === 0;
      emit({ type: "end", exitCode, ok, json });
      resolve({ runId, exitCode, ok, output, json });
    });
  });
}

/**
 * Install the agent-fabric plugin so `agent-network` commands become available.
 *
 * Tries each hardcoded package name in turn (the renderer supplies nothing) and
 * stops at the first that installs AND actually registers the command topic —
 * a successful install with no `agent-network` topic still counts as failure.
 *
 * @returns {Promise<{ok:boolean, pkg:string|null, output:string, detection:any, error?:string}>}
 */
async function installPlugin(onEvent) {
  const detection = await detectCli();
  if (!detection.cliPath) {
    const err = new Error(detection.hint || "Anypoint CLI not found.");
    err.code = detection.reason;
    throw err;
  }

  let combinedOutput = "";
  let lastDetection = detection;

  for (const pkg of PLUGIN_PACKAGES) {
    const runId = nextRunId();
    const emit = (evt) => {
      try {
        onEvent({ runId, ...evt });
      } catch {
        // renderer went away; let the child finish
      }
    };

    const result = await spawnStreaming({
      runId,
      emit,
      cliPath: detection.cliPath,
      argv: ["plugins:install", pkg],
      // Install is global; run from the CLI's own directory, not a project.
      cwd: path.dirname(detection.cliPath),
      command: "install-plugin",
      parseJson: false,
    });

    combinedOutput += result.output;

    if (result.ok) {
      // Confirm the topic actually appeared — install success alone isn't proof.
      lastDetection = await detectCli();
      if (lastDetection.pluginInstalled) {
        return { ok: true, pkg, output: combinedOutput, detection: lastDetection };
      }
      emit({
        type: "output",
        channel: "stderr",
        chunk: `\nInstalled ${pkg} but 'agent-network' commands still unavailable; trying next candidate.\n`,
      });
    }
  }

  return {
    ok: false,
    pkg: null,
    output: combinedOutput,
    detection: lastDetection,
    error:
      "Could not install the agent-fabric plugin automatically. It may require access to a private MuleSoft registry — install it manually and re-check.",
  };
}

/** Pull the last top-level JSON value out of mixed log/JSON output. */
function extractLastJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  // Fast path: whole output is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to scanning
  }

  // Scan backwards for a balanced {...} or [...] block.
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") continue;
    const candidate = trimmed.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }
  return null;
}

/** Cancel a run (kills the whole process tree — the CLI spawns children). */
function cancelRun(runId) {
  const child = active.get(runId);
  if (!child || !child.pid) return false;
  killTree(child.pid);
  active.delete(runId);
  return true;
}

/** Kill everything still running (called on app quit). */
function cancelAll() {
  for (const runId of [...active.keys()]) cancelRun(runId);
}

module.exports = {
  runCommand,
  installPlugin,
  cancelRun,
  cancelAll,
  COMMANDS,
  PLUGIN_PACKAGES,
  extractLastJson,
};
