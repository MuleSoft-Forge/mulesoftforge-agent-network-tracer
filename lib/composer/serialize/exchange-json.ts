import type { ComposerProject } from "@/lib/composer/model";
import {
  deriveDependencies,
  deriveVariables,
  isPolicyClassifier,
  POLICY_CLASSIFIER,
} from "@/lib/composer/model";
import { extractGraphLayouts, serializeBuilderMetadata } from "@/lib/composer/builder-metadata";
import { referencedPolicyBindingNames } from "@/lib/composer/connectivity/policy-bindings";
import { isFlatVariable } from "@/lib/composer/variable-keys";

interface ExchangeVariableField {
  description?: string;
  default: string;
  secret: boolean;
}

interface ExchangeDependencyEntry {
  groupId: string;
  assetId: string;
  version: string;
  classifier: string;
  packaging: string;
}

/**
 * Policy refs in context.policies require a matching exchange.json dependency.
 * We can only emit this when we know the Exchange template version.
 */
function derivePolicyDependencies(project: ComposerProject): ExchangeDependencyEntry[] {
  const out: ExchangeDependencyEntry[] = [];
  for (const bindingName of referencedPolicyBindingNames(project)) {
    const binding = project.policyBindings[bindingName];
    if (!binding) continue;
    const version = binding.templateVersion?.trim();
    if (!version) continue;
    out.push({
      groupId: binding.ref.namespace ?? project.identity.organizationId,
      assetId: binding.ref.name,
      version,
      classifier: POLICY_CLASSIFIER,
      packaging: "zip",
    });
  }
  return out;
}

/**
 * A policy is the same dependency whichever classifier wrote it (ACB's "policy",
 * our older "schema"), so imported copies collapse into the derived entry rather
 * than shipping twice.
 */
function dependencyKey(dep: ExchangeDependencyEntry): string {
  const classifier = isPolicyClassifier(dep.classifier) ? POLICY_CLASSIFIER : dep.classifier;
  return `${dep.groupId}:${dep.assetId}:${dep.version}:${classifier}:${dep.packaging}`;
}

function dedupeDependencies(deps: ExchangeDependencyEntry[]): ExchangeDependencyEntry[] {
  const seen = new Set<string>();
  const out: ExchangeDependencyEntry[] = [];
  for (const dep of deps) {
    const key = dependencyKey(dep);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dep);
  }
  return out;
}

/** Serialize the model's exchange.json projection (identity + variables + dependencies). */
export function serializeExchangeJson(project: ComposerProject): string {
  const variables = deriveVariables(project);
  const metadataVariables: Record<string, unknown> = {};
  for (const v of variables) {
    const entry: ExchangeVariableField = {
      ...(v.description ? { description: v.description } : {}),
      default: v.default ?? "",
      secret: v.secret,
    };
    if (isFlatVariable(v)) {
      metadataVariables[v.field] = entry;
      continue;
    }
    const groupObj = (metadataVariables[v.group] as Record<string, ExchangeVariableField> | undefined) ?? {};
    groupObj[v.field] = entry;
    metadataVariables[v.group] = groupObj;
  }

  const dependencies = dedupeDependencies([
    ...deriveDependencies(project),
    ...derivePolicyDependencies(project),
    ...(project.unmatchedDependencies ?? []),
  ]).map((d) => ({
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
    metadata: {
      variables: metadataVariables,
      ...serializeBuilderMetadata(extractGraphLayouts(project)),
    },
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
