import type { ActionInput, ImportedAsset } from "@/lib/composer/model";
import { mcpMetaForAsset } from "@/lib/composer/mcp-metadata";
import type { McpToolInputSchema } from "@/lib/mulesoft/exchange-asset-metadata";

/** Map JSON Schema property types to Agent Script action input types. */
export function agentScriptTypeFromJsonSchema(propertySchema: unknown): string {
  if (!propertySchema || typeof propertySchema !== "object") return "string";
  const schema = propertySchema as Record<string, unknown>;
  const type = schema.type;
  if (type === "string") return "string";
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "object") return "object";
  if (type === "array") return "array";
  return "string";
}

/** Derive `actions.<name>.inputs` from an MCP tool inputSchema (Exchange mcp-metadata). */
export function actionInputsFromMcpToolInputSchema(
  inputSchema: McpToolInputSchema | undefined
): ActionInput[] | undefined {
  if (!inputSchema || inputSchema.type !== "object") return undefined;
  const properties = inputSchema.properties;
  if (!properties || typeof properties !== "object") return undefined;

  const required = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((n): n is string => typeof n === "string")
      : []
  );

  const names = Object.keys(properties).sort((a, b) => {
    const ar = required.has(a);
    const br = required.has(b);
    if (ar !== br) return ar ? -1 : 1;
    return a.localeCompare(b);
  });

  if (names.length === 0) return undefined;

  return names.map((name) => ({
    name,
    type: agentScriptTypeFromJsonSchema(properties[name]),
  }));
}

/** Action inputs for a tool on a composed MCP asset (when Exchange metadata includes inputSchema). */
export function actionInputsForMcpTool(
  asset: ImportedAsset,
  toolName: string
): ActionInput[] | undefined {
  const meta = mcpMetaForAsset(asset);
  const tool = meta?.tools.find((t) => t.name === toolName);
  return actionInputsFromMcpToolInputSchema(tool?.inputSchema);
}
