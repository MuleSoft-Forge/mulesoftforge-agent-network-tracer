export type {
  AuthVariableBinding,
  ConnectionAccess,
  ConnectionAuth,
  ConnectionAuthKind,
  ConnectionKind,
  ConnectionPolicies,
  ConnectionPolicyItem,
  DerivedConnectionSpec,
  NamedCredentialValue,
} from "@/lib/composer/connectivity/types";

export { ConnectionAuthSchema } from "@/lib/composer/connectivity/auth-zod";

export {
  allowedAuthOptions,
  authFieldSpecs,
  authKindLabel,
  authKindRequiresAuthentication,
  type AuthFieldSpec,
  type AuthKindOption,
} from "@/lib/composer/connectivity/auth-catalog";

export {
  authKindFromAuth,
  createDefaultAuth,
  defaultAuthForAssetKind,
} from "@/lib/composer/connectivity/defaults";

export {
  formatVariableRef,
  isVariableRef,
  parseVariableRef,
} from "@/lib/composer/connectivity/variable-ref";

export { deriveAuthVariableBindings } from "@/lib/composer/connectivity/variable-bindings";

export { parseConnectionAuth } from "@/lib/composer/connectivity/parse-auth";
export { serializeConnectionAuth } from "@/lib/composer/connectivity/serialize-auth";

export {
  ConnectionAccessSchema,
  ConnectionPoliciesSchema,
  ConnectionPolicyItemSchema,
} from "@/lib/composer/connectivity/connection-extras-zod";

export {
  applyConnectionExtras,
  parseConnectionAccess,
  parseConnectionPolicies,
  sanitizeConnectionPolicies,
  sanitizeConnectionPolicyItems,
  serializeConnectionAccess,
  serializeConnectionPolicies,
} from "@/lib/composer/connectivity/connection-extras";

export {
  applyPolicyConfigVariableDefaults,
  defaultPolicyConfigVariableRef,
  policyConfigFieldHint,
  policyVariableFieldName,
} from "@/lib/composer/connectivity/policy-config-defaults";

export { derivePolicyVariableBindings } from "@/lib/composer/connectivity/policy-variable-bindings";

export {
  ensurePolicyBindingForRef,
  parseContextPolicies,
  referencedPolicyBindingNames,
  refBindingNamesFromItems,
  serializeContextPolicies,
  bindingNameFromExchangePolicy,
} from "@/lib/composer/connectivity/policy-bindings";

export {
  DeclaredPolicyBindingSchema,
  PolicyBindingsMapSchema,
} from "@/lib/composer/connectivity/policy-bindings-zod";
export type { DeclaredPolicyBinding, PolicyBindingsMap } from "@/lib/composer/connectivity/policy-bindings-zod";

export {
  policyConfigFieldSpecs,
  readPolicyConfigField,
  writePolicyConfigField,
} from "@/lib/composer/connectivity/policy-schema-fields";
export type { PolicyConfigFieldSpec } from "@/lib/composer/connectivity/policy-schema-fields";

export { buildDerivedConnection, deriveConnectionVariablesForAsset } from "@/lib/composer/connectivity/connection";

export {
  defaultLlmBaseUrl,
  defaultLlmBaseUrlForAsset,
  inferLlmPlatform,
  LLM_DEFAULT_BASE_URL_DOCS,
  LLM_DEFAULT_BASE_URLS,
  type LlmConnectionPlatform,
} from "@/lib/composer/connectivity/llm-default-urls";

export {
  editableAuthFields,
  readAuthField,
  writeAuthField,
} from "@/lib/composer/connectivity/auth-fields";
