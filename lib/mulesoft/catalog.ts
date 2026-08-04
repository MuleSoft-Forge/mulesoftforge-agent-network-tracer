export const MULESOFT_DEVELOPER_PORTAL_URL =
  "https://dev-portal.mulesoft.com";

export type AssumptionConfidence =
  | "documented"
  | "documented-with-differences"
  | "observed"
  | "reverse-engineered";

export interface MuleSoftApiAssumption {
  id: string;
  feature: string;
  method: "GET" | "POST";
  path: string;
  confidence: AssumptionConfidence;
  portalSlug: string | null;
  connectedAppScopes: readonly string[];
  notes: string;
}

function portalSpecUrl(portalSlug: string | null): string | null {
  return portalSlug
    ? `${MULESOFT_DEVELOPER_PORTAL_URL}/apis/${portalSlug}/api.yaml`
    : null;
}

/**
 * Inventory of MuleSoft API assumptions used by this application.
 *
 * Keep this list aligned with the actual callers. "Observed" and
 * "reverse-engineered" entries require compatibility fallbacks because they
 * are not covered by a published developer-portal contract.
 */
export const MULESOFT_API_ASSUMPTIONS = [
  {
    id: "access-profile",
    feature: "Signed-in user profile",
    method: "GET",
    path: "/accounts/api/profile",
    confidence: "documented",
    portalSlug: "access-management",
    connectedAppScopes: ["profile"],
    notes: "Access Management profile endpoint.",
  },
  {
    id: "access-environments",
    feature: "Environment discovery",
    method: "GET",
    path: "/accounts/api/organizations/{organizationId}/environments",
    confidence: "documented",
    portalSlug: "access-management",
    connectedAppScopes: ["read:full"],
    notes: "Used to populate organization environment selectors.",
  },
  {
    id: "gateway-manager-list",
    feature: "Managed Omni Gateway discovery for deploy",
    method: "GET",
    path: "/gatewaymanager/api/v1/organizations/{organizationId}/environments/{environmentId}/gateways",
    confidence: "documented",
    portalSlug: "flex-gateway-manager",
    connectedAppScopes: ["read:servers"],
    notes: "Populates deploy gateway dropdowns in the desktop lifecycle panel.",
  },
  {
    id: "deployment-targets",
    feature: "CloudHub 2.0 deployment target discovery for deploy",
    method: "GET",
    path: "/proxies/xapi/v1/organizations/{organizationId}/providers/MC/runtime-fabric-deployment-targets",
    confidence: "observed",
    portalSlug: "proxies-xapi",
    connectedAppScopes: ["read:full"],
    notes: "Populates deploy target-space dropdowns; falls back to runtimefabric targets API.",
  },
  {
    id: "api-manager-list",
    feature: "API, agentic, and LLM instance discovery",
    method: "GET",
    path: "/apimanager/api/v1/organizations/{organizationId}/environments/{environmentId}/apis",
    confidence: "documented",
    portalSlug: "api-manager",
    connectedAppScopes: ["read:api_configuration"],
    notes:
      "The official contract supports family=api, family=agentic, and family=llm.",
  },
  {
    id: "api-manager-policies",
    feature: "Instance policy inspection",
    method: "GET",
    path: "/apimanager/api/v1/organizations/{organizationId}/environments/{environmentId}/apis/{environmentApiId}/policies",
    confidence: "documented",
    portalSlug: "api-manager",
    connectedAppScopes: ["read:api_policies"],
    notes: "Can power policy and security-posture reporting.",
  },
  {
    id: "api-manager-tls-contexts",
    feature: "Instance TLS posture",
    method: "GET",
    path: "/apimanager/api/v1/organizations/{organizationId}/environments/{environmentId}/apis/{environmentApiId}/tls-contexts",
    confidence: "documented",
    portalSlug: "api-manager",
    connectedAppScopes: ["read:api_configuration"],
    notes: "Can identify API instances without an expected TLS context.",
  },
  {
    id: "amc-deployments",
    feature: "CloudHub 2.0 and Runtime Fabric deployments",
    method: "GET",
    path: "/amc/application-manager/api/v2/organizations/{organizationId}/environments/{environmentId}/deployments",
    confidence: "documented",
    portalSlug: "amc-application-manager",
    connectedAppScopes: ["read:applications"],
    notes: "Official AMC deployment collection.",
  },
  {
    id: "amc-deployment-logs",
    feature: "Runtime log fallback",
    method: "GET",
    path: "/amc/application-manager/api/v2/organizations/{organizationId}/environments/{environmentId}/deployments/{deploymentId}/specs/{specificationId}/logs",
    confidence: "documented",
    portalSlug: "amc-application-manager",
    connectedAppScopes: ["read:applications"],
    notes:
      "The documented search object is exploded into query fields such as length, descending, startTime, endTime, and regexp.",
  },
  {
    id: "object-store-regions",
    feature: "Object Store region discovery",
    method: "GET",
    path: "/api/v1/organizations/{organizationId}/regions",
    confidence: "documented",
    portalSlug: "object-store-v2",
    connectedAppScopes: [],
    notes:
      "Use this operation before falling back to the application's static AWS region list.",
  },
  {
    id: "object-store-data",
    feature: "Agent reasoning retrieval",
    method: "GET",
    path: "/api/v1/organizations/{organizationId}/environments/{environmentId}/stores/{storeId}/partitions/{partitionId}/keys/{keyId}",
    confidence: "documented",
    portalSlug: "object-store-v2",
    connectedAppScopes: ["manage:store_data"],
    notes: "Object values are read and decoded for task reasoning.",
  },
  {
    id: "observability-spans",
    feature: "Distributed trace retrieval",
    method: "POST",
    path: "/observability/api/v1/spans:search",
    confidence: "observed",
    portalSlug: null,
    connectedAppScopes: ["view:monitoring"],
    notes:
      "No matching public operation was found in the July 2026 developer-portal catalog; retain graceful 403 and unavailable handling.",
  },
  {
    id: "enhanced-log-search",
    feature: "Enhanced Log Search",
    method: "POST",
    path: "/monitoring-x-api/logs/internal/search/opensearch-with-long-numerals",
    confidence: "reverse-engineered",
    portalSlug: null,
    connectedAppScopes: ["view:monitoring"],
    notes:
      "Derived from Anypoint UI traffic and tied to an OpenSearch Dashboards version header; prefer documented AMC search when sufficient.",
  },
  {
    id: "visualizer-proxy",
    feature: "Application network topology",
    method: "GET",
    path: "/visualizer/api/{path}",
    confidence: "observed",
    portalSlug: null,
    connectedAppScopes: ["read:full"],
    notes:
      "Broad proxy over an undocumented surface; restrict forwarded paths to operations the UI needs.",
  },
] as const satisfies readonly MuleSoftApiAssumption[];

export interface MuleSoftAssumptionReportItem extends MuleSoftApiAssumption {
  portalSpecUrl: string | null;
}

export function getMuleSoftAssumptionReport(): {
  generatedAt: string;
  summary: Record<AssumptionConfidence, number>;
  assumptions: MuleSoftAssumptionReportItem[];
} {
  const summary: Record<AssumptionConfidence, number> = {
    documented: 0,
    "documented-with-differences": 0,
    observed: 0,
    "reverse-engineered": 0,
  };

  const assumptions = MULESOFT_API_ASSUMPTIONS.map(
    (assumption): MuleSoftAssumptionReportItem => {
      summary[assumption.confidence] += 1;
      return {
        ...assumption,
        portalSpecUrl: portalSpecUrl(assumption.portalSlug),
      };
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    summary,
    assumptions,
  };
}
