import { z } from "zod";

const NamedCredentialValueSchema = z.object({
  value: z.string(),
  name: z.string().optional(),
});

export const ConnectionAuthApiKeySchema = z.object({
  kind: z.literal("apiKey"),
  apiKey: z.string(),
  headerName: z.string().optional(),
});

export const ConnectionAuthBasicSchema = z.object({
  kind: z.literal("basic"),
  username: z.string(),
  password: z.string(),
  headerName: z.string().optional(),
});

export const ConnectionAuthApiKeyClientCredentialsSchema = z.object({
  kind: z.literal("apikey-client-credentials"),
  clientId: NamedCredentialValueSchema,
  clientSecret: NamedCredentialValueSchema,
});

export const ConnectionAuthOAuth2ClientCredentialsSchema = z.object({
  kind: z.literal("oauth2-client-credentials"),
  clientId: z.string(),
  clientSecret: z.string(),
  token: z.object({
    url: z.string(),
    timeout: z.number().optional(),
    bodyEncoding: z.enum(["form", "json"]).optional(),
  }),
  scopes: z.array(z.string()).optional(),
});

export const ConnectionAuthOAuth2OboSchema = z.object({
  kind: z.literal("oauth2-obo"),
  flow: z.enum(["oauth2-token-exchange", "microsoft-entra-obo"]),
  clientId: z.string(),
  clientSecret: z.string(),
  tokenEndpoint: z.string(),
  targetType: z.enum(["audience", "resource"]).optional(),
  targetValue: z.string().optional(),
  scope: z.string().optional(),
  timeout: z.number().optional(),
  cibaEnabled: z.boolean().optional(),
  cibaEndpoint: z.string().optional(),
  cibaLoginHintClaim: z.string().optional(),
  cibaBindingMessage: z.string().optional(),
  distributed: z.boolean().optional(),
});

export const ConnectionAuthInTaskAuthorizationCodeSchema = z.object({
  kind: z.literal("in-task-authorization-code"),
  authorizationEndpoint: z.string(),
  tokenEndpoint: z.string(),
  scopes: z.string(),
  redirectUri: z.string(),
  secondaryAuthProvider: z.string().optional(),
  responseType: z.string().optional(),
  challengeStatusCode: z.number().optional(),
  subjectTokenType: z.string().optional(),
  requestedTokenType: z.string().optional(),
  distributed: z.boolean().optional(),
});

export const ConnectionAuthSchema = z.discriminatedUnion("kind", [
  ConnectionAuthApiKeySchema,
  ConnectionAuthBasicSchema,
  ConnectionAuthApiKeyClientCredentialsSchema,
  ConnectionAuthOAuth2ClientCredentialsSchema,
  ConnectionAuthOAuth2OboSchema,
  ConnectionAuthInTaskAuthorizationCodeSchema,
]);
