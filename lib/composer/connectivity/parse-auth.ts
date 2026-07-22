import { ConnectionAuthSchema } from "@/lib/composer/connectivity/auth-zod";
import type { ConnectionAuth, ConnectionAuthOAuth2ClientCredentials, ConnectionKind } from "@/lib/composer/connectivity/types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseNamedCredential(raw: unknown): { value: string; name?: string } | undefined {
  const obj = asRecord(raw);
  const value = asString(obj?.value);
  if (!value) return undefined;
  const name = asString(obj?.name);
  return name ? { value, name } : { value };
}

function parseAuthObject(raw: Record<string, unknown>): ConnectionAuth | undefined {
  const kind = asString(raw.kind);
  if (!kind) return undefined;

  switch (kind) {
    case "apiKey": {
      const apiKey = asString(raw.apiKey);
      if (!apiKey) return undefined;
      const headerName = asString(raw.headerName);
      return headerName ? { kind, apiKey, headerName } : { kind, apiKey };
    }
    case "basic": {
      const username = asString(raw.username);
      const password = asString(raw.password);
      if (!username || !password) return undefined;
      const headerName = asString(raw.headerName);
      return headerName ? { kind, username, password, headerName } : { kind, username, password };
    }
    case "apikey-client-credentials": {
      const clientId = parseNamedCredential(raw.clientId);
      const clientSecret = parseNamedCredential(raw.clientSecret);
      if (!clientId || !clientSecret) return undefined;
      return { kind, clientId, clientSecret };
    }
    case "oauth2-client-credentials": {
      const clientId = asString(raw.clientId);
      const clientSecret = asString(raw.clientSecret);
      const tokenRaw = asRecord(raw.token);
      const url = asString(tokenRaw?.url);
      if (!clientId || !clientSecret || !url) return undefined;
      const token: ConnectionAuthOAuth2ClientCredentials["token"] = { url };
      const timeout = asNumber(tokenRaw?.timeout);
      const bodyEncoding = asString(tokenRaw?.bodyEncoding);
      if (timeout !== undefined) token.timeout = timeout;
      if (bodyEncoding === "form" || bodyEncoding === "json") token.bodyEncoding = bodyEncoding;
      const scopes = Array.isArray(raw.scopes)
        ? raw.scopes.filter((s): s is string => typeof s === "string")
        : undefined;
      return scopes?.length ? { kind, clientId, clientSecret, token, scopes } : { kind, clientId, clientSecret, token };
    }
    case "oauth2-obo": {
      const flow = asString(raw.flow);
      const clientId = asString(raw.clientId);
      const clientSecret = asString(raw.clientSecret);
      const tokenEndpoint = asString(raw.tokenEndpoint);
      if (
        (flow !== "oauth2-token-exchange" && flow !== "microsoft-entra-obo") ||
        !clientId ||
        !clientSecret ||
        !tokenEndpoint
      ) {
        return undefined;
      }
      return {
        kind,
        flow,
        clientId,
        clientSecret,
        tokenEndpoint,
        ...(asString(raw.targetType) === "audience" || asString(raw.targetType) === "resource"
          ? { targetType: asString(raw.targetType) as "audience" | "resource" }
          : {}),
        ...(asString(raw.targetValue) ? { targetValue: asString(raw.targetValue) } : {}),
        ...(asString(raw.scope) ? { scope: asString(raw.scope) } : {}),
        ...(asNumber(raw.timeout) !== undefined ? { timeout: asNumber(raw.timeout) } : {}),
        ...(asBool(raw.cibaEnabled) !== undefined ? { cibaEnabled: asBool(raw.cibaEnabled) } : {}),
        ...(asString(raw.cibaEndpoint) ? { cibaEndpoint: asString(raw.cibaEndpoint) } : {}),
        ...(asString(raw.cibaLoginHintClaim) ? { cibaLoginHintClaim: asString(raw.cibaLoginHintClaim) } : {}),
        ...(asString(raw.cibaBindingMessage) ? { cibaBindingMessage: asString(raw.cibaBindingMessage) } : {}),
        ...(asBool(raw.distributed) !== undefined ? { distributed: asBool(raw.distributed) } : {}),
      };
    }
    case "in-task-authorization-code": {
      const authorizationEndpoint = asString(raw.authorizationEndpoint);
      const tokenEndpoint = asString(raw.tokenEndpoint);
      const scopes = asString(raw.scopes);
      const redirectUri = asString(raw.redirectUri);
      if (!authorizationEndpoint || !tokenEndpoint || !scopes || !redirectUri) return undefined;
      return {
        kind,
        authorizationEndpoint,
        tokenEndpoint,
        scopes,
        redirectUri,
        ...(asString(raw.secondaryAuthProvider)
          ? { secondaryAuthProvider: asString(raw.secondaryAuthProvider) }
          : {}),
        ...(asString(raw.responseType) ? { responseType: asString(raw.responseType) } : {}),
        ...(asNumber(raw.challengeStatusCode) !== undefined
          ? { challengeStatusCode: asNumber(raw.challengeStatusCode) }
          : {}),
        ...(asString(raw.subjectTokenType) ? { subjectTokenType: asString(raw.subjectTokenType) } : {}),
        ...(asString(raw.requestedTokenType) ? { requestedTokenType: asString(raw.requestedTokenType) } : {}),
        ...(asBool(raw.distributed) !== undefined ? { distributed: asBool(raw.distributed) } : {}),
      };
    }
    default:
      return undefined;
  }
}

/** Parse yaml/json authentication object into the connectivity model. */
export function parseConnectionAuth(raw: unknown, _connectionKind: ConnectionKind): ConnectionAuth | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const parsed = parseAuthObject(obj);
  if (!parsed) return undefined;
  const validated = ConnectionAuthSchema.safeParse(parsed);
  return validated.success ? validated.data : parsed;
}
