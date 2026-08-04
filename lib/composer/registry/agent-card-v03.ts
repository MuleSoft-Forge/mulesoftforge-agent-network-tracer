import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import type { BrokerCard } from "@/lib/composer/model";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function omitEmptyRecord(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined;
}

/** Read v0.3 AgentCard top-level url and protocolVersion from the Composer card model. */
export function getA2aV03CardFields(card: BrokerCard): { url: string; protocolVersion: string } {
  const extra = card.extra ?? {};
  return {
    url: asString(extra.url) ?? card.supportedInterfaces?.[0]?.url ?? "",
    protocolVersion:
      asString(extra.protocolVersion) ?? card.supportedInterfaces?.[0]?.protocolVersion ?? "0.3.0",
  };
}

/** Patch v0.3 AgentCard top-level url and protocolVersion (stored in extra + primary interface). */
export function patchA2aV03CardFields(
  card: BrokerCard,
  patch: { url?: string; protocolVersion?: string }
): BrokerCard {
  const extra: Record<string, unknown> = { ...(card.extra ?? {}) };
  if (patch.url !== undefined) {
    if (patch.url.trim()) extra.url = patch.url.trim();
    else delete extra.url;
  }
  if (patch.protocolVersion !== undefined) {
    if (patch.protocolVersion.trim()) extra.protocolVersion = patch.protocolVersion.trim();
    else delete extra.protocolVersion;
  }

  const current = getA2aV03CardFields(card);
  const url = patch.url !== undefined ? patch.url.trim() : current.url;
  const protocolVersion =
    patch.protocolVersion !== undefined ? patch.protocolVersion.trim() : current.protocolVersion;

  const primary = card.supportedInterfaces?.[0] ?? {
    url: "",
    protocolVersion: "0.3.0",
    protocolBinding: "HTTP+JSON",
  };

  return {
    ...card,
    extra: omitEmptyRecord(extra),
    supportedInterfaces: [
      {
        ...primary,
        url,
        protocolVersion,
      },
    ],
  };
}

/** Defaults for a new registry a2a_v03 card stub. */
export function defaultA2aV03BrokerCard(name: string): BrokerCard {
  return patchA2aV03CardFields(
    { name, version: "1.0.0", description: name },
    { url: "", protocolVersion: "0.3.0" }
  );
}

/** Serialize a registry a2a_v03 card with required top-level url and protocolVersion. */
export function serializeA2aV03RegistryCard(card: BrokerCard): Record<string, unknown> {
  const base = serializeBrokerCard(card);
  const { url, protocolVersion } = getA2aV03CardFields(card);
  if (url) base.url = url;
  if (protocolVersion) base.protocolVersion = protocolVersion;
  return base;
}
