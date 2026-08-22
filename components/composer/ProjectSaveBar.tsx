"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FolderDown, Loader2, Download, Save } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { saveProjectToLibrary } from "@/lib/composer/project-library";
import { useLocalProjectExport } from "@/components/composer/useLocalProjectExport";
import { Button } from "@/components/composer/ui";

export default function ProjectSaveBar() {
  const { project } = useComposer();
  const { saving, error, lastSave, saveToFolder, saveAsZip, folderSaveSupported } = useLocalProjectExport();
  const [savedFlash, setSavedFlash] = useState(false);
  const [librarySave, setLibrarySave] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  useEffect(() => {
    if (!lastSave) return;
    setSavedFlash(true);
    const timer = window.setTimeout(() => setSavedFlash(false), 3500);
    return () => window.clearTimeout(timer);
  }, [lastSave]);

  useEffect(() => {
    if (!librarySave) return;
    const timer = window.setTimeout(() => setLibrarySave(null), 3500);
    return () => window.clearTimeout(timer);
  }, [librarySave]);

  function keepInBrowser() {
    const { entry, persisted } = saveProjectToLibrary(project);
    if (persisted) {
      setLibraryError(null);
      setLibrarySave(entry.project.identity.name || entry.id);
    } else {
      setLibrarySave(null);
      setLibraryError(
        "Couldn't save in this browser — storage may be full or blocked (private mode). Use Save to folder or Download .zip instead."
      );
    }
  }

  const folderTitle = saving
    ? "Saving…"
    : folderSaveSupported
      ? "Choose a folder on your machine"
      : "Folder save requires Chromium (Chrome/Edge)";
  const zipTitle = saving ? "Saving…" : "Download project as a zip file";

  return (
    <div className="mt-auto shrink-0 border-t border-gray-200 bg-gray-50 px-2 py-2.5">
      <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Save project</p>

      <div className="space-y-1.5">
        <Button
          variant="secondary"
          className="w-full"
          title="Keep this project in this browser so you can reopen it from the Projects screen"
          onClick={keepInBrowser}
        >
          <Save className="h-3.5 w-3.5" /> Save in browser
        </Button>

        <Button
          variant="primary"
          className="w-full"
          disabled={saving || !folderSaveSupported}
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
          disabled={saving}
          title={zipTitle}
          onClick={() => void saveAsZip(project)}
        >
          <Download className="h-3.5 w-3.5" /> Download .zip
        </Button>
      </div>

      {error ? <p className="mt-2 px-1 text-[10px] leading-snug text-red-600">{error}</p> : null}

      {libraryError ? (
        <p className="mt-2 px-1 text-[10px] leading-snug text-red-600">{libraryError}</p>
      ) : null}

      {librarySave ? (
        <p className="mt-2 flex items-start gap-1 px-1 text-[10px] leading-snug text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-words">
            Saved {librarySave} in this browser. Reopen it from the Projects screen.
          </span>
        </p>
      ) : null}

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
