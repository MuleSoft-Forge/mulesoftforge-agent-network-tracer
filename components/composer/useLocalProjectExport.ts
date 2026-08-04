"use client";

import { useCallback, useState } from "react";
import type { ComposerProject } from "@/lib/composer/model";
import {
  downloadProjectZip,
  projectZipEntries,
  saveProjectToDirectory,
  type ProjectSaveResult,
} from "@/lib/composer/export/local-export";
import { getDesktop, isDesktop } from "@/lib/desktop/bridge";
import { setLastProjectDir } from "@/lib/desktop/last-project-path";

export function useLocalProjectExport() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSave, setLastSave] = useState<ProjectSaveResult | null>(null);

  const saveToFolder = useCallback(async (project: ComposerProject): Promise<ProjectSaveResult | null> => {
    setSaving(true);
    setError(null);
    try {
      if (isDesktop()) {
        const desktop = getDesktop();
        if (!desktop) throw new Error("Desktop bridge unavailable.");

        // Always prompt — "Save to folder…" must write where the user chooses,
        // not silently reuse a path from import or Lifecycle.
        const targetDir = await desktop.cli.pickProject({ purpose: "save" });
        if (!targetDir) return null;

        const entries = projectZipEntries(project);
        const write = await desktop.cli.writeLocalProject(targetDir, entries);
        if (!write.ok) throw new Error(write.error);

        setLastProjectDir(targetDir);
        const result: ProjectSaveResult = {
          method: "directory",
          label: targetDir,
          fileCount: entries.length,
        };
        setLastSave(result);
        return result;
      }

      const result = await saveProjectToDirectory(project);
      setLastSave(result);
      return result;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return null;
      }
      setError(e instanceof Error ? e.message : "Failed to save project");
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const saveAsZip = useCallback(async (project: ComposerProject): Promise<ProjectSaveResult | null> => {
    setSaving(true);
    setError(null);
    try {
      const result = await downloadProjectZip(project);
      setLastSave(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download project");
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, error, lastSave, saveToFolder, saveAsZip };
}
