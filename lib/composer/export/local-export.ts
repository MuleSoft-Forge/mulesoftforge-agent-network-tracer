import JSZip from "jszip";
import type { ComposerProject } from "@/lib/composer/model";
import { serializeProject, type SerializedFile } from "@/lib/composer/serialize";
import type { ProjectZipEntry } from "@/lib/composer/import/select-project-files";
import { assertProjectAgentScriptsConform } from "@/lib/composer/agentscript-conformance";
import { validateProject } from "@/lib/composer/validate";

export type ProjectSaveMethod = "directory" | "zip";

export interface ProjectSaveResult {
  method: ProjectSaveMethod;
  label: string;
  fileCount: number;
}

export function projectSerializedFiles(project: ComposerProject): SerializedFile[] {
  return serializeProject(project);
}

export function projectZipEntries(project: ComposerProject): ProjectZipEntry[] {
  return projectSerializedFiles(project).map((f) => ({ filename: f.path, content: f.content }));
}

export function defaultProjectZipName(project: ComposerProject): string {
  const assetId = project.identity.assetId?.trim();
  return assetId ? `${assetId}.zip` : "agent-network.zip";
}

function assertProjectModelValid(project: ComposerProject): void {
  const validation = validateProject(project);
  if (validation.ok) return;
  const details = validation.errors
    .slice(0, 5)
    .map((issue) => issue.message)
    .join("; ");
  const remainder =
    validation.errors.length > 5 ? `; plus ${validation.errors.length - 5} more` : "";
  throw new Error(`Project validation failed: ${details}${remainder}`);
}

export async function buildProjectZipBlob(project: ComposerProject): Promise<Blob> {
  assertProjectModelValid(project);
  await assertProjectAgentScriptsConform(project);
  const zip = new JSZip();
  for (const f of projectSerializedFiles(project)) {
    zip.file(f.path, f.content);
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadProjectZip(project: ComposerProject): Promise<ProjectSaveResult> {
  const blob = await buildProjectZipBlob(project);
  const filename = defaultProjectZipName(project);
  downloadBlob(blob, filename);
  return {
    method: "zip",
    label: filename,
    fileCount: projectSerializedFiles(project).length,
  };
}

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker: (options?: {
    mode?: "read" | "readwrite";
    id?: string;
  }) => Promise<FileSystemDirectoryHandle>;
};

async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle> {
  return (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
    mode: "readwrite",
    id: "agent-network-builder",
  });
}

async function ensureSubdirectory(
  root: FileSystemDirectoryHandle,
  pathParts: string[]
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

async function writeFileToDirectory(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  content: string
): Promise<void> {
  const norm = relativePath.replace(/\\/g, "/");
  const parts = norm.split("/");
  const fileName = parts.pop();
  if (!fileName) return;
  const dir = parts.length > 0 ? await ensureSubdirectory(root, parts) : root;
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function saveProjectToDirectory(project: ComposerProject): Promise<ProjectSaveResult> {
  if (!canPickDirectory()) {
    throw new Error(
      "Save to folder is not supported in this browser. Use Download .zip or open the app in a Chromium-based browser (Chrome/Edge)."
    );
  }

  assertProjectModelValid(project);
  await assertProjectAgentScriptsConform(project);
  const dirHandle = await pickProjectDirectory();

  const files = projectSerializedFiles(project);
  for (const f of files) {
    await writeFileToDirectory(dirHandle, f.path, f.content);
  }

  return {
    method: "directory",
    label: dirHandle.name,
    fileCount: files.length,
  };
}
