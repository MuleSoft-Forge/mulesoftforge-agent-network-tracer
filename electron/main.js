// Electron main process for Agent Network Tracer desktop.
//
// Strategy: the whole app is a server-heavy Next.js 15 app (iron-session OAuth,
// SSRF-guarded API proxies). Instead of rewriting any backend, we run the real
// Next server and point a native window at it on localhost.
//
//   dev  (ELECTRON_DEV=1): assume `next dev` is already listening on :3000.
//   prod (packaged):       spawn the compiled `standalone/server.js` on :3000
//                          using the Electron Helper binary (LSUIElement) so
//                          macOS does not show a second "exec" Dock icon.
//
// Port is PINNED to 3000 so the OAuth redirect_uri
// (http://localhost:3000/auth/callback) that the Anypoint Connected App already
// trusts keeps working unchanged.

const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("path");
const http = require("http");
const net = require("node:net");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { killTree } = require("./kill-tree");
const { getNodeExecutablePath } = require("./node-exec-path");
const { registerCliIpc, cancelAll } = require("./cli/ipc");
const { registerAuthIpc } = require("./auth-ipc");
const { buildServerEnv } = require("./env");
const { initLogging, logLine, logRaw, getLogPath } = require("./log");

const PORT = 3000;
const HOST = "127.0.0.1";
const BASE_URL = `http://localhost:${PORT}`;
const isDev = process.env.ELECTRON_DEV === "1";

let mainWindow = null;
let serverProcess = null;
/** @type {ReturnType<typeof registerAuthIpc> | null} */
let authManager = null;
/** Set once we are tearing down, so an expected server exit stays quiet. */
let quitting = false;

/** Poll the server until it answers, so we don't load a blank window. */
function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server at ${url} did not start within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

/**
 * Resolve true when nothing is listening on host:port.
 *
 * The port is pinned (OAuth redirect_uri), and waitForServer accepts any HTTP
 * response, so an unrelated process on 3000 would leave the window pointed at
 * a stranger's app that looks like ours. Fail loudly instead.
 */
function isPortFree(host, port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, host);
  });
}

/** In packaged mode, spawn the Next standalone server as a child process. */
function startNextServer() {
  if (isDev) return; // `next dev` is started separately by the npm script

  // In the packaged app, resources live under process.resourcesPath.
  // We copy the standalone build to resources/app-standalone (see build script).
  const standaloneDir = path.join(process.resourcesPath, "app-standalone");
  const serverEntry = path.join(standaloneDir, "server.js");

  // Assemble env (SESSION_SECRET + Anypoint creds) — the standalone server does
  // not read .env files itself, and session.ts throws without SESSION_SECRET.
  const env = buildServerEnv({
    configDir: app.getPath("userData"),
    appRoot: app.getAppPath(),
    standaloneDir,
    port: PORT,
    host: HOST,
  });

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Bundled server missing at ${serverEntry}. The app package is incomplete.`);
  }

  const nodeExec = getNodeExecutablePath();
  logLine(`[next-server] spawning ${serverEntry} on ${HOST}:${PORT} via ${nodeExec}`);
  serverProcess = spawn(nodeExec, [serverEntry], {
    cwd: standaloneDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", logRaw);
  serverProcess.stderr.on("data", logRaw);

  serverProcess.on("error", (err) => {
    logLine(`[next-server] failed to spawn: ${err.message}`);
  });

  serverProcess.on("spawn", () => {
    logLine(`[next-server] spawned pid=${serverProcess.pid ?? "unknown"}`);
  });

  serverProcess.on("exit", (code, signal) => {
    logLine(`[next-server] exited code=${code} signal=${signal ?? "none"}`);
    serverProcess = null;
    // The window would otherwise sit there showing a dead backend, with every
    // interaction failing for no visible reason.
    if (!quitting) {
      dialog.showErrorBox(
        "Agent Network Tracer stopped",
        `The local server exited unexpectedly (code ${code ?? "unknown"}).\n\n` +
          `Details were written to:\n${getLogPath() ?? "(log unavailable)"}\n\nPlease restart the app.`
      );
      app.quit();
    }
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Agent Network Tracer",
    backgroundColor: "#0b0d12",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open target=_blank / external links in the system browser, not new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  // setWindowOpenHandler only covers new windows. Without this, anything that
  // sets window.location could navigate the main frame off localhost, leaving
  // a remote page running behind our preload bridge.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(BASE_URL)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  await waitForServer(BASE_URL);
  if (authManager) {
    await authManager.trySilentStartupLogin();
  }
  await mainWindow.loadURL(BASE_URL);
  mainWindow.show();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Log to a file first: from here on, a failure must never be silent. Launched
  // from Finder there is no terminal, so console output alone is invisible.
  initLogging(app.getPath("logs"));
  logLine(`[app] starting ${app.getVersion()} dev=${isDev} resources=${process.resourcesPath}`);

  try {
    registerCliIpc();
    authManager = registerAuthIpc({
      configDir: app.getPath("userData"),
      port: PORT,
      logLine,
    });
    if (!isDev && !(await isPortFree(HOST, PORT))) {
      throw new Error(
        `Port ${PORT} is already in use by another process.\n\n` +
          `Agent Network Tracer must use this port because the Anypoint sign-in ` +
          `redirect is registered against http://localhost:${PORT}. Quit whatever ` +
          `is using it (including another copy of this app) and try again.`
      );
    }
    startNextServer(); // must be inside the try — it throws if the bundle is incomplete
    await createWindow();
    logLine("[app] window ready");
  } catch (err) {
    const detail = err && err.stack ? err.stack : String(err);
    logLine(`[app] FAILED TO START: ${detail}`);
    shutdown();
    // Tell the user instead of vanishing, and point at the log for the details.
    dialog.showErrorBox(
      "Agent Network Tracer could not start",
      `${err && err.message ? err.message : String(err)}\n\nDetails were written to:\n${getLogPath() ?? "(log unavailable)"}`
    );
    app.exit(1);
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    // Reopening from the Dock can fail if the server died; don't let that
    // surface as an unhandled rejection.
    createWindow().catch((err) => {
      logLine(`[app] reopen failed: ${err && err.stack ? err.stack : String(err)}`);
      dialog.showErrorBox(
        "Agent Network Tracer could not reopen",
        `${err && err.message ? err.message : String(err)}\n\nDetails were written to:\n${getLogPath() ?? "(log unavailable)"}`
      );
    });
  });
});

function shutdown() {
  quitting = true;
  // Kill any in-flight CLI runs first so they don't outlive the window.
  try {
    cancelAll();
  } catch {
    // best effort
  }
  if (serverProcess?.pid) {
    killTree(serverProcess.pid);
    serverProcess = null;
  }
}

app.on("window-all-closed", () => {
  shutdown();
  // Quit on all platforms. This is a single-window app with a bundled localhost
  // server — leaving the process in the Dock after closing the window is confusing
  // and the server is already torn down here anyway.
  app.quit();
});

app.on("before-quit", shutdown);
process.on("exit", shutdown);
