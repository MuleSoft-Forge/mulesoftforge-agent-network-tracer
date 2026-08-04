import JSZip from "jszip";
import type { ProjectZipEntry } from "@/lib/composer/import/select-project-files";

export function normalizeProjectEntryPath(filename: string): string {
  return filename.replace(/\\/g, "/").replace(/^\/+/, "");
}

export async function buildProjectZipBlobFromEntries(entries: ProjectZipEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(normalizeProjectEntryPath(entry.filename), entry.content);
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadProjectEntriesZip(entries: ProjectZipEntry[], filename: string): void {
  void buildProjectZipBlobFromEntries(entries).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}
