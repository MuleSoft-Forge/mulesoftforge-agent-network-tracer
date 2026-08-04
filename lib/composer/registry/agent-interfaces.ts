import type { BrokerCard } from "@/lib/composer/model";
import { defaultA2aV03BrokerCard, patchA2aV03CardFields } from "@/lib/composer/registry/agent-card-v03";
import type { RegistryAgentEntity, RegistryAgentInterfaces } from "@/lib/composer/registry/types";

export type RegistryPrimaryInterface = "a2a" | "a2a_v03" | "other";

/** Infer which registry agent interface is primary from persisted metadata. */
export function inferRegistryPrimaryInterface(
  interfaces: RegistryAgentInterfaces
): RegistryPrimaryInterface {
  if (interfaces.a2a_v03 && !interfaces.a2a && !interfaces.other) return "a2a_v03";
  if (interfaces.other && !interfaces.a2a && !interfaces.a2a_v03) return "other";
  if (interfaces.a2a) return "a2a";
  if (interfaces.a2a_v03) return "a2a_v03";
  if (interfaces.other) return "other";
  return "a2a";
}

function defaultA2aCard(name: string): BrokerCard {
  return { name, version: "1.0.0" };
}

function cardForPrimarySwitch(
  entity: RegistryAgentEntity,
  next: RegistryPrimaryInterface
): BrokerCard | Record<string, unknown> | undefined {
  const interfaces = entity.metadata.interfaces;
  const name = entity.info?.label ?? entity.key;

  if (next === "a2a") {
    return (interfaces.a2a?.card as BrokerCard | undefined) ?? defaultA2aCard(name);
  }
  if (next === "a2a_v03") {
    const existing = interfaces.a2a_v03?.card as BrokerCard | undefined;
    if (existing) return existing;
    const fromA2a = interfaces.a2a?.card as BrokerCard | undefined;
    return fromA2a
      ? patchA2aV03CardFields(fromA2a, { protocolVersion: "0.3.0" })
      : defaultA2aV03BrokerCard(name);
  }
  return interfaces.other?.card;
}

/** Persist primary interface selection by keeping only that interface on the entity. */
export function setRegistryPrimaryInterface(
  entity: RegistryAgentEntity,
  next: RegistryPrimaryInterface
): RegistryAgentEntity {
  const card = cardForPrimarySwitch(entity, next);

  let interfaces: RegistryAgentInterfaces;
  switch (next) {
    case "a2a":
      interfaces = { a2a: { card: card as BrokerCard } };
      break;
    case "a2a_v03":
      interfaces = { a2a_v03: { card: card as BrokerCard } };
      break;
    case "other":
      interfaces = {
        other: {
          protocol: entity.metadata.interfaces.other?.protocol ?? "",
          ...(card ? { card } : {}),
        },
      };
      break;
    default: {
      const _exhaustive: never = next;
      return _exhaustive;
    }
  }

  return {
    ...entity,
    metadata: {
      ...entity.metadata,
      interfaces,
    },
  };
}

/** Set the card on the entity's current primary interface bucket. */
export function commitRegistryAgentCard(
  entity: RegistryAgentEntity,
  card: BrokerCard
): RegistryAgentEntity {
  const primary = inferRegistryPrimaryInterface(entity.metadata.interfaces);
  const interfaces: RegistryAgentInterfaces =
    primary === "a2a"
      ? { a2a: { card } }
      : primary === "a2a_v03"
        ? { a2a_v03: { card } }
        : {
            other: {
              protocol: entity.metadata.interfaces.other?.protocol ?? "",
              card,
            },
          };

  return {
    ...entity,
    metadata: {
      ...entity.metadata,
      interfaces,
    },
  };
}
