"use client";

/**
 * Turn a user-provided Agent Network project (a .zip or a picked folder) into a
 * normalized, secret-free list of file entries ready to send to the backend.
 *
 * The backend requires `exchange.json` at the bundle root, so we detect the
 * descriptor and strip any wrapping directory (e.g. `my-project/exchange.json`).
 */

import JSZip from "jszip";
import { flattenExchangeDeployVariables } from "@/lib/desktop/exchange-deploy-variables";
import type { ProjectDeployVariable } from "@/lib/desktop/deploy-options";
import type { ProjectFileEntry } from "@/lib/lifecycle/types";

const DESCRIPTOR_FILE = "exchange.json";

export interface LoadedBundle {
  entries: ProjectFileEntry[];
  projectName: string;
  variables: ProjectDeployVariable[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Strip the wrapping directory so exchange.json sits at the bundle root. */
function normalizeToDescriptorRoot(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  const descriptor = entries
    .map((e) => normalizePath(e.filename))
    .filter((p) => p === DESCRIPTOR_FILE || p.endsWith(`/${DESCRIPTOR_FILE}`))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];

  if (!descriptor) {
    throw new Error(`Bundle is missing ${DESCRIPTOR_FILE}.`);
  }

  const prefix = descriptor.slice(0, descriptor.length - DESCRIPTOR_FILE.length);
  if (!prefix) return entries.map((e) => ({ ...e, filename: normalizePath(e.filename) }));

  const rebased: ProjectFileEntry[] = [];
  for (const entry of entries) {
    const p = normalizePath(entry.filename);
    if (!p.startsWith(prefix)) continue;
    rebased.push({ filename: p.slice(prefix.length), content: entry.content });
  }
  return rebased;
}

function describeBundle(entries: ProjectFileEntry[]): LoadedBundle {
  const normalized = normalizeToDescriptorRoot(entries);
  const descriptor = normalized.find((e) => e.filename === DESCRIPTOR_FILE);
  if (!descriptor) {
    throw new Error(`Bundle is missing ${DESCRIPTOR_FILE}.`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(descriptor.content) as Record<string, unknown>;
  } catch {
    throw new Error(`${DESCRIPTOR_FILE} is not valid JSON.`);
  }

  const metadata = parsed.metadata as { variables?: unknown } | undefined;
  const variables = flattenExchangeDeployVariables(metadata?.variables);
  const projectName =
    (typeof parsed.name === "string" && parsed.name) ||
    (typeof parsed.assetId === "string" && parsed.assetId) ||
    "Agent Network";

  return { entries: normalized, projectName, variables };
}

export async function readZipBundle(file: File): Promise<LoadedBundle> {
  const zip = await JSZip.loadAsync(file);
  const entries: ProjectFileEntry[] = [];
  const files = Object.values(zip.files).filter((f) => !f.dir);
  for (const f of files) {
    const content = await f.async("string");
    entries.push({ filename: f.name, content });
  }
  return describeBundle(entries);
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function walkDirectory(
  handle: FileSystemDirectoryHandle,
  prefix: string,
  out: ProjectFileEntry[]
): Promise<void> {
  // FileSystemDirectoryHandle is async-iterable at runtime; the DOM lib types
  // don't always model `.entries()`, so we read it through a narrow cast.
  const iterable = handle as unknown as {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  for await (const [name, child] of iterable.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (child.kind === "file") {
      const file = await (child as FileSystemFileHandle).getFile();
      out.push({ filename: path, content: await file.text() });
    } else if (child.kind === "directory") {
      await walkDirectory(child as FileSystemDirectoryHandle, path, out);
    }
  }
}

export async function readDirectoryBundle(): Promise<LoadedBundle | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("This browser cannot pick folders. Upload a .zip instead.");

  let root: FileSystemDirectoryHandle;
  try {
    root = await picker({ mode: "read" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }

  const entries: ProjectFileEntry[] = [];
  await walkDirectory(root, "", entries);
  return describeBundle(entries);
}
