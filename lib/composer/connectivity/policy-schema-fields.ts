/**
 * Flatten Exchange policy configuration JSON Schema into editable form fields.
 * Supports top-level primitives, enums, and one nested object level (dot paths).
 */

export interface PolicyConfigFieldSpec {
  path: string;
  label: string;
  input: "text" | "select" | "boolean";
  required: boolean;
  description?: string;
  secret?: boolean;
  options?: Array<{ value: string; label: string }>;
}

interface JsonSchemaNode {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  format?: string;
}

function schemaType(node: JsonSchemaNode): string | undefined {
  if (typeof node.type === "string") return node.type;
  if (Array.isArray(node.type)) return node.type.find((t) => t !== "null") ?? node.type[0];
  return undefined;
}

function isSecretField(path: string, node: JsonSchemaNode): boolean {
  const haystack = `${path} ${node.title ?? ""} ${node.description ?? ""}`.toLowerCase();
  return (
    node.format === "password" ||
    haystack.includes("secret") ||
    haystack.includes("password") ||
    haystack.includes("apikey") ||
    haystack.includes("api key") ||
    haystack.includes("token")
  );
}

function enumOptions(node: JsonSchemaNode): Array<{ value: string; label: string }> | undefined {
  if (!node.enum?.length) return undefined;
  return node.enum
    .filter((v): v is string | number | boolean => v !== null && v !== undefined)
    .map((v) => {
      const value = String(v);
      return { value, label: value };
    });
}

function appendFields(
  fields: PolicyConfigFieldSpec[],
  node: JsonSchemaNode,
  prefix: string,
  requiredSet: Set<string>
): void {
  const props = node.properties;
  if (!props) return;

  for (const [key, child] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const childType = schemaType(child);
    const childRequired = requiredSet.has(key);

    if (childType === "object" && child.properties) {
      const nestedRequired = new Set(child.required ?? []);
      appendFields(fields, child, path, nestedRequired);
      continue;
    }

    if (childType === "boolean") {
      fields.push({
        path,
        label: child.title ?? key,
        input: "boolean",
        required: childRequired,
        ...(child.description ? { description: child.description } : {}),
      });
      continue;
    }

    const options = enumOptions(child);
    if (options) {
      fields.push({
        path,
        label: child.title ?? key,
        input: "select",
        required: childRequired,
        options,
        ...(child.description ? { description: child.description } : {}),
        ...(isSecretField(path, child) ? { secret: true } : {}),
      });
      continue;
    }

    if (childType === "string" || childType === "number" || childType === "integer" || !childType) {
      fields.push({
        path,
        label: child.title ?? key,
        input: "text",
        required: childRequired,
        ...(child.description ? { description: child.description } : {}),
        ...(isSecretField(path, child) ? { secret: true } : {}),
      });
    }
  }
}

export function policyConfigFieldSpecs(configurationSchema: unknown): PolicyConfigFieldSpec[] {
  const root = configurationSchema as JsonSchemaNode | null;
  if (!root || typeof root !== "object") return [];
  const required = new Set(root.required ?? []);
  const fields: PolicyConfigFieldSpec[] = [];
  appendFields(fields, root, "", required);
  return fields;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readPolicyConfigField(configuration: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let cur: unknown = configuration;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === "boolean") return cur ? "true" : "false";
  if (typeof cur === "number") return String(cur);
  if (typeof cur === "string") return cur;
  return "";
}

export function writePolicyConfigField(
  configuration: Record<string, unknown>,
  path: string,
  rawValue: string,
  input: PolicyConfigFieldSpec["input"]
): Record<string, unknown> {
  const parts = path.split(".");
  const root = { ...configuration };
  let cur: Record<string, unknown> = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const existing = asRecord(cur[part]) ?? {};
    const next = { ...existing };
    cur[part] = next;
    cur = next;
  }

  const leaf = parts[parts.length - 1]!;
  if (input === "boolean") {
    cur[leaf] = rawValue === "true";
  } else if (rawValue === "") {
    delete cur[leaf];
  } else {
    cur[leaf] = rawValue;
  }
  return root;
}
