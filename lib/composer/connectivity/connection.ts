import { deriveAuthVariableBindings } from "@/lib/composer/connectivity/variable-bindings";
import type { DerivedConnectionSpec } from "@/lib/composer/connectivity/types";
import {
  CONNECTION_KIND_BY_KIND,
  connectionNameForAsset,
  registryNameForAsset,
  variableGroupForAsset,
  type ImportedAsset,
} from "@/lib/composer/model";
import { formatVariableRef, isVariableRef, parseVariableRef } from "@/lib/composer/connectivity/variable-ref";
import type { DerivedVariable } from "@/lib/composer/model";

function connectionUrlExpression(asset: ImportedAsset): string {
  if (asset.urlRef && isVariableRef(asset.urlRef)) return asset.urlRef;
  if (asset.literalConnectionUrl) return asset.literalConnectionUrl;
  return formatVariableRef(variableGroupForAsset(asset), "url");
}

export function buildDerivedConnection(asset: ImportedAsset): DerivedConnectionSpec {
  return {
    connectionName: connectionNameForAsset(asset),
    kind: CONNECTION_KIND_BY_KIND[asset.kind],
    refName: registryNameForAsset(asset),
    refNamespace: asset.namespace || asset.groupId,
    url: connectionUrlExpression(asset),
    authentication: asset.authentication,
    access: asset.access,
    policies: asset.policies,
  };
}

export function deriveConnectionVariablesForAsset(asset: ImportedAsset): DerivedVariable[] {
  const vars: DerivedVariable[] = [];
  const seen = new Set<string>();

  function pushVariable(v: DerivedVariable): void {
    const key = `${v.group}.${v.field}`;
    if (seen.has(key)) return;
    seen.add(key);
    vars.push(v);
  }

  if (!asset.literalConnectionUrl) {
    const urlExpr = connectionUrlExpression(asset);
    const urlRef = parseVariableRef(urlExpr);
    if (urlRef) {
      pushVariable({
        group: urlRef.group,
        field: urlRef.field,
        description: `${asset.name} ${urlRef.field}`,
        secret: false,
        default: asset.url ?? "",
      });
    } else if (asset.url) {
      const group = variableGroupForAsset(asset);
      pushVariable({
        group,
        field: "url",
        description: `${asset.name} URL`,
        secret: false,
        default: asset.url,
      });
    }
  }

  for (const binding of deriveAuthVariableBindings(asset.authentication, asset.name, variableGroupForAsset(asset))) {
    pushVariable({
      group: binding.group,
      field: binding.field,
      description: binding.description,
      secret: binding.secret,
      default: binding.default ?? "",
    });
  }

  return vars;
}
