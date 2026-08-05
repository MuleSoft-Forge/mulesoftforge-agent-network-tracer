"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FolderDown, Loader2, Download } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { useValidationResult } from "@/lib/composer/validation/validation-context";
import { useLocalProjectExport } from "@/components/composer/useLocalProjectExport";
import { Button } from "@/components/composer/ui";

export default function ProjectSaveBar() {
  const { project } = useComposer();
  const { saving, error, lastSave, saveToFolder, saveAsZip } = useLocalProjectExport();
  const [savedFlash, setSavedFlash] = useState(false);

  const validation = useValidationResult();
  const canSave = !saving;
  const errorCount = validation.errors.length;

  useEffect(() => {
    if (!lastSave) return;
    setSavedFlash(true);
    const timer = window.setTimeout(() => setSavedFlash(false), 3500);
    return () => window.clearTimeout(timer);
  }, [lastSave]);

  const validationHint =
    errorCount > 0
      ? `${errorCount} validation error${errorCount === 1 ? "" : "s"} — you can still save to inspect or share work in progress.`
      : null;

  const folderTitle =
    validationHint ?? (saving ? "Saving…" : "Choose a folder on your machine");
  const zipTitle = validationHint ?? (saving ? "Saving…" : "Download project as a zip file");

  return (
    <div className="mt-auto shrink-0 border-t border-gray-200 bg-gray-50 px-2 py-2.5">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Save project</p>
      <p className="mb-2 px-1 text-[10px] leading-snug text-gray-500">
        Final step — write exchange.json, agent-network.yaml, and broker files locally.
      </p>

      <div className="space-y-1.5">
        <Button
          variant="primary"
          className="w-full"
          disabled={!canSave}
          title={folderTitle}
          onClick={() => void saveToFolder(project)}
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <FolderDown className="h-3.5 w-3.5" /> Save to folder…
            </>
          )}
        </Button>

        <Button
          variant="secondary"
          className="w-full"
          disabled={!canSave}
          title={zipTitle}
          onClick={() => void saveAsZip(project)}
        >
          <Download className="h-3.5 w-3.5" /> Download .zip
        </Button>
      </div>

      {validationHint ? (
        <p className="mt-2 px-1 text-[10px] leading-snug text-amber-700">{validationHint}</p>
      ) : null}

      {error ? <p className="mt-2 px-1 text-[10px] leading-snug text-red-600">{error}</p> : null}

      {savedFlash && lastSave ? (
        <p className="mt-2 flex items-start gap-1 px-1 text-[10px] leading-snug text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-all">
            {lastSave.method === "directory"
              ? `Saved ${lastSave.fileCount} file${lastSave.fileCount === 1 ? "" : "s"} to ${lastSave.label}.`
              : `Downloaded ${lastSave.label}.`}
          </span>
        </p>
      ) : null}
    </div>
  );
}
