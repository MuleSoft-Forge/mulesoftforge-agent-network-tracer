import type { ConnectionAuthKind, ConnectionKind } from "@/lib/composer/connectivity/types";

export interface AuthKindOption {
  kind: ConnectionAuthKind | "none";
  label: string;
}

export interface AuthFieldSpec {
  /** Dot path into the auth object, e.g. "apiKey" or "token.url". */
  path: string;
  label: string;
  secret: boolean;
  /** Default exchange.json variable field name when using ${group}.field */
  defaultField?: string;
  mono?: boolean;
  input?: "text" | "select" | "number" | "boolean" | "comma-list";
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  /** Show only when another field equals this value (e.g. flow for CIBA block). */
  showWhen?: { path: string; equals: string };
}

const A2A_MCP_AUTH_KINDS: ConnectionAuthKind[] = [
  "apiKey",
  "basic",
  "apikey-client-credentials",
  "oauth2-client-credentials",
  "oauth2-obo",
  "in-task-authorization-code",
];

const AUTH_KIND_LABELS: Record<ConnectionAuthKind | "none", string> = {
  none: "None",
  apiKey: "API key",
  basic: "Basic",
  "apikey-client-credentials": "API key client credentials",
  "oauth2-client-credentials": "OAuth 2.0 client credentials",
  "oauth2-obo": "OAuth 2.0 on-behalf-of",
  "in-task-authorization-code": "In-task authorization code",
};

const AUTH_FIELD_SPECS: Record<ConnectionAuthKind, AuthFieldSpec[]> = {
  apiKey: [
    { path: "apiKey", label: "API key", secret: true, defaultField: "apiKey", mono: true },
    {
      path: "headerName",
      label: "Header name",
      secret: false,
      hint: "Optional. Defaults to Authorization when omitted.",
    },
  ],
  basic: [
    { path: "username", label: "Username", secret: false, defaultField: "username" },
    { path: "password", label: "Password", secret: true, defaultField: "password" },
    {
      path: "headerName",
      label: "Header name",
      secret: false,
      hint: "Optional. Defaults to Authorization when omitted.",
    },
  ],
  "apikey-client-credentials": [
    { path: "clientId.value", label: "Client ID", secret: false, defaultField: "clientId" },
    { path: "clientId.name", label: "Client ID header/param name", secret: false, hint: "Optional. Default: client_id." },
    { path: "clientSecret.value", label: "Client secret", secret: true, defaultField: "clientSecret" },
    { path: "clientSecret.name", label: "Client secret header/param name", secret: false, hint: "Optional. Default: client_secret." },
  ],
  "oauth2-client-credentials": [
    { path: "clientId", label: "Client ID", secret: false, defaultField: "clientId" },
    { path: "clientSecret", label: "Client secret", secret: true, defaultField: "clientSecret" },
    { path: "token.url", label: "Token URL", secret: false, defaultField: "tokenUrl", mono: true },
    { path: "token.timeout", label: "Token timeout (seconds)", secret: false, input: "number", hint: "Optional." },
    {
      path: "token.bodyEncoding",
      label: "Token body encoding",
      secret: false,
      input: "select",
      options: [
        { value: "", label: "(default)" },
        { value: "form", label: "form (x-www-form-urlencoded)" },
        { value: "json", label: "json" },
      ],
      hint: "Optional. Defaults per provider.",
    },
    {
      path: "scopes",
      label: "Scopes",
      secret: false,
      input: "comma-list",
      hint: "Optional. Comma-separated OAuth scopes.",
    },
  ],
  "oauth2-obo": [
    {
      path: "flow",
      label: "Token exchange flow",
      secret: false,
      input: "select",
      options: [
        { value: "oauth2-token-exchange", label: "OAuth 2.0 token exchange (RFC 8693)" },
        { value: "microsoft-entra-obo", label: "Microsoft Entra on-behalf-of" },
      ],
    },
    { path: "clientId", label: "Client ID", secret: false, defaultField: "clientId" },
    { path: "clientSecret", label: "Client secret", secret: true, defaultField: "clientSecret" },
    { path: "tokenEndpoint", label: "Token endpoint", secret: false, defaultField: "tokenEndpoint", mono: true },
    {
      path: "targetType",
      label: "Target type",
      secret: false,
      input: "select",
      options: [
        { value: "", label: "(none)" },
        { value: "audience", label: "audience" },
        { value: "resource", label: "resource" },
      ],
      hint: "Optional. RFC 8693 token exchange.",
    },
    { path: "targetValue", label: "Target value", secret: false, mono: true, hint: "Optional audience or resource URI." },
    { path: "scope", label: "Scope", secret: false, hint: "Optional. Required for Microsoft Entra OBO." },
    { path: "timeout", label: "Timeout (ms)", secret: false, input: "number", hint: "Optional. Default 10000." },
    { path: "distributed", label: "Distributed token cache", secret: false, input: "boolean", hint: "Share cache across replicas." },
    {
      path: "cibaEnabled",
      label: "CIBA enabled",
      secret: false,
      input: "boolean",
      showWhen: { path: "flow", equals: "oauth2-token-exchange" },
      hint: "Use Client Initiated Backchannel Authentication.",
    },
    {
      path: "cibaEndpoint",
      label: "CIBA endpoint",
      secret: false,
      mono: true,
      showWhen: { path: "flow", equals: "oauth2-token-exchange" },
    },
    {
      path: "cibaLoginHintClaim",
      label: "CIBA login hint claim",
      secret: false,
      showWhen: { path: "flow", equals: "oauth2-token-exchange" },
      hint: "JWT claim for login_hint (e.g. email, sub).",
    },
    {
      path: "cibaBindingMessage",
      label: "CIBA binding message",
      secret: false,
      showWhen: { path: "flow", equals: "oauth2-token-exchange" },
    },
  ],
  "in-task-authorization-code": [
    { path: "secondaryAuthProvider", label: "IdP provider name", secret: false, hint: "Optional label (e.g. okta, auth0)." },
    { path: "authorizationEndpoint", label: "Authorization endpoint", secret: false, mono: true },
    { path: "tokenEndpoint", label: "Token endpoint", secret: false, mono: true },
    { path: "scopes", label: "Scopes", secret: false, hint: "Space or comma separated." },
    { path: "redirectUri", label: "Redirect URI", secret: false, mono: true },
    { path: "responseType", label: "Response type", secret: false, hint: "Optional. Typically code." },
    { path: "codeChallengeMethod", label: "Code challenge method", secret: false, hint: "Optional. Typically S256." },
    { path: "tokenAudience", label: "Token audience", secret: false, mono: true, hint: "Optional intended token recipient." },
    {
      path: "bodyEncoding",
      label: "Token body encoding",
      secret: false,
      input: "select",
      options: [
        { value: "", label: "(default: form)" },
        { value: "form", label: "form" },
        { value: "json", label: "json" },
      ],
    },
    { path: "tokenTimeout", label: "Token timeout (seconds)", secret: false, input: "number", hint: "Optional. Default 300." },
    {
      path: "challengeResponseStatusCode",
      label: "Challenge response status code",
      secret: false,
      input: "number",
      hint: "HTTP status for auth-required challenges. Default 200.",
    },
    { path: "subjectTokenType", label: "Subject token type", secret: false, mono: true, hint: "Optional URN for subject token." },
    { path: "requestedTokenType", label: "Requested token type", secret: false, hint: "Optional desired issued token type." },
    { path: "distributed", label: "Distributed token cache", secret: false, input: "boolean", hint: "Share cache across replicas." },
  ],
};

/** Auth kinds allowed for a connection kind per agent_network_v2.json. */
export function allowedAuthOptions(connectionKind: ConnectionKind): AuthKindOption[] {
  if (connectionKind === "llm") {
    return [{ kind: "apiKey", label: AUTH_KIND_LABELS.apiKey }];
  }
  return [
    { kind: "none", label: AUTH_KIND_LABELS.none },
    ...A2A_MCP_AUTH_KINDS.map((kind) => ({ kind, label: AUTH_KIND_LABELS[kind] })),
  ];
}

export function authKindRequiresAuthentication(connectionKind: ConnectionKind): boolean {
  return connectionKind === "llm";
}

export function authFieldSpecs(kind: ConnectionAuthKind): AuthFieldSpec[] {
  return AUTH_FIELD_SPECS[kind];
}

export function authKindLabel(kind: ConnectionAuthKind | "none"): string {
  return AUTH_KIND_LABELS[kind];
}
