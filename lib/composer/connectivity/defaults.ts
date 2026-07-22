import { formatVariableRef } from "@/lib/composer/connectivity/variable-ref";
import type { ConnectionAuth, ConnectionAuthKind } from "@/lib/composer/connectivity/types";
import type { AssetKind } from "@/lib/composer/model";

export function defaultAuthForAssetKind(kind: AssetKind, variableGroup: string): ConnectionAuth | undefined {
  if (kind === "llm") {
    return {
      kind: "apiKey",
      apiKey: formatVariableRef(variableGroup, "apiKey"),
    };
  }
  return undefined;
}

export function createDefaultAuth(kind: ConnectionAuthKind, variableGroup: string): ConnectionAuth {
  switch (kind) {
    case "apiKey":
      return { kind: "apiKey", apiKey: formatVariableRef(variableGroup, "apiKey") };
    case "basic":
      return {
        kind: "basic",
        username: formatVariableRef(variableGroup, "username"),
        password: formatVariableRef(variableGroup, "password"),
      };
    case "apikey-client-credentials":
      return {
        kind: "apikey-client-credentials",
        clientId: { value: formatVariableRef(variableGroup, "clientId") },
        clientSecret: { value: formatVariableRef(variableGroup, "clientSecret") },
      };
    case "oauth2-client-credentials":
      return {
        kind: "oauth2-client-credentials",
        clientId: formatVariableRef(variableGroup, "clientId"),
        clientSecret: formatVariableRef(variableGroup, "clientSecret"),
        token: { url: formatVariableRef(variableGroup, "tokenUrl") },
      };
    case "oauth2-obo":
      return {
        kind: "oauth2-obo",
        flow: "oauth2-token-exchange",
        clientId: formatVariableRef(variableGroup, "clientId"),
        clientSecret: formatVariableRef(variableGroup, "clientSecret"),
        tokenEndpoint: formatVariableRef(variableGroup, "tokenEndpoint"),
      };
    case "in-task-authorization-code":
      return {
        kind: "in-task-authorization-code",
        authorizationEndpoint: "",
        tokenEndpoint: "",
        scopes: "",
        redirectUri: "",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function authKindFromAuth(auth: ConnectionAuth | undefined): ConnectionAuthKind | "none" {
  if (!auth) return "none";
  return auth.kind;
}
