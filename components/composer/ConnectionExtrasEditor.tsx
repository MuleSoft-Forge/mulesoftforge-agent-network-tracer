"use client";

import type { ConnectionAccess, ConnectionPolicies } from "@/lib/composer/connectivity";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import { PolicyBindingsPanel } from "@/components/composer/PolicyBindingsPanel";
import type { ExchangePolicyCatalog } from "@/components/composer/useExchangePolicies";

export function ConnectionExtrasEditor({
  organizationId,
  variableGroup,
  access,
  policies,
  policyCatalog,
  policyBindings,
  policiesLoading,
  policiesError,
  allowedPolicyDependencyRefs,
  onAccessChange,
  onPoliciesChange,
  onEnsurePolicyBinding,
  onEnsurePolicyDependency,
  onUpdatePolicyBinding,
}: {
  organizationId: string;
  variableGroup: string;
  access: ConnectionAccess | undefined;
  policies: ConnectionPolicies | undefined;
  policyCatalog: ExchangePolicyCatalog;
  policyBindings: Record<string, DeclaredPolicyBinding>;
  policiesLoading: boolean;
  policiesError: string | null;
  allowedPolicyDependencyRefs: Set<string>;
  onAccessChange: (access: ConnectionAccess | undefined) => void;
  onPoliciesChange: (policies: ConnectionPolicies | undefined) => void;
  onEnsurePolicyBinding: (bindingName: string, binding: DeclaredPolicyBinding) => void;
  onEnsurePolicyDependency: (dependency: {
    groupId: string;
    assetId: string;
    version: string;
    classifier: string;
    packaging?: string;
  }) => void;
  onUpdatePolicyBinding: (bindingName: string, patch: Partial<DeclaredPolicyBinding>) => void;
}) {
  return (
    <PolicyBindingsPanel
      organizationId={organizationId}
      variableGroup={variableGroup}
      policies={policies}
      policyCatalog={policyCatalog}
      policyBindings={policyBindings}
      policiesLoading={policiesLoading}
      policiesError={policiesError}
      allowedPolicyDependencyRefs={allowedPolicyDependencyRefs}
      showAccess
      access={access}
      onAccessChange={onAccessChange}
      onPoliciesChange={onPoliciesChange}
      onEnsurePolicyBinding={onEnsurePolicyBinding}
      onEnsurePolicyDependency={onEnsurePolicyDependency}
      onUpdatePolicyBinding={onUpdatePolicyBinding}
    />
  );
}
