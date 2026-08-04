import type { ConnectionAuth } from "@/lib/composer/connectivity/types";

function omitEmptyStrings<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === "" || value === undefined) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

/** Serialize connectivity auth to agent-network.yaml authentication object. */
export function serializeConnectionAuth(auth: ConnectionAuth): Record<string, unknown> {
  switch (auth.kind) {
    case "apiKey":
      return {
        kind: auth.kind,
        apiKey: auth.apiKey,
        ...(auth.headerName ? { headerName: auth.headerName } : {}),
      };
    case "basic":
      return {
        kind: auth.kind,
        username: auth.username,
        password: auth.password,
        ...(auth.headerName ? { headerName: auth.headerName } : {}),
      };
    case "apikey-client-credentials":
      return {
        kind: auth.kind,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
      };
    case "oauth2-client-credentials":
      return {
        kind: auth.kind,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        token: {
          url: auth.token.url,
          ...(auth.token.timeout !== undefined ? { timeout: auth.token.timeout } : {}),
          ...(auth.token.bodyEncoding ? { bodyEncoding: auth.token.bodyEncoding } : {}),
        },
        ...(auth.scopes?.length ? { scopes: auth.scopes } : {}),
      };
    case "oauth2-obo":
      return {
        kind: auth.kind,
        flow: auth.flow,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        tokenEndpoint: auth.tokenEndpoint,
        ...omitEmptyStrings({
          targetType: auth.targetType,
          targetValue: auth.targetValue,
          scope: auth.scope,
        }),
        ...(auth.timeout !== undefined ? { timeout: auth.timeout } : {}),
        ...(auth.cibaEnabled !== undefined ? { cibaEnabled: auth.cibaEnabled } : {}),
        ...omitEmptyStrings({
          cibaEndpoint: auth.cibaEndpoint,
          cibaLoginHintClaim: auth.cibaLoginHintClaim,
          cibaBindingMessage: auth.cibaBindingMessage,
        }),
        ...(auth.distributed !== undefined ? { distributed: auth.distributed } : {}),
      };
    case "in-task-authorization-code":
      return {
        kind: auth.kind,
        authorizationEndpoint: auth.authorizationEndpoint,
        tokenEndpoint: auth.tokenEndpoint,
        scopes: auth.scopes,
        redirectUri: auth.redirectUri,
        ...omitEmptyStrings({
          secondaryAuthProvider: auth.secondaryAuthProvider,
          responseType: auth.responseType,
          codeChallengeMethod: auth.codeChallengeMethod,
          tokenAudience: auth.tokenAudience,
        }),
        ...(auth.bodyEncoding ? { bodyEncoding: auth.bodyEncoding } : {}),
        ...(auth.tokenTimeout !== undefined ? { tokenTimeout: auth.tokenTimeout } : {}),
        ...(auth.challengeResponseStatusCode !== undefined
          ? { challengeResponseStatusCode: auth.challengeResponseStatusCode }
          : {}),
        ...omitEmptyStrings({
          subjectTokenType: auth.subjectTokenType,
          requestedTokenType: auth.requestedTokenType,
        }),
        ...(auth.distributed !== undefined ? { distributed: auth.distributed } : {}),
      };
    default: {
      const _exhaustive: never = auth;
      return _exhaustive;
    }
  }
}
