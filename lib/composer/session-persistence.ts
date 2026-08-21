import { z } from "zod";
import {
  ComposerProjectSchema,
  ProjectIdentitySchema,
  type ComposerProject,
} from "@/lib/composer/model";

const PROJECT_KEY = "agent-network:composer-project";
const PHASE_KEY = "agent-network:composer-phase";
const DRAFT_KEY = "agent-network:composer-draft";

export type ComposerSessionPhase = "choosing" | "editing";

/** Session loads may contain legacy saves with a blank org id — keep the rest of the draft. */
const SessionProjectSchema = ComposerProjectSchema.extend({
  identity: ProjectIdentitySchema.extend({
    organizationId: z.string().default(""),
  }),
});

export function inferOrganizationId(project: ComposerProject): string {
  const fromIdentity = project.identity.organizationId?.trim();
  if (fromIdentity) return fromIdentity;
  for (const asset of project.assets) {
    const groupId = asset.groupId?.trim();
    if (groupId) return groupId;
  }
  return "";
}

function normalizeLoadedProject(project: ComposerProject): ComposerProject {
  const organizationId = inferOrganizationId(project);
  if (!organizationId || organizationId === project.identity.organizationId) {
    return project;
  }
  return {
    ...project,
    identity: { ...project.identity, organizationId },
  };
}

export function loadComposerProjectFromSession(): ComposerProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed = SessionProjectSchema.safeParse(JSON.parse(raw));
    return parsed.success ? normalizeLoadedProject(parsed.data) : null;
  } catch {
    return null;
  }
}

export function saveComposerProjectToSession(project: ComposerProject): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  } catch {
    /* quota / private mode */
  }
}

export function loadComposerPhaseFromSession(): ComposerSessionPhase | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PHASE_KEY);
    return raw === "choosing" || raw === "editing" ? raw : null;
  } catch {
    return null;
  }
}

export function saveComposerPhaseToSession(phase: ComposerSessionPhase): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PHASE_KEY, phase);
  } catch {
    /* ignore */
  }
}

export function markComposerDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function hasComposerDraft(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DRAFT_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearComposerDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function clearComposerSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PROJECT_KEY);
    window.sessionStorage.removeItem(PHASE_KEY);
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
