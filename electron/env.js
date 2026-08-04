// Runtime environment for the bundled Next server.
//
// The Next standalone server does NOT read .env files, and lib/session.ts throws
// unless SESSION_SECRET (>=32 chars) is set when NODE_ENV=production. A packaged
// app has neither, so the main process assembles the env itself:
//
//   1. SESSION_SECRET — generated once and persisted to userData, so sessions
//      survive restarts. Never bundled into the binary.
//   2. Anypoint credentials — read from a .env file in userData (created on first
//      run as a template), falling back to the repo's .env.local in dev.
//
// Config path: ~/Library/Application Support/Agent Network Tracer/  (macOS)
//              %APPDATA%\Agent Network Tracer\                      (Windows)

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECRET_FILE = "session-secret";
const ENV_FILE = ".env";

const ENV_TEMPLATE = `# Agent Network Tracer — local configuration
#
# Desktop sign-in uses your Anypoint username and password in the app UI.
# Connected App credentials below are optional — only needed for "Connected App
# sign-in" (SSO orgs) or if you run the web OAuth flow locally.
#
# ANYPOINT_CLIENT_ID=
# ANYPOINT_CLIENT_SECRET=
#
# EU control plane (optional):
# ANYPOINT_EU_CLIENT_ID=
# ANYPOINT_EU_CLIENT_SECRET=
`;

/** Minimal KEY=VALUE parser — no dependency, handles quotes and comments. */
function parseEnvFile(contents) {
  const out = {};
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Read (or create) the persistent session secret. */
function resolveSessionSecret(configDir) {
  const secretPath = path.join(configDir, SECRET_FILE);
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // not created yet
  }

  const secret = crypto.randomBytes(48).toString("base64url");
  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  } catch (err) {
    console.warn(`[env] Could not persist session secret: ${err.message}`);
  }
  return secret;
}

/** Load user config, creating a template on first run. */
function loadUserEnv(configDir) {
  const envPath = path.join(configDir, ENV_FILE);
  try {
    return parseEnvFile(fs.readFileSync(envPath, "utf8"));
  } catch {
    try {
      fs.writeFileSync(envPath, ENV_TEMPLATE, { mode: 0o600 });
      console.log(`[env] Created config template at ${envPath}`);
    } catch (err) {
      console.warn(`[env] Could not create config template: ${err.message}`);
    }
    return {};
  }
}

/** In dev, fall back to the repo's .env.local so nothing needs re-entering. */
function loadRepoEnvLocal(appRoot) {
  try {
    return parseEnvFile(fs.readFileSync(path.join(appRoot, ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Credentials baked into the bundle at build time by assemble-standalone.mjs.
 * This is what makes the packaged app signed-in-ready with no setup — without
 * it the control-plane picker shows "(Not configured)", because the standalone
 * server reads no .env files of its own and the repo is not present at runtime.
 */
function loadBundledEnv(standaloneDir) {
  try {
    return parseEnvFile(fs.readFileSync(path.join(standaloneDir, ".env.bundled"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Build the env for the Next server child process.
 * @param {{configDir:string, appRoot:string, port:number, host:string}} opts
 */
function buildServerEnv({ configDir, appRoot, standaloneDir, port, host }) {
  try {
    fs.mkdirSync(configDir, { recursive: true });
  } catch {
    // best effort; resolveSessionSecret will warn if unwritable
  }

  const bundledEnv = standaloneDir ? loadBundledEnv(standaloneDir) : {};
  const repoEnv = loadRepoEnvLocal(appRoot);
  const userEnv = loadUserEnv(configDir);

  return {
    ...process.env,
    // Precedence: bundled defaults < repo .env.local (dev) < user config.
    // The user's own config always wins so they can point at a different
    // Connected App without a rebuild.
    ...bundledEnv,
    ...repoEnv,
    ...userEnv,
    SESSION_SECRET: userEnv.SESSION_SECRET || resolveSessionSecret(configDir),
    ELECTRON_DESKTOP: "1",
    PORT: String(port),
    HOSTNAME: host,
    NODE_ENV: "production",
    // Electron sets this on its own process; the child is plain Node.
    ELECTRON_RUN_AS_NODE: "1",
  };
}

module.exports = { buildServerEnv, parseEnvFile, ENV_FILE };
