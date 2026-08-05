/**
 * Derive A2A Agent Card securitySchemes / securityRequirements from broker
 * interface inbound policies (A2A Interface tab). Exported yaml uses these values
 * instead of manually edited card security fields.
 */

import type { Broker, BrokerCardSecurityRequirement, BrokerCard, ComposerProject } from "@/lib/composer/model";
import type { ConnectionPolicyItem } from "@/lib/composer/connectivity/types";
import { sanitizeConnectionPolicies } from "@/lib/composer/connectivity/connection-extras";

export interface DerivedA2aCardSecurity {
  securitySchemes: Record<string, unknown>;
  securityRequirements: BrokerCardSecurityRequirement[];
}

const AUTH_POLICY_PATTERN =
  /oauth|openid|jwt|json.web.token|client.?id|authentication|access.?token|mtls|mutual.?tls|basic.?auth|api.?key|bearer/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isAuthPolicyAssetId(assetId: string): boolean {
  return AUTH_POLICY_PATTERN.test(assetId);
}

function schemeKeyFromAssetId(assetId: string): string {
  const sanitized = assetId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!sanitized) return "auth";
  if (/^[a-z]/.test(sanitized)) return sanitized;
  return `auth_${sanitized}`;
}

interface NamedSchemeDefinition {
  keySuffix?: string;
  definition: Record<string, unknown>;
}

function buildSchemeDefinitions(assetId: string): NamedSchemeDefinition[] {
  const id = assetId.toLowerCase();
  if (/jwt|json.web.token|access.?token|bearer/.test(id)) {
    return [{ definition: { httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat: "JWT" } } }];
  }
  if (/openid/.test(id)) {
    return [
      {
        definition: {
          openIdConnectSecurityScheme: {
            openIdConnectUrl: "https://example.com/.well-known/openid-configuration",
          },
        },
      },
    ];
  }
  if (/oauth/.test(id)) {
    return [{ definition: { oauth2SecurityScheme: { flows: {} } } }];
  }
  if (/client.?id/.test(id)) {
    return [
      {
        keySuffix: "client_id",
        definition: { apiKeySecurityScheme: { name: "client_id", location: "header" } },
      },
      {
        keySuffix: "client_secret",
        definition: { apiKeySecurityScheme: { name: "client_secret", location: "header" } },
      },
    ];
  }
  if (/mtls|mutual.?tls/.test(id)) {
    return [{ definition: { mtlsSecurityScheme: {} } }];
  }
  if (/basic.?auth|basic.authentication/.test(id)) {
    return [{ definition: { httpAuthSecurityScheme: { scheme: "Basic" } } }];
  }
  if (/api.?key/.test(id)) {
    return [{ definition: { apiKeySecurityScheme: { name: "X-Api-Key", location: "header" } } }];
  }
  if (/authentication/.test(id)) {
    return [{ definition: { httpAuthSecurityScheme: { scheme: "Bearer" } } }];
  }
  return [];
}

function resolvePolicyAssetId(item: ConnectionPolicyItem, project: ComposerProject): string | undefined {
  if (item.mode === "ref") {
    const binding = project.policyBindings[item.name];
    return binding?.ref.name?.trim() || item.name.trim() || undefined;
  }
  const policy = asRecord(item.document?.policy);
  const ref = asRecord(policy?.ref);
  const name = ref?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** Map inbound A2A interface auth policies to Agent Card security metadata. */
export function deriveA2aCardSecurityFromInterfacePolicies(
  broker: Broker,
  project: ComposerProject
): DerivedA2aCardSecurity | undefined {
  const policies = sanitizeConnectionPolicies(broker.interfacePolicies);
  const inbound = policies?.inbound ?? [];
  if (inbound.length === 0) return undefined;

  const schemes: Record<string, unknown> = {};
  const schemeKeys: string[] = [];

  for (const item of inbound) {
    const assetId = resolvePolicyAssetId(item, project);
    if (!assetId || !isAuthPolicyAssetId(assetId)) continue;
    const definitions = buildSchemeDefinitions(assetId);
    if (definitions.length === 0) continue;

    for (const built of definitions) {
      const base = built.keySuffix
        ? `${schemeKeyFromAssetId(assetId)}_${built.keySuffix}`
        : schemeKeyFromAssetId(assetId);
      let key = base;
      let suffix = 2;
      while (schemes[key]) {
        key = `${base}_${suffix}`;
        suffix += 1;
      }
      schemes[key] = built.definition;
      schemeKeys.push(key);
    }
  }

  if (schemeKeys.length === 0) return undefined;

  const requirement: BrokerCardSecurityRequirement = {};
  for (const key of schemeKeys) {
    requirement[key] = [];
  }

  return {
    securitySchemes: schemes,
    securityRequirements: [requirement],
  };
}

/** Remove card security fields that are derived from the A2A Interface tab. */
export function stripStoredCardSecurity(card: BrokerCard): BrokerCard {
  const next = { ...card };
  delete next.securitySchemes;
  delete next.securityRequirements;
  if (next.skills) {
    next.skills = next.skills.map((skill) => {
      const stripped = { ...skill };
      delete stripped.securityRequirements;
      return stripped;
    });
  }
  return next;
}
