import type { ConnectionAuth } from "@/lib/composer/connectivity/types";
import { authFieldSpecs } from "@/lib/composer/connectivity/auth-catalog";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
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
  const last = parts[parts.length - 1]!;
  if (value === "" || value === undefined) {
    delete cur[last];
  } else {
    cur[last] = value;
  }
  return root;
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function parseCommaList(raw: string): string[] | undefined {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function commaList(values: string[] | undefined): string {
  return values?.join(", ") ?? "";
}

/** Read a string field from auth for form binding. */
export function readAuthField(auth: ConnectionAuth, path: string): string {
  const value = getByPath(auth as unknown as Record<string, unknown>, path);
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return commaList(value.filter((v): v is string => typeof v === "string"));
  return "";
}

/** Update one auth field immutably. */
export function writeAuthField(
  auth: ConnectionAuth,
  path: string,
  rawValue: string,
  input?: "text" | "select" | "number" | "boolean" | "comma-list"
): ConnectionAuth {
  let value: unknown = rawValue;
  if (input === "number") {
    value = rawValue.trim() === "" ? undefined : Number(rawValue);
    if (value !== undefined && Number.isNaN(value as number)) value = undefined;
  } else if (input === "boolean") {
    value = rawValue === "true" ? true : rawValue === "false" ? false : undefined;
  } else if (input === "comma-list") {
    value = parseCommaList(rawValue);
  } else if (rawValue === "") {
    value = undefined;
  }
  const next = setByPath({ ...auth } as unknown as Record<string, unknown>, path, value);
  return next as unknown as ConnectionAuth;
}

export function editableAuthFields(kind: ConnectionAuth["kind"]) {
  return authFieldSpecs(kind);
}
