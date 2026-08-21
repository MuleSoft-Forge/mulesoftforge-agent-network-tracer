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
  const?: unknown;
  enum?: unknown[];
  oneOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  if?: JsonSchemaNode;
  then?: JsonSchemaNode;
  else?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  required?: string[];
  format?: string;
  default?: unknown;
}

export type PolicyConfigScaffoldMode = "required" | "defaults";

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
  if (node.enum?.length) {
    return node.enum
      .filter((v): v is string | number | boolean => v !== null && v !== undefined)
      .map((v) => {
        const value = String(v);
        return { value, label: value };
      });
  }

  // Some policy schemas (for example Client ID Enforcement) express enum-like
  // options as oneOf[{ const, title }] instead of enum[].
  const oneOf = Array.isArray(node.oneOf) ? node.oneOf : [];
  const options = oneOf
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item.const;
      if (value === null || value === undefined) return null;
      return {
        value: String(value),
        label: typeof item.title === "string" && item.title.trim() ? item.title : String(value),
      };
    })
    .filter((item): item is { value: string; label: string } => Boolean(item));

  return options.length > 0 ? options : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function schemaMatches(node: JsonSchemaNode | undefined, value: unknown): boolean {
  if (!node) return true;

  const valueType = schemaType(node);
  if (valueType === "object" && (value === null || typeof value !== "object" || Array.isArray(value))) {
    return false;
  }
  if (valueType === "string" && typeof value !== "string") return false;
  if ((valueType === "number" || valueType === "integer") && typeof value !== "number") return false;
  if (valueType === "boolean" && typeof value !== "boolean") return false;

  if (Object.prototype.hasOwnProperty.call(node, "const") && value !== node.const) return false;
  if (Array.isArray(node.enum) && node.enum.length > 0 && !node.enum.includes(value)) return false;

  const obj = asRecord(value);
  if (Array.isArray(node.required) && node.required.length > 0) {
    if (!obj) return false;
    for (const key of node.required) {
      if (typeof key !== "string" || !key.trim()) continue;
      if (!Object.prototype.hasOwnProperty.call(obj, key)) return false;
    }
  }

  if (node.properties) {
    if (!obj) return false;
    for (const [key, child] of Object.entries(node.properties)) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (!schemaMatches(child, obj[key])) return false;
    }
  }

  if (Array.isArray(node.allOf) && node.allOf.some((child) => !schemaMatches(child, value))) return false;
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0 && !node.anyOf.some((child) => schemaMatches(child, value)))
    return false;
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    const matches = node.oneOf.filter((child) => schemaMatches(child, value)).length;
    if (matches !== 1) return false;
  }

  if (node.if) {
    if (schemaMatches(node.if, value)) {
      if (node.then && !schemaMatches(node.then, value)) return false;
    } else if (node.else && !schemaMatches(node.else, value)) {
      return false;
    }
  }

  return true;
}

/**
 * Collect required property paths, including conditional requirements
 * declared under allOf/anyOf/oneOf + then/else branches.
 */
function collectRequiredPaths(
  node: JsonSchemaNode,
  prefix: string,
  out: Set<string>,
  configurationAtNode: unknown
): void {
  const props = node.properties ?? {};
  const required = Array.isArray(node.required) ? node.required : [];
  for (const key of required) {
    if (typeof key !== "string" || !key.trim()) continue;
    out.add(prefix ? `${prefix}.${key}` : key);
  }

  for (const [key, child] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const childConfig = asRecord(configurationAtNode)?.[key];
    collectRequiredPaths(child, path, out, childConfig);
  }

  for (const child of Array.isArray(node.allOf) ? node.allOf : []) {
    collectRequiredPaths(child, prefix, out, configurationAtNode);
  }

  if (Array.isArray(node.anyOf) && node.anyOf.length > 0) {
    for (const child of node.anyOf) {
      if (schemaMatches(child, configurationAtNode)) {
        collectRequiredPaths(child, prefix, out, configurationAtNode);
      }
    }
  }

  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    for (const child of node.oneOf) {
      if (schemaMatches(child, configurationAtNode)) {
        collectRequiredPaths(child, prefix, out, configurationAtNode);
      }
    }
  }

  if (node.if) {
    if (schemaMatches(node.if, configurationAtNode)) {
      if (node.then) collectRequiredPaths(node.then, prefix, out, configurationAtNode);
    } else if (node.else) {
      collectRequiredPaths(node.else, prefix, out, configurationAtNode);
    }
  }
}

function appendFields(
  fields: PolicyConfigFieldSpec[],
  node: JsonSchemaNode,
  prefix: string,
  requiredPaths: Set<string>
): void {
  const props = node.properties;
  if (!props) return;

  for (const [key, child] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const childType = schemaType(child);
    const childRequired = requiredPaths.has(path);

    if (childType === "object" && child.properties) {
      appendFields(fields, child, path, requiredPaths);
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

function appendUnsupportedPaths(out: string[], node: JsonSchemaNode, prefix: string): void {
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const childType = schemaType(child);
    if (childType === "object") {
      if (child.properties) appendUnsupportedPaths(out, child, path);
      else out.push(path);
      continue;
    }
    if (childType === "array") out.push(path);
  }
}

/**
 * Parameters the flattened form can't render — arrays (for example rate-limiting's
 * `rateLimits`) and free-form objects. They are only editable as raw YAML, so the
 * editor has to say so instead of silently dropping them.
 */
export function policyConfigUnsupportedPaths(configurationSchema: unknown): string[] {
  const root = configurationSchema as JsonSchemaNode | null;
  if (!root || typeof root !== "object") return [];
  const out: string[] = [];
  appendUnsupportedPaths(out, root, "");
  return out;
}

function schemaDefault(node: JsonSchemaNode): unknown {
  const value = node.default;
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function hasRequiredDescendant(node: JsonSchemaNode): boolean {
  const required = Array.isArray(node.required) ? node.required : [];
  if (required.length > 0) return true;
  if (node.type === "array") {
    const itemSchema = Array.isArray(node.items) ? node.items[0] : node.items;
    if (itemSchema && typeof itemSchema === "object") return hasRequiredDescendant(itemSchema);
  }
  for (const child of Object.values(node.properties ?? {})) {
    if (hasRequiredDescendant(child)) return true;
  }
  return false;
}

function placeholderForType(type: string | undefined): unknown {
  switch (type) {
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 0;
    case "array":
      return [];
    case "object":
      return {};
    case "string":
    default:
      return "";
  }
}

function buildScaffold(node: JsonSchemaNode, mode: PolicyConfigScaffoldMode): unknown {
  const defaultValue = schemaDefault(node);
  const type = schemaType(node);
  if (mode === "defaults" && defaultValue !== undefined) {
    // Some policy schemas default arrays/objects to partial shapes (for example
    // rateLimits: [{}]); enrich those defaults with required descendants so users
    // get a deployable structure immediately.
    if (type === "object" && defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
      const requiredShape = buildScaffold(node, "required");
      if (requiredShape && typeof requiredShape === "object" && !Array.isArray(requiredShape)) {
        return deepMergeScaffold(requiredShape as Record<string, unknown>, defaultValue as Record<string, unknown>);
      }
    }
    if (type === "array" && Array.isArray(defaultValue)) {
      const itemSchema = (node as { items?: JsonSchemaNode }).items;
      if (itemSchema && typeof itemSchema === "object") {
        const requiredItem = buildScaffold(itemSchema, "required");
        return defaultValue.map((item) => {
          if (item && typeof item === "object" && !Array.isArray(item) && requiredItem && typeof requiredItem === "object" && !Array.isArray(requiredItem)) {
            return deepMergeScaffold(requiredItem as Record<string, unknown>, item as Record<string, unknown>);
          }
          return item;
        });
      }
    }
    return defaultValue;
  }

  if (type === "object") {
    const props = node.properties ?? {};
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(props)) {
      const childDefault = schemaDefault(child);
      const includeByMode =
        mode === "required"
          ? required.has(key) || hasRequiredDescendant(child)
          : childDefault !== undefined || required.has(key);
      if (!includeByMode) continue;
      out[key] = buildScaffold(child, mode);
    }
    return out;
  }

  if (type === "array") {
    const itemSchema = (node as { items?: JsonSchemaNode }).items;
    if (!itemSchema || typeof itemSchema !== "object") return [];
    const item = buildScaffold(itemSchema, mode);
    return [item];
  }

  return placeholderForType(type);
}

function deepMergeScaffold(
  requiredShape: Record<string, unknown>,
  defaultsShape: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...requiredShape };
  for (const [key, value] of Object.entries(defaultsShape)) {
    const current = out[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = deepMergeScaffold(
        current as Record<string, unknown>,
        value as Record<string, unknown>
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Schema-driven starter configuration for YAML mode.
 * - `required`: minimal structure for required fields.
 * - `defaults`: required structure plus any schema defaults.
 */
export function policyConfigScaffold(
  configurationSchema: unknown,
  mode: PolicyConfigScaffoldMode
): Record<string, unknown> {
  const root = configurationSchema as JsonSchemaNode | null;
  if (!root || typeof root !== "object") return {};
  const built = buildScaffold(root, mode);
  return built && typeof built === "object" && !Array.isArray(built)
    ? (built as Record<string, unknown>)
    : {};
}

export function policyConfigFieldSpecs(
  configurationSchema: unknown,
  configuration?: Record<string, unknown>
): PolicyConfigFieldSpec[] {
  const root = configurationSchema as JsonSchemaNode | null;
  if (!root || typeof root !== "object") return [];
  const requiredPaths = new Set<string>();
  collectRequiredPaths(root, "", requiredPaths, configuration);
  const fields: PolicyConfigFieldSpec[] = [];
  appendFields(fields, root, "", requiredPaths);
  return fields;
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
