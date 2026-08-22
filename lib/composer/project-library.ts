/**
 * Multiple named projects kept in this browser, so a user can park one network
 * and open another without exporting first. This is deliberately separate from
 * session-persistence.ts: that module autosaves the one project being edited
 * (per tab), while these entries are explicit saves that survive a tab close.
 */

import { z } from "zod";
import {
  ComposerProjectSchema,
  ProjectIdentitySchema,
  toIdentifier,
  type ComposerProject,
} from "@/lib/composer/model";

const LIBRARY_KEY = "agent-network:composer-library";
export const PROJECT_LIBRARY_CHANGED_EVENT = "agent-network-composer-library-changed";

/** localStorage is a few MB; drop the oldest saves rather than failing a write. */
const MAX_ENTRIES = 25;

/** Older saves may predate a field default, so mirror the session loader's leniency. */
const LibraryProjectSchema = ComposerProjectSchema.extend({
  identity: ProjectIdentitySchema.extend({
    organizationId: z.string().default(""),
  }),
});

const LibraryEntrySchema = z.object({
  id: z.string().min(1),
  savedAt: z.string().min(1),
  project: LibraryProjectSchema,
});

export interface SavedProjectEntry {
  id: string;
  /** ISO timestamp of the save, shown so users can tell two saves apart. */
  savedAt: string;
  project: ComposerProject;
}

/**
 * Identity is the Exchange coordinate, so re-saving the same asset at the same
 * version overwrites in place while a version bump keeps both copies.
 */
export function savedProjectId(project: ComposerProject): string {
  const groupId = project.identity.organizationId?.trim() || "no-org";
  const assetId =
    project.identity.assetId?.trim() || toIdentifier(project.identity.name, "untitled");
  const version = project.identity.version?.trim() || "0.0.0";
  return `${groupId}:${assetId}:${version}`;
}

function readEntries(): SavedProjectEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validated per entry so one unreadable save does not discard the others.
    const entries: SavedProjectEntry[] = [];
    for (const candidate of parsed) {
      const result = LibraryEntrySchema.safeParse(candidate);
      if (result.success) entries.push(result.data);
    }
    return entries;
  } catch {
    return [];
  }
}

/** Returns false when the write was dropped (quota, private mode, or SSR) so callers can surface it. */
function writeEntries(entries: SavedProjectEntry[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    window.dispatchEvent(new CustomEvent(PROJECT_LIBRARY_CHANGED_EVENT));
    return true;
  } catch {
    return false; /* quota / private mode */
  }
}

/**
 * A blank project (no name and no asset id) has no stable coordinate to key on,
 * so every such save would derive the same id and silently overwrite the last
 * one. Only projects with a real identity should overwrite in place.
 */
function hasStableIdentity(project: ComposerProject): boolean {
  return Boolean(project.identity.assetId?.trim() || project.identity.name?.trim());
}

/** A collision-free id for an identity-less project, so two blanks don't clobber each other. */
function uniqueUntitledId(project: ComposerProject): string {
  const groupId = project.identity.organizationId?.trim() || "no-org";
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `${groupId}:untitled:${token}`;
}

/** Saved projects, newest first. */
export function listSavedProjects(): SavedProjectEntry[] {
  return readEntries().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export interface SaveResult {
  entry: SavedProjectEntry;
  /** false when localStorage rejected the write (quota / private mode); the UI must not claim success. */
  persisted: boolean;
}

export function saveProjectToLibrary(project: ComposerProject): SaveResult {
  const entry: SavedProjectEntry = {
    id: hasStableIdentity(project) ? savedProjectId(project) : uniqueUntitledId(project),
    savedAt: new Date().toISOString(),
    project,
  };
  const rest = readEntries().filter((candidate) => candidate.id !== entry.id);
  const persisted = writeEntries([entry, ...rest]);
  return { entry, persisted };
}

export function deleteSavedProject(id: string): void {
  const entries = readEntries();
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return;
  writeEntries(next);
}
