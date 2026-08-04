/**
 * Scan serialized project files for `${group.field}` deploy-variable markers and
 * flag any that aren't declared as variables. In agent-network output the
 * `${...}` syntax is exclusively the deploy-variable convention (the .agent
 * dialect uses `@` for its own references), so a plain scan is unambiguous.
 */

import type { ComposerProject } from "@/lib/composer/model";
import { deriveVariables } from "@/lib/composer/model";
import { serializeProject } from "@/lib/composer/serialize";

/** Matches `${group.field}` where the inner reference contains at least one dot. */
const MARKER_RE = /\$\{\s*([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)\s*\}/g;

export interface VariableMarker {
  /** Full `group.field` key, e.g. "orderAgent.url". */
  key: string;
  group: string;
  field: string;
  /** Files the marker was found in (relative paths), de-duped. */
  locations: string[];
}

/** Split a `group.field(.field...)` key into group (first segment) + field (rest). */
export function splitMarkerKey(key: string): { group: string; field: string } {
  const dot = key.indexOf(".");
  if (dot < 0) return { group: key, field: "" };
  return { group: key.slice(0, dot), field: key.slice(dot + 1) };
}

/** Extract all distinct `${group.field}` markers from arbitrary text files. */
export function scanVariableMarkers(
  files: ReadonlyArray<{ path: string; content: string }>
): VariableMarker[] {
  const byKey = new Map<string, VariableMarker>();
  for (const file of files) {
    MARKER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKER_RE.exec(file.content)) !== null) {
      const key = match[1];
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.locations.includes(file.path)) existing.locations.push(file.path);
        continue;
      }
      const { group, field } = splitMarkerKey(key);
      byKey.set(key, { key, group, field, locations: [file.path] });
    }
  }
  return Array.from(byKey.values());
}

/** The set of declared variable keys (`group.field`) for a project. */
export function declaredVariableKeys(project: ComposerProject): Set<string> {
  return new Set(deriveVariables(project).map((v) => `${v.group}.${v.field}`));
}

/**
 * Markers referenced in the serialized project that have no matching declared
 * variable — i.e. replacement markers the user should add to variables.
 */
export function findUndeclaredMarkers(project: ComposerProject): VariableMarker[] {
  const declared = declaredVariableKeys(project);
  const markers = scanVariableMarkers(serializeProject(project));
  return markers.filter((m) => !declared.has(m.key));
}
