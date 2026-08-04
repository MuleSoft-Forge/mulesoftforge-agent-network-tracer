// Preload: the ONLY bridge between the renderer (the Next app, running as a
// normal web page) and Node/Electron.
//
// contextIsolation is on and nodeIntegration is off, so the renderer gets exactly
// the functions exposed here — no `require`, no fs, no child_process. Every
// method maps to one fixed IPC channel; the renderer can never supply argv.

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = {
  detect: "cli:detect",
  run: "cli:run",
  cancel: "cli:cancel",
  pickProject: "cli:pick-project",
  readProjectDeployMeta: "cli:read-project-deploy-meta",
  readLocalProject: "cli:read-local-project",
  writeLocalProject: "cli:write-local-project",
  installPlugin: "cli:install-plugin",
  event: "cli:event",
  authSaveCredentials: "auth:save-credentials",
  authClearCredentials: "auth:clear-credentials",
  authHasSavedCredentials: "auth:has-saved-credentials",
  authClearAllSettings: "auth:clear-all-settings",
  authNotifySignOut: "auth:notify-sign-out",
  authEncryptionAvailable: "auth:encryption-available",
};

contextBridge.exposeInMainWorld("desktop", {
  /** Marks the desktop build so web builds can feature-detect and degrade. */
  isDesktop: true,
  platform: process.platform,

  auth: {
    encryptionAvailable: () => ipcRenderer.invoke(CHANNELS.authEncryptionAvailable),
    hasSavedCredentials: () => ipcRenderer.invoke(CHANNELS.authHasSavedCredentials),
    saveCredentials: (payload) => ipcRenderer.invoke(CHANNELS.authSaveCredentials, payload),
    clearCredentials: () => ipcRenderer.invoke(CHANNELS.authClearCredentials),
    clearAllSettings: () => ipcRenderer.invoke(CHANNELS.authClearAllSettings),
    notifySignOut: () => ipcRenderer.invoke(CHANNELS.authNotifySignOut),
  },

  cli: {
    /** Preflight: is the Anypoint CLI present, runnable, and is the plugin installed? */
    detect: () => ipcRenderer.invoke(CHANNELS.detect),

    /** Native folder picker; resolves to an absolute path or null. */
    pickProject: (options) => ipcRenderer.invoke(CHANNELS.pickProject, options),

    /** Read exchange.json deploy variables from a project folder. */
    readProjectDeployMeta: (projectDir) =>
      ipcRenderer.invoke(CHANNELS.readProjectDeployMeta, projectDir),

    readLocalProject: (projectDir) =>
      ipcRenderer.invoke(CHANNELS.readLocalProject, projectDir),

    writeLocalProject: (projectDir, entries) =>
      ipcRenderer.invoke(CHANNELS.writeLocalProject, { projectDir, entries }),

    /** Run one allowlisted command. command: 'build' | 'publish' | 'deploy'. */
    run: (command, projectDir, deploy) =>
      ipcRenderer.invoke(CHANNELS.run, { command, projectDir, deploy }),

    /**
     * Install the agent-fabric plugin (package names are fixed in the main
     * process — no argument is accepted here by design).
     */
    installPlugin: () => ipcRenderer.invoke(CHANNELS.installPlugin),

    /** Cancel an in-flight run by its runId. */
    cancel: (runId) => ipcRenderer.invoke(CHANNELS.cancel, runId),

    /**
     * Subscribe to streamed run events (start / output / end / error).
     * Returns an unsubscribe function.
     */
    onEvent: (listener) => {
      if (typeof listener !== "function") return () => {};
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(CHANNELS.event, handler);
      return () => ipcRenderer.removeListener(CHANNELS.event, handler);
    },
  },
});
