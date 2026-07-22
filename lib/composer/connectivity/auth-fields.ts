import type { ConnectionAuth } from "@/lib/composer/connectivity/types";
import { authFieldSpecs } from "@/lib/composer/connectivity/auth-catalog";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function setByPath(obj: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const parts = path.split(".");
  const root = { ...obj };
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const existing = asRecord(cur[part]) ?? {};
    const next = { ...existing };
    cur[part] = next;
    cur = next;
  }
  cur[parts[parts.length - 1]!] = value;
  return root;
}

function getByPath(obj: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === "string") return cur;
  return "";
}

/** Read a string field from auth for form binding. */
export function readAuthField(auth: ConnectionAuth, path: string): string {
  return getByPath(auth as unknown as Record<string, unknown>, path);
}

/** Update one auth field immutably. */
export function writeAuthField(auth: ConnectionAuth, path: string, value: string): ConnectionAuth {
  const next = setByPath({ ...auth } as unknown as Record<string, unknown>, path, value);
  return next as unknown as ConnectionAuth;
}

export function editableAuthFields(kind: ConnectionAuth["kind"]) {
  return authFieldSpecs(kind);
}
