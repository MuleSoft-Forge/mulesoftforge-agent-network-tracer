/**
 * Per-job workspace management. Project files arrive inline and are written to
 * an isolated temp directory that is always removed after the run.
 *
 * Filenames are untrusted: each is resolved and confirmed to stay within the
 * job directory, so a malicious "../../etc/x" entry cannot escape the sandbox.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { DESCRIPTOR_FILE } from "./security/command-allowlist";
import type { ProjectFileEntry } from "./contracts";

export interface Workspace {
  dir: string;
  cleanup: () => Promise<void>;
}

function assertSafeRelative(filename: string): string {
  const normalized = path.normalize(filename).replace(/^([/\\])+/, "");
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe project file path: ${filename}`);
  }
  return normalized;
}

/**
 * Delete job workspaces older than `maxAgeMs`.
 *
 * Per-job cleanup normally handles this, but a worker killed mid-run leaves its
 * directory behind — and build output is large enough that repeated crashes
 * would fill the disk. Returns the number of directories removed.
 */
export async function sweepStaleWorkspaces(maxAgeMs: number): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(config.workspaceRoot);
  } catch {
    return 0; // Root not created yet — nothing to sweep.
  }

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const entry of entries) {
    const target = path.join(config.workspaceRoot, entry);
    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory() || stat.mtimeMs > cutoff) continue;
      await fs.rm(target, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Raced with another cleanup, or not ours to remove — skip it.
    }
  }
  return removed;
}

/**
 * An empty job directory, for runs that act on a remote asset by coordinates
 * and so have no bundle. The CLI still needs a real cwd, and routing it through
 * the same root keeps the stale-workspace sweeper responsible for it.
 */
export async function createScratchWorkspace(jobId: string): Promise<Workspace> {
  await fs.mkdir(config.workspaceRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(config.workspaceRoot, `${jobId}-gav-`));
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function createWorkspace(jobId: string, files: ProjectFileEntry[]): Promise<Workspace> {
  await fs.mkdir(config.workspaceRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(config.workspaceRoot, `${jobId}-`));

  let sawDescriptor = false;
  for (const entry of files) {
    const rel = assertSafeRelative(entry.filename);
    if (rel === DESCRIPTOR_FILE) sawDescriptor = true;
    const target = path.join(dir, rel);
    const resolved = path.resolve(target);
    if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
      throw new Error(`Unsafe project file path: ${entry.filename}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.content, "utf8");
  }

  if (!sawDescriptor) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(`Project bundle is missing ${DESCRIPTOR_FILE}.`);
  }

  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
