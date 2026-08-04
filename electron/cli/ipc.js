// IPC surface for CLI operations. Registered once from main.js.
//
// Channels are fixed and few. There is deliberately NO generic "run" channel:
// the renderer names a command key ('build' | 'publish' | 'deploy') and a project
// directory, and nothing else.

const { ipcMain, dialog, BrowserWindow } = require("electron");

const { detectCli } = require("./discover");
const { runCommand, installPlugin, cancelRun, cancelAll } = require("./runner");
const { readProjectDeployMeta } = require("./project-meta");
const {
  readLocalProjectEntries,
  writeLocalProjectEntries,
} = require("./local-project-files");
const path = require("node:path");
const fs = require("node:fs");

const CHANNELS = {
  detect: "cli:detect",
  run: "cli:run",
  cancel: "cli:cancel",
  pickProject: "cli:pick-project",
  readProjectDeployMeta: "cli:read-project-deploy-meta",
  readLocalProject: "cli:read-local-project",
  writeLocalProject: "cli:write-local-project",
  installPlugin: "cli:install-plugin",
  event: "cli:event", // main -> renderer stream
};

const ALLOWED_COMMANDS = new Set(["build", "publish", "deploy"]);

function registerCliIpc() {
  ipcMain.handle(CHANNELS.detect, async () => {
    try {
      return await detectCli();
    } catch (err) {
      return {
        available: false,
        cliPath: null,
        version: null,
        pluginInstalled: false,
        reason: "detect-failed",
        hint: err && err.message ? err.message : "CLI detection failed.",
      };
    }
  });

  ipcMain.handle(CHANNELS.run, async (event, payload) => {
    const command = payload && payload.command;
    const projectDir = payload && payload.projectDir;
    const deploy = payload && payload.deploy;

    if (!ALLOWED_COMMANDS.has(command)) {
      return { ok: false, error: `Unsupported command: ${String(command)}` };
    }

    const sender = event.sender;
    const forward = (evt) => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.event, evt);
    };

    try {
      return await runCommand(
        command,
        { projectDir, ...(command === "deploy" ? { deploy } : {}) },
        forward
      );
    } catch (err) {
      return {
        ok: false,
        exitCode: null,
        output: "",
        json: null,
        error: err && err.message ? err.message : "Command failed to start.",
        code: err && err.code ? err.code : undefined,
      };
    }
  });

  // Install the agent-fabric plugin. Takes NO arguments — the package names are
  // hardcoded in the runner, so this can't be turned into arbitrary npm install.
  ipcMain.handle(CHANNELS.installPlugin, async (event) => {
    const sender = event.sender;
    const forward = (evt) => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.event, evt);
    };

    try {
      return await installPlugin(forward);
    } catch (err) {
      return {
        ok: false,
        pkg: null,
        output: "",
        detection: null,
        error: err && err.message ? err.message : "Plugin install failed to start.",
        code: err && err.code ? err.code : undefined,
      };
    }
  });

  ipcMain.handle(CHANNELS.cancel, async (_event, runId) => {
    if (typeof runId !== "string") return false;
    return cancelRun(runId);
  });

  // Native folder picker — the renderer cannot read the filesystem itself, so the
  // user chooses the project directory through the OS dialog.
  ipcMain.handle(CHANNELS.readProjectDeployMeta, async (_event, projectDir) => {
    if (typeof projectDir !== "string" || !projectDir.trim()) {
      return { ok: false, error: "A project directory is required." };
    }
    if (!path.isAbsolute(projectDir)) {
      return { ok: false, error: "Project directory must be an absolute path." };
    }
    try {
      const stat = fs.statSync(projectDir);
      if (!stat.isDirectory()) {
        return { ok: false, error: `Not a directory: ${projectDir}` };
      }
    } catch {
      return { ok: false, error: `Project directory does not exist: ${projectDir}` };
    }
    try {
      const meta = readProjectDeployMeta(projectDir);
      return { ok: true, meta };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : "Failed to read project deploy metadata.",
      };
    }
  });

  ipcMain.handle(CHANNELS.pickProject, async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const purpose = options && options.purpose === "save" ? "save" : "open";
    const result = await dialog.showOpenDialog(win, {
      title:
        purpose === "save"
          ? "Save Agent Network project to folder"
          : "Select Agent Network project folder",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: purpose === "save" ? "Save here" : "Select project",
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.readLocalProject, async (_event, projectDir) => {
    if (typeof projectDir !== "string" || !projectDir.trim()) {
      return { ok: false, error: "A project directory is required." };
    }
    try {
      const entries = readLocalProjectEntries(projectDir);
      return { ok: true, entries };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : "Failed to read local project.",
      };
    }
  });

  ipcMain.handle(CHANNELS.writeLocalProject, async (_event, payload) => {
    const projectDir = payload && payload.projectDir;
    const entries = payload && payload.entries;
    if (typeof projectDir !== "string" || !projectDir.trim()) {
      return { ok: false, error: "A project directory is required." };
    }
    try {
      writeLocalProjectEntries(projectDir, entries);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : "Failed to write local project.",
      };
    }
  });
}

module.exports = { registerCliIpc, cancelAll, CHANNELS };
