"use client";

import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";
import type { ComposerProject } from "@/lib/composer/model";
import { importLocalProjectEntries } from "@/lib/composer/import/import-local-project";
import type { ProjectZipEntry } from "@/lib/composer/import/select-project-files";

export interface LocalProjectImportResult {
  project: ComposerProject;
  warnings: string[];
}

async function readZipEntries(file: File): Promise<ProjectZipEntry[]> {
  const zip = await JSZip.loadAsync(file);
  const entries: ProjectZipEntry[] = [];
  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const content = await entry.async("string");
    entries.push({ filename, content });
  }
  return entries;
}

async function readFolderEntries(files: FileList): Promise<ProjectZipEntry[]> {
  const entries: ProjectZipEntry[] = [];
  for (const file of Array.from(files)) {
    const path = file.webkitRelativePath || file.name;
    const content = await file.text();
    entries.push({ filename: path, content });
  }
  return entries;
}

export function useLocalProjectImport() {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const importEntries = useCallback(
    async (entries: ProjectZipEntry[], label: string, fallbackGroupId?: string): Promise<LocalProjectImportResult | null> => {
      setImporting(true);
      setError(null);
      try {
        const result = importLocalProjectEntries(entries, fallbackGroupId);
        setSourceLabel(label);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open local project");
        setSourceLabel(null);
        return null;
      } finally {
        setImporting(false);
      }
    },
    []
  );

  const importFromZip = useCallback(
    async (file: File, fallbackGroupId?: string) => importEntries(await readZipEntries(file), file.name, fallbackGroupId),
    [importEntries]
  );

  const importFromFolder = useCallback(
    async (files: FileList, fallbackGroupId?: string) => {
      const first = files[0];
      const label = first?.webkitRelativePath?.split("/")[0] ?? first?.name ?? "Project folder";
      return importEntries(await readFolderEntries(files), label, fallbackGroupId);
    },
    [importEntries]
  );

  function clearSelection() {
    setSourceLabel(null);
    setError(null);
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (zipInputRef.current) zipInputRef.current.value = "";
  }

  return {
    importing,
    error,
    sourceLabel,
    folderInputRef,
    zipInputRef,
    importFromZip,
    importFromFolder,
    clearSelection,
  };
}
