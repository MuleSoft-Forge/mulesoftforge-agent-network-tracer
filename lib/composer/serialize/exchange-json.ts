import type { ComposerProject } from "@/lib/composer/model";
import { deriveDependencies, deriveVariables } from "@/lib/composer/model";

interface ExchangeVariableField {
  description?: string;
  default: string;
  secret: boolean;
}

/** Serialize the model's exchange.json projection (identity + variables + dependencies). */
export function serializeExchangeJson(project: ComposerProject): string {
  const variables = deriveVariables(project);
  const metadataVariables: Record<string, Record<string, ExchangeVariableField>> = {};
  for (const v of variables) {
    if (!metadataVariables[v.group]) metadataVariables[v.group] = {};
    metadataVariables[v.group][v.field] = {
      ...(v.description ? { description: v.description } : {}),
      default: v.default ?? "",
      secret: v.secret,
    };
  }

  const dependencies = deriveDependencies(project).map((d) => ({
    groupId: d.groupId,
    assetId: d.assetId,
    version: d.version,
    classifier: d.classifier,
    packaging: d.packaging,
  }));

  const obj: Record<string, unknown> = {
    main: "agent-network.yaml",
    name: project.identity.name,
    classifier: "agentic-network",
    organizationId: project.identity.organizationId,
    descriptorVersion: project.identity.descriptorVersion,
    tags: project.identity.tags ?? [],
    metadata: { variables: metadataVariables },
    apiVersion: project.identity.apiVersion,
    dependencies,
    groupId: project.identity.organizationId,
    assetId: project.identity.assetId,
    version: project.identity.version,
  };
  if (project.identity.description?.trim()) {
    obj.description = project.identity.description.trim();
  }

  return JSON.stringify(obj, null, 2) + "\n";
}
