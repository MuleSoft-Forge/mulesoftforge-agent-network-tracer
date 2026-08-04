"use client";

import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";
import type { ProjectZipEntry } from "@/lib/composer/import/select-project-files";
import { filterComparableProjectEntries } from "@/lib/mulesoft/exchange-project-sources";

const BASELINE_LABEL_KEY = "composer-baseline-label";

async function readFolderEntries(files: FileList): Promise<{ entries: ProjectZipEntry[]; label: string }> {
  const list = Array.from(files);
  const first = list[0];
  const label = first?.webkitRelativePath?.split("/")[0] ?? first?.name ?? "Baseline folder";
  const entries: ProjectZipEntry[] = [];
  for (const file of list) {
    const filename = file.webkitRelativePath || file.name;
    const content = await file.text();
    entries.push({ filename, content });
  }
  return { entries, label };
}

async function readZipFile(file: File): Promise<{ entries: ProjectZipEntry[]; label: string }> {
  const zip = await JSZip.loadAsync(file);
  const entries: ProjectZipEntry[] = [];
  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    entries.push({ filename, content: await entry.async("string") });
  }
  const comparable = filterComparableProjectEntries(entries);
  if (comparable.length === 0) {
    throw new Error("Zip has no exchange.json, agent-network.yaml, or broker .agent files.");
  }
  return { entries: comparable, label: file.name.replace(/\.zip$/i, "") };
}

function assertBaselineShape(entries: ProjectZipEntry[]): void {
  if (!entries.some((e) => /exchange\.json$/i.test(e.filename) || /\.ya?ml$/i.test(e.filename))) {
    throw new Error("Baseline does not look like an agent-network project (need exchange.json or agent-network.yaml).");
  }
}

export function useBaselineFolder() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [baselineLabel, setBaselineLabel] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(BASELINE_LABEL_KEY);
  });
  const [baselineEntries, setBaselineEntries] = useState<ProjectZipEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyBaseline = useCallback((entries: ProjectZipEntry[], label: string) => {
    assertBaselineShape(entries);
    setBaselineEntries(entries);
    setBaselineLabel(label);
    window.sessionStorage.setItem(BASELINE_LABEL_KEY, label);
  }, []);

  const pickFolder = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const pickZip = useCallback(() => {
    zipInputRef.current?.click();
  }, []);

  const onFolderChange = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const { entries, label } = await readFolderEntries(files);
        applyBaseline(filterComparableProjectEntries(entries), label);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to read baseline folder");
        setBaselineEntries(null);
      } finally {
        setLoading(false);
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [applyBaseline]
  );

  const onZipChange = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setLoading(true);
      setError(null);
      try {
        const { entries, label } = await readZipFile(file);
        applyBaseline(entries, label);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to read baseline zip");
        setBaselineEntries(null);
      } finally {
        setLoading(false);
        if (zipInputRef.current) zipInputRef.current.value = "";
      }
    },
    [applyBaseline]
  );

  const clearBaseline = useCallback(() => {
    setBaselineEntries(null);
    setBaselineLabel(null);
    setError(null);
    window.sessionStorage.removeItem(BASELINE_LABEL_KEY);
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (zipInputRef.current) zipInputRef.current.value = "";
  }, []);

  return {
    folderInputRef,
    zipInputRef,
    baselineLabel,
    baselineEntries,
    loading,
    error,
    pickFolder,
    pickZip,
    onFolderChange,
    onZipChange,
    clearBaseline,
    hasBaseline: baselineEntries !== null && baselineEntries.length > 0,
  };
}
