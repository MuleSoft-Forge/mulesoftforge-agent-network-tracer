export type OAuthScopeProfile =
  | "read-only"
  | "compatibility"
  | "custom";

const READ_ONLY_SCOPES = [
  "profile",
  "read:exchange",
  "view:monitoring",
  "read:api_configuration",
  "read:api_policies",
  "read:client_applications",
  "read:api_contracts",
  // MuleSoft requires Manage Store Data even for reading partition keys.
  "manage:store_data",
  "read:runtime_fabrics",
  "read:applications",
  // Retained for Access Management and undocumented Visualizer compatibility.
  "read:full",
] as const;

const COMPATIBILITY_SCOPES = [
  ...READ_ONLY_SCOPES,
  "manage:application_data",
] as const;

const WRITE_CAPABLE_SCOPES = new Set([
  "manage:store_data",
  "manage:application_data",
]);

export interface ResolvedOAuthScopes {
  profile: OAuthScopeProfile;
  values: string[];
  serialized: string;
  writeCapable: string[];
}

function uniqueScopes(scopes: readonly string[]): string[] {
  return Array.from(
    new Set(scopes.map((scope) => scope.trim()).filter(Boolean))
  );
}

export function resolveOAuthScopes(): ResolvedOAuthScopes {
  const custom = process.env.ANYPOINT_SCOPES?.trim();
  let profile: OAuthScopeProfile;
  let values: string[];

  if (custom) {
    profile = "custom";
    values = uniqueScopes(custom.split(/\s+/));
  } else {
    const configuredProfile =
      process.env.ANYPOINT_SCOPE_PROFILE?.trim() || "read-only";
    if (
      configuredProfile !== "read-only" &&
      configuredProfile !== "compatibility"
    ) {
      throw new Error(
        "ANYPOINT_SCOPE_PROFILE must be read-only or compatibility"
      );
    }
    profile = configuredProfile;
    values = uniqueScopes(
      profile === "read-only" ? READ_ONLY_SCOPES : COMPATIBILITY_SCOPES
    );
  }

  return {
    profile,
    values,
    serialized: values.join(" "),
    writeCapable: values.filter((scope) => WRITE_CAPABLE_SCOPES.has(scope)),
  };
}
