// Persist desktop Anypoint sign-in credentials in the OS secure store (Keychain /
// DPAPI) via Electron safeStorage. Passwords never touch disk in plain text.

const fs = require("node:fs");
const path = require("node:path");
const { safeStorage } = require("electron");

const CREDENTIALS_FILE = "saved-sign-in.enc";
const META_FILE = "saved-sign-in-meta.json";

function paths(configDir) {
  return {
    enc: path.join(configDir, CREDENTIALS_FILE),
    meta: path.join(configDir, META_FILE),
  };
}

function isEncryptionAvailable() {
  return safeStorage.isEncryptionAvailable();
}

/** @returns {boolean} */
function hasSavedCredentials(configDir) {
  try {
    return fs.existsSync(paths(configDir).enc);
  } catch {
    return false;
  }
}

/**
 * @param {string} configDir
 * @param {{ username: string; password: string; region: string }} creds
 */
function saveCredentials(configDir, creds) {
  if (!isEncryptionAvailable()) {
    throw new Error("Secure credential storage is not available on this system.");
  }
  const { enc } = paths(configDir);
  const payload = JSON.stringify({
    username: creds.username,
    password: creds.password,
    region: creds.region,
  });
  const encrypted = safeStorage.encryptString(payload);
  fs.writeFileSync(enc, encrypted, { mode: 0o600 });
}

/** @returns {{ username: string; password: string; region: string } | null} */
function loadCredentials(configDir) {
  const { enc } = paths(configDir);
  if (!fs.existsSync(enc) || !isEncryptionAvailable()) return null;
  try {
    const encrypted = fs.readFileSync(enc);
    const decrypted = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(decrypted);
    if (
      typeof parsed.username !== "string" ||
      typeof parsed.password !== "string" ||
      typeof parsed.region !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearCredentials(configDir) {
  for (const filePath of Object.values(paths(configDir))) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* best effort */
    }
  }
}

/**
 * @param {string} configDir
 * @param {{ expiresAt: number; username?: string; region?: string }} meta
 */
function saveMeta(configDir, meta) {
  const { meta: metaPath } = paths(configDir);
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    /* fresh meta */
  }
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ ...existing, ...meta }),
    { mode: 0o600 }
  );
}

/** @returns {{ expiresAt?: number; username?: string; region?: string } | null} */
function loadMeta(configDir) {
  try {
    return JSON.parse(fs.readFileSync(paths(configDir).meta, "utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  isEncryptionAvailable,
  hasSavedCredentials,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  saveMeta,
  loadMeta,
};
