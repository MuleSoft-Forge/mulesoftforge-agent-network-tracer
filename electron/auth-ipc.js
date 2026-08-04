// Desktop auth IPC — secure credential storage and silent token refresh.

const { ipcMain } = require("electron");
const {
  isEncryptionAvailable,
  hasSavedCredentials,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  saveMeta,
} = require("./credentials");
const {
  REFRESH_BUFFER_MS,
  loginViaLocalServer,
  clearSessionCookie,
} = require("./session-refresh");

const CHANNELS = {
  saveCredentials: "auth:save-credentials",
  clearCredentials: "auth:clear-credentials",
  hasSavedCredentials: "auth:has-saved-credentials",
  clearAllSettings: "auth:clear-all-settings",
  notifySignOut: "auth:notify-sign-out",
  encryptionAvailable: "auth:encryption-available",
};

/** When true, skip silent login/refresh until the next successful manual sign-in. */
let signedOutThisSession = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;

/**
 * @param {{ configDir: string; port: number; logLine: (msg: string) => void }} opts
 */
function registerAuthIpc({ configDir, port, logLine }) {
  function stopRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  /**
   * @param {number} expiresAt
   */
  function scheduleRefresh(expiresAt) {
    stopRefreshTimer();
    if (signedOutThisSession || !hasSavedCredentials(configDir)) return;

    saveMeta(configDir, { expiresAt });
    const refreshAt = expiresAt - REFRESH_BUFFER_MS;
    const delay = Math.max(refreshAt - Date.now(), 15_000);

    refreshTimer = setTimeout(() => {
      void performSilentLogin("refresh").catch(() => {
        /* logged inside performSilentLogin */
      });
    }, delay);

    logLine(
      `[auth] next silent refresh in ${Math.round(delay / 60000)} min (expiresAt=${new Date(expiresAt).toISOString()})`
    );
  }

  /**
   * @param {"startup" | "refresh" | "save"} reason
   * @returns {Promise<boolean>}
   */
  async function performSilentLogin(reason) {
    if (signedOutThisSession) return false;
    const creds = loadCredentials(configDir);
    if (!creds) return false;

    try {
      const result = await loginViaLocalServer(port, creds);
      signedOutThisSession = false;
      saveMeta(configDir, {
        expiresAt: result.expiresAt,
        username: creds.username,
        region: creds.region,
      });
      scheduleRefresh(result.expiresAt);
      logLine(`[auth] silent ${reason} login ok`);
      return true;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      logLine(`[auth] silent ${reason} login failed: ${message}`);
      if (reason === "refresh") {
        // Retry once in five minutes — password may have changed or network blip.
        refreshTimer = setTimeout(() => {
          void performSilentLogin("refresh");
        }, 5 * 60 * 1000);
      }
      return false;
    }
  }

  ipcMain.handle(CHANNELS.encryptionAvailable, () => isEncryptionAvailable());

  ipcMain.handle(CHANNELS.hasSavedCredentials, () => hasSavedCredentials(configDir));

  ipcMain.handle(CHANNELS.saveCredentials, (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Invalid payload" };
    }
    const username = typeof payload.username === "string" ? payload.username.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const region = typeof payload.region === "string" ? payload.region : "";
    const expiresAt =
      typeof payload.expiresAt === "number" && payload.expiresAt > Date.now()
        ? payload.expiresAt
        : null;

    if (!username || !password || !region) {
      return { ok: false, error: "Missing username, password, or region" };
    }

    try {
      saveCredentials(configDir, { username, password, region });
      signedOutThisSession = false;
      if (expiresAt) {
        scheduleRefresh(expiresAt);
      }
      logLine("[auth] saved credentials to OS secure storage");
      return { ok: true };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.clearCredentials, async () => {
    stopRefreshTimer();
    clearCredentials(configDir);
    logLine("[auth] cleared saved credentials");
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.notifySignOut, () => {
    signedOutThisSession = true;
    stopRefreshTimer();
    logLine("[auth] sign-out — silent refresh paused until next manual sign-in");
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.clearAllSettings, async () => {
    signedOutThisSession = false;
    stopRefreshTimer();
    clearCredentials(configDir);
    try {
      await clearSessionCookie(port);
    } catch (err) {
      logLine(
        `[auth] clear session cookie failed: ${err && err.message ? err.message : String(err)}`
      );
    }
    logLine("[auth] cleared all saved desktop settings");
    return { ok: true };
  });

  return {
    trySilentStartupLogin: () => performSilentLogin("startup"),
    scheduleRefresh,
    stopRefreshTimer,
  };
}

module.exports = { registerAuthIpc, CHANNELS };
