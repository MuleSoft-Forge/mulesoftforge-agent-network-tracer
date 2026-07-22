/** agent-network.yaml connection kind (matches asset kind mapping). */
export type ConnectionKind = "a2a" | "mcp" | "llm";

/** authentication.kind values from agent_network_v2.json */
export type ConnectionAuthKind =
  | "apiKey"
  | "basic"
  | "apikey-client-credentials"
  | "oauth2-client-credentials"
  | "oauth2-obo"
  | "in-task-authorization-code";

export interface NamedCredentialValue {
  value: string;
  name?: string;
}

export interface ConnectionAuthApiKey {
  kind: "apiKey";
  apiKey: string;
  headerName?: string;
}

export interface ConnectionAuthBasic {
  kind: "basic";
  username: string;
  password: string;
  headerName?: string;
}

export interface ConnectionAuthApiKeyClientCredentials {
  kind: "apikey-client-credentials";
  clientId: NamedCredentialValue;
  clientSecret: NamedCredentialValue;
}

export interface ConnectionAuthOAuth2ClientCredentials {
  kind: "oauth2-client-credentials";
  clientId: string;
  clientSecret: string;
  token: {
    url: string;
    timeout?: number;
    bodyEncoding?: "form" | "json";
  };
  scopes?: string[];
}

export interface ConnectionAuthOAuth2Obo {
  kind: "oauth2-obo";
  flow: "oauth2-token-exchange" | "microsoft-entra-obo";
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  targetType?: "audience" | "resource";
  targetValue?: string;
  scope?: string;
  timeout?: number;
  cibaEnabled?: boolean;
  cibaEndpoint?: string;
  cibaLoginHintClaim?: string;
  cibaBindingMessage?: string;
  distributed?: boolean;
}

export interface ConnectionAuthInTaskAuthorizationCode {
  kind: "in-task-authorization-code";
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string;
  redirectUri: string;
  secondaryAuthProvider?: string;
  responseType?: string;
  challengeStatusCode?: number;
  subjectTokenType?: string;
  requestedTokenType?: string;
  distributed?: boolean;
}

export type ConnectionAuth =
  | ConnectionAuthApiKey
  | ConnectionAuthBasic
  | ConnectionAuthApiKeyClientCredentials
  | ConnectionAuthOAuth2ClientCredentials
  | ConnectionAuthOAuth2Obo
  | ConnectionAuthInTaskAuthorizationCode;

/** Connection access modifier (agent_network_v2.json). Default internal when omitted. */
export type ConnectionAccess = "internal" | "shared";

/** One policy binding on a connection (ref to declared policy, or inline yaml preserved on import). */
export type ConnectionPolicyItem =
  | { mode: "ref"; name: string; namespace?: string }
  | { mode: "inline"; document: Record<string, unknown> };

export interface ConnectionPolicies {
  inbound?: ConnectionPolicyItem[];
  outbound?: ConnectionPolicyItem[];
}

export interface DerivedConnectionSpec {
  connectionName: string;
  kind: ConnectionKind;
  refName: string;
  refNamespace?: string;
  url: string;
  authentication?: ConnectionAuth;
  access?: ConnectionAccess;
  policies?: ConnectionPolicies;
}

export interface AuthVariableBinding {
  group: string;
  field: string;
  description: string;
  secret: boolean;
  default?: string;
}
