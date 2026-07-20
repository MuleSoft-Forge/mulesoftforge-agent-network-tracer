import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loggedFetch } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";

export const dynamic = "force-dynamic";

const SecurityPostureQuerySchema = z.object({
  orgId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  envId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  family: z.enum(["api", "agentic", "llm"]),
  instanceId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});

const MAX_INSTANCES = 25;
const CONCURRENCY = 5;

interface ApiManagerInstance {
  id?: string | number;
  assetId?: string;
  instanceLabel?: string | null;
  exchangeAssetName?: string | null;
  apiAsset?: { name?: string | null; assetId?: string | null } | null;
}

interface ApiManagerListResponse {
  total?: number;
  assets?: Array<{ apis?: ApiManagerInstance[] }>;
  instances?: ApiManagerInstance[];
}

interface PolicyEntry {
  id?: string | number;
  assetId?: string;
  policyTemplateId?: string;
  policyTemplateName?: string;
  disabled?: boolean;
  template?: { assetId?: string; policyTemplateName?: string };
  implementationAsset?: { assetId?: string };
}

interface TlsContextsResponse {
  inbound?: {
    secretGroupId?: string;
    tlsContextId?: string;
  } | null;
}

type ProbeStatus = "ok" | "forbidden" | "unavailable";
type FindingSeverity = "high" | "medium" | "advisory";

interface SecurityFinding {
  severity: FindingSeverity;
  control: string;
  message: string;
  recommendation: string;
}

function flattenInstances(body: ApiManagerListResponse): ApiManagerInstance[] {
  if (Array.isArray(body.assets)) {
    return body.assets.flatMap((asset) => asset.apis ?? []);
  }
  return Array.isArray(body.instances) ? body.instances : [];
}

function parsePolicies(body: unknown): PolicyEntry[] {
  if (Array.isArray(body)) return body as PolicyEntry[];
  if (body && typeof body === "object") {
    const policies = (body as { policies?: unknown }).policies;
    if (Array.isArray(policies)) return policies as PolicyEntry[];
  }
  return [];
}

function policyIdentifier(policy: PolicyEntry): string {
  return [
    policy.assetId,
    policy.policyTemplateId,
    policy.policyTemplateName,
    policy.template?.assetId,
    policy.template?.policyTemplateName,
    policy.implementationAsset?.assetId,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function hasMatchingPolicy(
  identifiers: string[],
  patterns: readonly RegExp[]
): boolean {
  return identifiers.some((identifier) =>
    patterns.some((pattern) => pattern.test(identifier))
  );
}

async function fetchJson(
  url: string,
  accessToken: string
): Promise<{ status: ProbeStatus; body: unknown }> {
  try {
    const response = await loggedFetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "forbidden", body: null };
    }
    if (!response.ok) {
      return { status: "unavailable", body: null };
    }
    try {
      return { status: "ok", body: await response.json() };
    } catch {
      return { status: "unavailable", body: null };
    }
  } catch {
    return { status: "unavailable", body: null };
  }
}

function assessInstance(
  policies: PolicyEntry[],
  policyStatus: ProbeStatus,
  tlsBody: unknown,
  tlsStatus: ProbeStatus,
  family: "api" | "agentic" | "llm"
): {
  baselineStatus: "hardened-baseline" | "attention" | "unknown";
  controls: {
    authentication: boolean | null;
    rateLimiting: boolean | null;
    ipRestriction: boolean | null;
    threatOrPromptProtection: boolean | null;
    inboundTlsContext: boolean | null;
  };
  findings: SecurityFinding[];
} {
  const activePolicies = policies.filter((policy) => policy.disabled !== true);
  const identifiers = activePolicies.map(policyIdentifier);
  const policyDataAvailable = policyStatus === "ok";

  const authentication = policyDataAvailable
    ? hasMatchingPolicy(identifiers, [
        /oauth/,
        /openid/,
        /jwt/,
        /client.?id/,
        /authentication/,
        /access.?token/,
      ])
    : null;
  const rateLimiting = policyDataAvailable
    ? hasMatchingPolicy(identifiers, [
        /rate.?limit/,
        /throttl/,
        /spike.?control/,
        /quota/,
      ])
    : null;
  const ipRestriction = policyDataAvailable
    ? hasMatchingPolicy(identifiers, [/ip.?allow/, /ip.?filter/, /ip.?restrict/])
    : null;
  const threatOrPromptProtection = policyDataAvailable
    ? hasMatchingPolicy(identifiers, [
        /threat.?protection/,
        /prompt.?guard/,
        /content.?filter/,
        /sensitive.?information/,
        /pii/,
      ])
    : null;

  const tls =
    tlsStatus === "ok"
      ? (tlsBody as TlsContextsResponse | null)?.inbound?.tlsContextId != null
      : null;

  const findings: SecurityFinding[] = [];
  if (authentication === false) {
    findings.push({
      severity: "high",
      control: "authentication",
      message: "No recognized authentication policy was returned by API Manager.",
      recommendation:
        "Verify authentication upstream or apply a compatible OAuth, JWT, or client-enforcement policy.",
    });
  }
  if (rateLimiting === false) {
    findings.push({
      severity: "medium",
      control: "rate-limiting",
      message: "No recognized rate-limiting or spike-control policy was returned.",
      recommendation:
        "Apply an appropriate rate limit or spike-control policy for the expected workload.",
    });
  }
  if (tls === false) {
    findings.push({
      severity: "medium",
      control: "tls-context",
      message: "API Manager did not return an inbound TLS context.",
      recommendation:
        "Confirm TLS terminates at a trusted upstream gateway, or configure an inbound TLS context.",
    });
  }
  if (
    (family === "agentic" || family === "llm") &&
    threatOrPromptProtection === false
  ) {
    findings.push({
      severity: "advisory",
      control: "agent-content-protection",
      message: "No recognized prompt, content, or sensitive-data policy was returned.",
      recommendation:
        "Review whether prompt guardrails, content filtering, or sensitive-data protection are required.",
    });
  }
  if (ipRestriction === false) {
    findings.push({
      severity: "advisory",
      control: "network-restriction",
      message: "No recognized IP restriction policy was returned.",
      recommendation:
        "Confirm the endpoint is intentionally public or restrict source networks where appropriate.",
    });
  }

  const dataUnavailable = policyStatus !== "ok" || tlsStatus !== "ok";
  const needsAttention = findings.some(
    (finding) =>
      finding.severity === "high" || finding.severity === "medium"
  );

  return {
    baselineStatus: dataUnavailable
      ? "unknown"
      : needsAttention
        ? "attention"
        : "hardened-baseline",
    controls: {
      authentication,
      rateLimiting,
      ipRestriction,
      threatOrPromptProtection,
      inboundTlsContext: tls,
    },
    findings,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      async () => worker()
    )
  );
  return results;
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const parsed = SecurityPostureQuerySchema.safeParse({
    orgId: request.nextUrl.searchParams.get("orgId"),
    envId: request.nextUrl.searchParams.get("envId"),
    family: request.nextUrl.searchParams.get("family"),
    instanceId: request.nextUrl.searchParams.get("instanceId") ?? undefined,
  });
  if (!parsed.success) return validationError(parsed.error);

  const { orgId, envId, family, instanceId } = parsed.data;
  const apiCollectionBase =
    `${authResult.baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/apis`;

  let instances: ApiManagerInstance[];
  let reportedTotal: number | undefined;

  if (instanceId) {
    instances = [{ id: instanceId }];
  } else {
    const listProbe = await fetchJson(
      `${apiCollectionBase}?family=${family}&fullInfo=true&limit=${MAX_INSTANCES}&offset=0`,
      authResult.accessToken
    );
    if (listProbe.status !== "ok") {
      return NextResponse.json(
        {
          error: "Unable to list API Manager instances",
          status: listProbe.status,
        },
        { status: listProbe.status === "forbidden" ? 403 : 502 }
      );
    }
    const listBody = listProbe.body as ApiManagerListResponse;
    instances = flattenInstances(listBody).slice(0, MAX_INSTANCES);
    reportedTotal = listBody.total;
  }

  const reports = await mapWithConcurrency(
    instances,
    CONCURRENCY,
    async (instance) => {
      const id = String(instance.id ?? "");
      const instanceBase = `${apiCollectionBase}/${encodeURIComponent(id)}`;
      const [policyProbe, tlsProbe] = await Promise.all([
        fetchJson(
          `${instanceBase}/policies?fullInfo=true`,
          authResult.accessToken
        ),
        fetchJson(`${instanceBase}/tls-contexts`, authResult.accessToken),
      ]);
      const policies = parsePolicies(policyProbe.body);
      const assessment = assessInstance(
        policies,
        policyProbe.status,
        tlsProbe.body,
        tlsProbe.status,
        family
      );

      return {
        id,
        name:
          instance.exchangeAssetName ??
          instance.apiAsset?.name ??
          instance.instanceLabel ??
          instance.assetId ??
          instance.apiAsset?.assetId ??
          id,
        family,
        probeStatus: {
          policies: policyProbe.status,
          tlsContexts: tlsProbe.status,
        },
        activePolicies: policies
          .filter((policy) => policy.disabled !== true)
          .map((policy) => ({
            id: policy.id,
            assetId:
              policy.assetId ??
              policy.template?.assetId ??
              policy.implementationAsset?.assetId ??
              policy.policyTemplateId,
            name:
              policy.policyTemplateName ??
              policy.template?.policyTemplateName,
          })),
        ...assessment,
      };
    }
  );

  return NextResponse.json(
    {
      family,
      scanned: reports.length,
      reportedTotal: reportedTotal ?? reports.length,
      truncated:
        !instanceId &&
        typeof reportedTotal === "number" &&
        reportedTotal > reports.length,
      disclaimer:
        "Missing API Manager controls are review signals, not proof of exposure; controls may be enforced by another trusted layer.",
      instances: reports,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
