"use client";

import { useCallback, useState } from "react";
import type { ComposerProject } from "@/lib/composer/model";
import {
  canPickDirectory,
  downloadProjectZip,
  saveProjectToDirectory,
  type ProjectSaveResult,
} from "@/lib/composer/export/local-export";

export function useLocalProjectExport() {
  const folderSaveSupported = canPickDirectory();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSave, setLastSave] = useState<ProjectSaveResult | null>(null);

  const saveToFolder = useCallback(async (project: ComposerProject): Promise<ProjectSaveResult | null> => {
    setSaving(true);
    setError(null);
    try {
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

  return { saving, error, lastSave, saveToFolder, saveAsZip, folderSaveSupported };
}
