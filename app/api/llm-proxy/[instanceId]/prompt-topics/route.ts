import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError, debugLog } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { getAnypointSessionToken } from "@/lib/llmProxy/anypointSession";
import type {
  LlmProxyPromptTopic,
  LlmProxyPromptTopicsResponse,
} from "@/lib/llmProxy/types";

export const dynamic = "force-dynamic";

/**
 * Lists the real semantic prompt topics configured on this LLM Proxy.
 *
 * Primary source (always works with Connected App OAuth bearer):
 *   GET /apimanager/api/v1/.../apis/{id}/policies?fullInfo=true
 *     -> semantic-routing-policy-*.configuration.routes[].topics[].name
 *     -> semantic-prompt-guard-policy-*.configuration.denyTopics[].name
 *
 * These give us topic NAMES + route mapping + deny/allow categorization.
 *
 * Secondary source (best-effort, often 403s for OAuth bearer tokens):
 *   GET /apimanager/xapi/v1/.../prompt-topics/{id}  -> utterance strings
 *
 * We only hit xapi when we have the IDs (from per-upstream metadata). If any
 * xapi call 401/403s we simply omit utterances for that topic; the sidebar
 * falls back to rendering the topic name as a single chip. Never returns the
 * made-up defaults that previously ran when xapi 403'd.
 */

interface ApiV1TopicEntry {
  name?: string;
  /** JSON-encoded array of base64-encoded float32 vectors, one per utterance. */
  embeddings?: string;
}

/**
 * Count utterances on a topic by parsing the JSON-encoded embeddings array.
 * The Anypoint policy config stores one entry per utterance (even though the
 * raw text isn't here). Returns 0 when the field is missing / unparseable.
 */
function countEmbeddings(raw: string | undefined): number {
  if (!raw || typeof raw !== "string") return 0;
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

interface ApiV1RouteEntry {
  provider?: string;
  model?: string;
  topics?: ApiV1TopicEntry[];
}

interface ApiV1PolicyEntry {
  implementationAsset?: { assetId?: string };
  configuration?: {
    routes?: ApiV1RouteEntry[];
    denyTopics?: ApiV1TopicEntry[];
  };
}

interface ApiV1PoliciesResponse {
  policies?: ApiV1PolicyEntry[];
}

interface ApiV1UpstreamsResponse {
  upstreams?: Array<{
    id?: string;
    label?: string;
    metadata?: {
      llmConfigs?: {
        promptTopicIDs?: string[];
        provider?: string;
        model?: string;
      };
    };
  }>;
}

interface XapiPromptTopic {
  topicName?: string;
  utterances?: string;
  usedForDenyList?: boolean;
}

function normalizeUtterances(raw: string | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^"+/, "").replace(/"+$/, ""))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ instanceId: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken } = authResult;

  const { instanceId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId");
  const envId = request.nextUrl.searchParams.get("envId");
  if (!orgId || !envId || !instanceId) {
    return NextResponse.json(
      { error: "orgId, envId and instanceId required", topics: [] },
      { status: 400 }
    );
  }

  const authHeader = `Bearer ${accessToken}`;
  const orgSeg = encodeURIComponent(orgId);
  const envSeg = encodeURIComponent(envId);
  const apiSeg = encodeURIComponent(instanceId);

  const apiBase = `${baseUrl}/apimanager/api/v1/organizations/${orgSeg}/environments/${envSeg}/apis/${apiSeg}`;
  const xapiBase = `${baseUrl}/apimanager/xapi/v1/organizations/${orgSeg}/environments/${envSeg}`;

  try {
    const [policiesRes, upstreamsRes] = await Promise.all([
      loggedFetch(`${apiBase}/policies?fullInfo=true`, {
        headers: { Authorization: authHeader, Accept: "application/json" },
      }),
      loggedFetch(`${apiBase}/upstreams`, {
        headers: { Authorization: authHeader, Accept: "application/json" },
      }),
    ]);

    const policiesBody: ApiV1PoliciesResponse = policiesRes.ok
      ? ((await policiesRes.json()) as ApiV1PoliciesResponse)
      : {};
    const upstreamsBody: ApiV1UpstreamsResponse = upstreamsRes.ok
      ? ((await upstreamsRes.json()) as ApiV1UpstreamsResponse)
      : {};

    // Build the canonical topic list from policy configuration. Order matters:
    // routing topics are listed per route (we keep the upstream label from
    // metadata when it matches the route's provider/model).
    type Draft = {
      name: string;
      usedForDenyList: boolean;
      routeLabel: string | null;
      id: string | null;
      utteranceCount: number;
    };
    const drafts: Draft[] = [];

    // Map upstreams by provider+model for route label enrichment, and keep
    // their topic IDs so we can try xapi.
    const upstreamsByProviderModel = new Map<
      string,
      { label: string; topicIds: string[] }
    >();
    const upstreamTopicIds = new Map<string, string>(); // topicId -> upstream label
    for (const u of upstreamsBody.upstreams ?? []) {
      const cfg = u.metadata?.llmConfigs;
      if (!cfg) continue;
      const key = `${cfg.provider ?? ""}|${cfg.model ?? ""}`.toLowerCase();
      const label = u.label ?? cfg.provider ?? "";
      upstreamsByProviderModel.set(key, {
        label,
        topicIds: cfg.promptTopicIDs ?? [],
      });
      for (const tid of cfg.promptTopicIDs ?? []) {
        if (!upstreamTopicIds.has(tid)) upstreamTopicIds.set(tid, label);
      }
    }

    for (const policy of policiesBody.policies ?? []) {
      const asset = policy.implementationAsset?.assetId ?? "";
      if (!asset.includes("semantic")) continue;
      const cfg = policy.configuration ?? {};
      if (asset.includes("prompt-guard")) {
        for (const t of cfg.denyTopics ?? []) {
          const name = t.name?.trim();
          if (!name) continue;
          drafts.push({
            name,
            usedForDenyList: true,
            routeLabel: null,
            id: null,
            utteranceCount: countEmbeddings(t.embeddings),
          });
        }
      } else if (asset.includes("routing")) {
        for (const route of cfg.routes ?? []) {
          const routeKey = `${route.provider ?? ""}|${route.model ?? ""}`.toLowerCase();
          const upstream = upstreamsByProviderModel.get(routeKey);
          const routeLabel =
            upstream?.label ??
            [route.provider, route.model].filter(Boolean).join(" / ") ??
            null;
          const routeTopicIds = upstream?.topicIds ?? [];
          // Pair topics with IDs by index (policy configs don't carry IDs;
          // upstream metadata lists them in declaration order).
          const topics = route.topics ?? [];
          for (let i = 0; i < topics.length; i += 1) {
            const name = topics[i].name?.trim();
            if (!name) continue;
            drafts.push({
              name,
              usedForDenyList: false,
              routeLabel: routeLabel || null,
              id: routeTopicIds[i] ?? null,
              utteranceCount: countEmbeddings(topics[i].embeddings),
            });
          }
        }
      }
    }

    // If deny topics didn't get IDs from policy config, fall back to any
    // topic IDs not covered by the routing map (heuristic: denyTopicIDs on
    // instance metadata).
    // (We can't reliably cross-reference without IDs in policy; names will still display.)

    if (drafts.length === 0) {
      const empty: LlmProxyPromptTopicsResponse = { topics: [] };
      return NextResponse.json(empty);
    }

    // Best-effort utterance fetch via xapi for topics that have IDs. xapi
    // only accepts Anypoint user-session tokens (not Connected App OAuth
    // bearer tokens); we try the session token first and fall back to the
    // OAuth bearer just in case a future Anypoint release starts accepting
    // it. Any non-200 just means "no utterances available"; we still return
    // the topic name.
    const sessionToken = await getAnypointSessionToken();
    const xapiHeaders: Record<string, string> = {
      Authorization: `Bearer ${sessionToken ?? accessToken}`,
      Accept: "application/json",
      "x-anypnt-org-id": orgId,
      "x-anypnt-env-id": envId,
    };
    if (!sessionToken) {
      debugLog(
        "[LLM-PROXY/PROMPT-TOPICS] no ANYPOINT_USER_USERNAME/PASSWORD configured; xapi calls will likely 403"
      );
    }

    const idsToFetch = Array.from(
      new Set(drafts.map((d) => d.id).filter((id): id is string => Boolean(id)))
    );
    const utterancesById = new Map<string, string[]>();
    if (idsToFetch.length > 0) {
      await Promise.all(
        idsToFetch.map(async (id) => {
          try {
            const res = await loggedFetch(
              `${xapiBase}/prompt-topics/${encodeURIComponent(id)}`,
              { headers: xapiHeaders }
            );
            if (!res.ok) {
              debugLog(
                `[LLM-PROXY/PROMPT-TOPICS] xapi ${res.status} for ${id.slice(0, 8)} — utterances unavailable`
              );
              return;
            }
            const body = (await res.json()) as XapiPromptTopic;
            utterancesById.set(id, normalizeUtterances(body.utterances));
          } catch (err) {
            debugLog(
              `[LLM-PROXY/PROMPT-TOPICS] xapi fetch error for ${id.slice(0, 8)}:`,
              err
            );
          }
        })
      );
    }

    const topics: LlmProxyPromptTopic[] = drafts.map((d, i) => {
      const utterances = d.id ? utterancesById.get(d.id) ?? [] : [];
      return {
        id: d.id ?? `${d.name}-${i}`,
        name: d.name,
        usedForDenyList: d.usedForDenyList,
        utterances,
        utteranceCount: utterances.length > 0 ? utterances.length : d.utteranceCount,
        routeLabel: d.routeLabel,
      };
    });

    topics.sort((a, b) => {
      if (a.usedForDenyList !== b.usedForDenyList) {
        return a.usedForDenyList ? 1 : -1;
      }
      if (a.routeLabel !== b.routeLabel) {
        return (a.routeLabel ?? "").localeCompare(b.routeLabel ?? "");
      }
      return a.name.localeCompare(b.name);
    });

    const body: LlmProxyPromptTopicsResponse = { topics };
    return NextResponse.json(body);
  } catch (error) {
    debugError("[LLM-PROXY/PROMPT-TOPICS] Fetch error:", error);
    return NextResponse.json({ topics: [] }, { status: 200 });
  }
}
