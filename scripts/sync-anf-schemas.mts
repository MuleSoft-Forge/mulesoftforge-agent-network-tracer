#!/usr/bin/env npx tsx
/**
 * Copy official Agent Network JSON Schemas into lib/composer/schema/anf/ and
 * regenerate manifest.json with git provenance + per-file SHA-256 checksums.
 *
 * Usage:
 *   npm run sync:anf-schemas
 *   ANF_SCHEMA_SOURCE=/path/to/agent-fabric-specification npm run sync:anf-schemas
 *
 * When ANF_SCHEMA_SOURCE is unset, clones (or updates) the public upstream repo
 * into .cache/agent-fabric-specification — see ANF_BUNDLE_SOURCE.remoteUrl.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANF_BUNDLE_FILE_CONFIG,
  ANF_BUNDLE_SOURCE,
  ANF_SPEC_VERSION,
} from "../lib/composer/schema/anf/bundle-config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DEST_DIR = join(REPO_ROOT, "lib/composer/schema/anf");
const DEFAULT_CACHE_DIR = join(REPO_ROOT, ".cache/agent-fabric-specification");

interface ManifestFile {
  filename: string;
  sha256: string;
  sizeBytes: number;
  isRoot?: boolean;
}

interface AnfSchemaManifest {
  bundleVersion: number;
  specVersion: string;
  source: {
    repository: string;
    remoteUrl: string;
    subpath: string;
    commit: string | null;
    ref: string | null;
    commitDate: string | null;
    syncedAt: string;
  };
  files: ManifestFile[];
}

function git(sourceRoot: string, args: string): string | null {
  try {
    return execSync(`git -C ${JSON.stringify(sourceRoot)} ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function ensurePublicSourceCheckout(): string {
  if (existsSync(join(DEFAULT_CACHE_DIR, ".git"))) {
    console.log(`Updating cached checkout: ${DEFAULT_CACHE_DIR}`);
    execSync(`git -C ${JSON.stringify(DEFAULT_CACHE_DIR)} fetch --depth 1 origin`, {
      stdio: "inherit",
    });
    execSync(`git -C ${JSON.stringify(DEFAULT_CACHE_DIR)} reset --hard FETCH_HEAD`, {
      stdio: "inherit",
    });
    return DEFAULT_CACHE_DIR;
  }

  mkdirSync(dirname(DEFAULT_CACHE_DIR), { recursive: true });
  console.log(`Cloning ${ANF_BUNDLE_SOURCE.remoteUrl} → ${DEFAULT_CACHE_DIR}`);
  execSync(
    `git clone --depth 1 ${JSON.stringify(ANF_BUNDLE_SOURCE.remoteUrl)} ${JSON.stringify(DEFAULT_CACHE_DIR)}`,
    { stdio: "inherit" }
  );
  return DEFAULT_CACHE_DIR;
}

function resolveSourceRoot(): string {
  const explicit = process.env.ANF_SCHEMA_SOURCE?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return ensurePublicSourceCheckout();
}

function main() {
  const sourceRoot = resolveSourceRoot();
  const resourcesDir = join(sourceRoot, ANF_BUNDLE_SOURCE.subpath);

  if (!existsSync(resourcesDir)) {
    console.error(`Schema source not found: ${resourcesDir}`);
    console.error(
      "Set ANF_SCHEMA_SOURCE to a local agent-fabric-specification checkout, or allow this script to clone the public upstream repo."
    );
    process.exit(1);
  }

  mkdirSync(DEST_DIR, { recursive: true });

  const files: ManifestFile[] = [];
  for (const entry of ANF_BUNDLE_FILE_CONFIG) {
    const src = join(resourcesDir, entry.filename);
    const dest = join(DEST_DIR, entry.filename);
    if (!existsSync(src)) {
      console.error(`Missing upstream schema: ${src}`);
      process.exit(1);
    }
    cpSync(src, dest);
    const stat = readFileSync(dest);
    files.push({
      filename: entry.filename,
      sha256: createHash("sha256").update(stat).digest("hex"),
      sizeBytes: stat.length,
      ...(entry.isRoot ? { isRoot: true } : {}),
    });
    console.log(`  copied ${entry.filename} (${stat.length} bytes)`);
  }

  const manifest: AnfSchemaManifest = {
    bundleVersion: 1,
    specVersion: ANF_SPEC_VERSION,
    source: {
      ...ANF_BUNDLE_SOURCE,
      commit: git(sourceRoot, "rev-parse HEAD"),
      ref: git(sourceRoot, "rev-parse --abbrev-ref HEAD"),
      commitDate: git(sourceRoot, "log -1 --format=%cI"),
      syncedAt: new Date().toISOString(),
    },
    files,
  };

  const manifestPath = join(DEST_DIR, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${manifestPath}`);
  console.log(
    `  source commit: ${manifest.source.commit ?? "(unknown)"} @ ${manifest.source.commitDate ?? "?"}`
  );
  console.log(`  synced at:     ${manifest.source.syncedAt}`);
}

main();
