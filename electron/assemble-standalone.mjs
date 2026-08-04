// Assemble a complete, runnable Next standalone build for Electron packaging.
//
// `next build` with output:"standalone" emits `.next/standalone/` containing
// server.js + a pruned node_modules, but it does NOT copy `.next/static` or
// `public/`. The server 404s on all assets without them. This script stitches
// them in and stages the result at `electron-dist/app-standalone/`, which
// electron-builder copies into the app's resources (see package.json build.files).

import { cp, rm, mkdir, access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const standaloneSrc = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const publicSrc = path.join(root, "public");

const out = path.join(root, "electron-dist", "app-standalone");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(standaloneSrc))) {
    throw new Error(
      `Missing ${standaloneSrc}. Run "npm run build" (with output:'standalone') first.`
    );
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // 1. The standalone server + its pruned node_modules + server.js.
  await cp(standaloneSrc, out, { recursive: true });

  // 2. Client assets the server serves from /_next/static.
  await cp(staticSrc, path.join(out, ".next", "static"), { recursive: true });

  // 3. Public assets (images, logos, etc).
  if (await exists(publicSrc)) {
    await cp(publicSrc, path.join(out, "public"), { recursive: true });
  }

  // 4. Bake the Anypoint credentials into the bundle so the packaged app is
  //    signed-in-ready with no per-machine setup ("hard coded" creds).
  //
  //    Copied from .env.local at BUILD time rather than written into a source
  //    file: this repo is git-tracked and deploys to Vercel, so literal secrets
  //    in source would be committed and published. electron-dist/ is gitignored.
  //    electron/env.js loads this file at runtime (bundledEnv).
  await bakeCredentials();

  console.log(`Assembled standalone build -> ${path.relative(root, out)}`);
}

/** Connected App client ids — not secret, always safe to bake. */
const CLIENT_ID_KEYS = [
  "ANYPOINT_CLIENT_ID",
  "ANYPOINT_EU_CLIENT_ID",
  "ANYPOINT_CA_CLIENT_ID",
  "ANYPOINT_JP_CLIENT_ID",
];

/**
 * Client secrets. The OAuth flow is a confidential client, so a packaged app
 * needs these to sign in without per-machine setup — but anyone holding the
 * built artifact can read them straight out of Resources/app-standalone/.env.bundled.
 * Set BAKE_CLIENT_SECRETS=0 to build a distributable artifact; users then supply
 * their own credentials via the app's userData .env (see electron/env.js).
 */
const CLIENT_SECRET_KEYS = [
  "ANYPOINT_CLIENT_SECRET",
  "ANYPOINT_EU_CLIENT_SECRET",
  "ANYPOINT_CA_CLIENT_SECRET",
  "ANYPOINT_JP_CLIENT_SECRET",
];

async function bakeCredentials() {
  const src = path.join(root, ".env.local");
  if (!(await exists(src))) {
    console.warn(
      "WARNING: no .env.local found — the packaged app will show " +
        '"(Not configured)" until credentials are added to its config .env.'
    );
    return;
  }

  const parsed = {};
  for (const rawLine of (await readFile(src, "utf8")).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) parsed[key] = value;
  }

  const bakeSecrets = process.env.BAKE_CLIENT_SECRETS === "1";
  const keys = bakeSecrets ? [...CLIENT_ID_KEYS, ...CLIENT_SECRET_KEYS] : CLIENT_ID_KEYS;
  const picked = keys.filter((k) => parsed[k]);
  if (picked.length === 0) {
    console.warn("WARNING: .env.local contains no ANYPOINT_* credentials to bake in.");
    return;
  }

  const body =
    "# Generated at build time from .env.local — do not edit, do not commit.\n" +
    picked.map((k) => `${k}=${parsed[k]}`).join("\n") +
    "\n";

  await writeFile(path.join(out, ".env.bundled"), body, { mode: 0o600 });

  // Log only the KEY NAMES; never the values.
  console.log(`Baked credentials into bundle: ${picked.join(", ")}`);

  if (picked.some((k) => CLIENT_SECRET_KEYS.includes(k))) {
    console.warn(
      "\n  ****************************************************************\n" +
        "  WARNING: this build contains Anypoint client SECRETS in plaintext\n" +
        "  at Resources/app-standalone/.env.bundled. Anyone with the artifact\n" +
        "  can extract them. Do NOT distribute this build.\n" +
        "  Rebuild with BAKE_CLIENT_SECRETS=0 to produce a shareable artifact.\n" +
        "  ****************************************************************\n"
    );
  } else {
    console.log(
      "Client secrets omitted (BAKE_CLIENT_SECRETS=0). Users must add their own\n" +
        "ANYPOINT_*_CLIENT_SECRET to the app's userData .env before signing in."
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
