import type { ProjectDeployVariable } from "@/lib/desktop/deploy-options";

type VariableLeaf = {
  description?: string;
  default?: string;
  secret?: boolean;
};

function isVariableLeaf(value: unknown): value is VariableLeaf {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return "default" in obj || "secret" in obj || "description" in obj;
}

/** Flatten nested exchange.json metadata.variables into dot-path keys. */
export function flattenExchangeDeployVariables(
  variables: unknown,
  prefix = ""
): ProjectDeployVariable[] {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) return [];

  const out: ProjectDeployVariable[] = [];
  for (const [key, value] of Object.entries(variables as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isVariableLeaf(value)) {
      out.push({
        key: path,
        description: typeof value.description === "string" ? value.description : undefined,
        default: typeof value.default === "string" ? value.default : "",
        secret: value.secret === true,
      });
      continue;
    }
    if (value && typeof value === "object") {
      out.push(...flattenExchangeDeployVariables(value, path));
    }
  }
  return out;
}
