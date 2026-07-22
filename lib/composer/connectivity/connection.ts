import { deriveAuthVariableBindings } from "@/lib/composer/connectivity/variable-bindings";
import type { DerivedConnectionSpec } from "@/lib/composer/connectivity/types";
import {
  CONNECTION_KIND_BY_KIND,
  connectionNameForAsset,
  registryNameForAsset,
  variableGroupForAsset,
  type ImportedAsset,
} from "@/lib/composer/model";
import { formatVariableRef } from "@/lib/composer/connectivity/variable-ref";
import type { DerivedVariable } from "@/lib/composer/model";

export function buildDerivedConnection(asset: ImportedAsset): DerivedConnectionSpec {
  const group = variableGroupForAsset(asset);
  return {
    connectionName: connectionNameForAsset(asset),
    kind: CONNECTION_KIND_BY_KIND[asset.kind],
    refName: registryNameForAsset(asset),
    refNamespace: asset.namespace || asset.groupId,
    url: formatVariableRef(group, "url"),
    authentication: asset.authentication,
    access: asset.access,
    policies: asset.policies,
  };
}

export function deriveConnectionVariablesForAsset(asset: ImportedAsset): DerivedVariable[] {
  const group = variableGroupForAsset(asset);
  const vars: DerivedVariable[] = [
    {
      group,
      field: "url",
      description: `${asset.name} URL`,
      secret: false,
      default: asset.url ?? "",
    },
  ];

  for (const binding of deriveAuthVariableBindings(asset.authentication, asset.name, group)) {
    vars.push({
      group: binding.group,
      field: binding.field,
      description: binding.description,
      secret: binding.secret,
      default: binding.default ?? "",
    });
  }

  return vars;
}
