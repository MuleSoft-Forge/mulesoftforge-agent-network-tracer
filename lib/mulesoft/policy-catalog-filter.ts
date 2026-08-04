import type { AssetKind } from "@/lib/composer/model";
import type {
  ExchangePolicyCatalog,
  ExchangePolicyTemplate,
} from "@/lib/mulesoft/exchange-policy-templates";

/** Exchange capability tokens that apply to each Composer asset kind. */
const ASSET_TYPE_TOKENS: Record<AssetKind, readonly string[]> = {
  agent: ["a2a", "a2a_v1"],
  mcp: ["mcp"],
  llm: ["llm"],
};

/** Categories that only apply to one asset kind when assetTypes is empty (per XAPI catalog). */
const KIND_EXCLUSIVE_CATEGORIES: Record<AssetKind, readonly string[]> = {
  agent: ["a2a"],
  mcp: ["mcp"],
  llm: ["llm"],
};

const ALL_EXCLUSIVE_CATEGORIES = new Set(
  Object.values(KIND_EXCLUSIVE_CATEGORIES).flatMap((categories) => categories)
);

function normalizeCategory(category: string | undefined): string | undefined {
  const trimmed = category?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function categoryMatchesAssetKind(category: string | undefined, kind: AssetKind): boolean {
  const normalized = normalizeCategory(category);
  if (!normalized || !ALL_EXCLUSIVE_CATEGORIES.has(normalized)) return true;
  return KIND_EXCLUSIVE_CATEGORIES[kind].includes(normalized);
}

/**
 * Whether a policy template applies to a composed asset kind.
 * Non-empty assetTypes is authoritative; empty assetTypes uses category
 * (A2A / MCP / LLM are kind-exclusive; Security, QoS, etc. are universal).
 */
export function policyMatchesAssetKind(
  template: Pick<ExchangePolicyTemplate, "assetTypes" | "category">,
  kind: AssetKind
): boolean {
  const types = template.assetTypes;
  if (types.length > 0) {
    const tokens = ASSET_TYPE_TOKENS[kind];
    return types.some((t) => tokens.includes(t));
  }
  return categoryMatchesAssetKind(template.category, kind);
}

/** Filter inbound/outbound catalogs for a specific composed asset (agent, mcp, llm). */
export function filterPolicyCatalogForAssetKind(
  catalog: ExchangePolicyCatalog,
  kind: AssetKind
): ExchangePolicyCatalog {
  return {
    inbound: catalog.inbound.filter((p) => policyMatchesAssetKind(p, kind)),
    outbound: catalog.outbound.filter((p) => policyMatchesAssetKind(p, kind)),
  };
}

/** Filter inbound/outbound catalogs for a broker A2A interface (same rules as agent assets). */
export function filterPolicyCatalogForBroker(catalog: ExchangePolicyCatalog): ExchangePolicyCatalog {
  return filterPolicyCatalogForAssetKind(catalog, "agent");
}
