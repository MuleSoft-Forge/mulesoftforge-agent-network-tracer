/**
 * Field-level completeness for the whole Composer project — identity, assets,
 * broker wiring, and export projections across exchange.json, yaml, and .agent.
 */

import type { CompletenessGroup, CompletenessItem, CompletenessResult } from "@/lib/composer/completeness-types";
import { summarizeCompleteness } from "@/lib/composer/completeness-types";
import type { ComposerProject } from "@/lib/composer/model";
import {
  CONNECTION_KIND_BY_KIND,
  connectionNameForAsset,
  brokerGraphReferencesActions,
  exchangeDependencyAssets,
  primaryBroker,
} from "@/lib/composer/model";
import { buildA2aCardCompleteness } from "@/lib/composer/a2a-card-completeness";
import { authKindRequiresAuthentication } from "@/lib/composer/connectivity/auth-catalog";
import { isValidBrokerKey } from "@/lib/composer/broker-key";
import {
  exchangeAssetIdValidationMessage,
  isValidExchangeAssetId,
} from "@/lib/composer/exchange-asset-id";
import { A2A_CARD_ANCHOR } from "@/lib/composer/a2a-card-field-anchors";
import { PROJECT_ANCHOR, type ProjectFocusTarget } from "@/lib/composer/project-field-anchors";

export type ProjectCompleteness = CompletenessResult<ProjectFocusTarget>;

const PREVIEW_MAX = 56;

function preview(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX - 1)}…`;
}

function itemStatus(hasValue: boolean, errored = false): CompletenessItem["status"] {
  if (errored) return "error";
  return hasValue ? "set" : "missing";
}

function projectItem(
  input: Omit<CompletenessItem<ProjectFocusTarget>, "focus"> & { focus: ProjectFocusTarget }
): CompletenessItem<ProjectFocusTarget> {
  return input;
}

function identityFocus(anchor: string): ProjectFocusTarget {
  return { tab: "identity", anchor };
}

/** Build grouped completeness for the Project panel side rail. */
export function buildProjectCompleteness(project: ComposerProject): ProjectCompleteness {
  const broker = primaryBroker(project);
  const cardSummary = broker ? buildA2aCardCompleteness(broker.card).summary : null;

  const exchangeAssets = exchangeDependencyAssets(project);

  const assetPreview =
    exchangeAssets.length === 0
      ? null
      : exchangeAssets
          .map((a) => `${a.name} (${a.kind})`)
          .slice(0, 3)
          .join(", ") + (exchangeAssets.length > 3 ? ` +${exchangeAssets.length - 3} more` : "");

  const llmNodes =
    broker?.nodes.filter((n) => ["generator", "orchestrator", "subagent"].includes(n.kind)).length ?? 0;
  const graphReferencesActions = broker ? brokerGraphReferencesActions(broker) : false;

  const groups: CompletenessGroup<ProjectFocusTarget>[] = [
    {
      title: "Exchange identity",
      subtitle: "Required before export — written to exchange.json and yaml info.label / info.version.",
      items: [
        projectItem({
          id: "name",
          label: "Network name",
          mapsTo: "exchange.json name · yaml info.label",
          why: "Human-readable label shown in Exchange and on the network yaml.",
          tier: "required",
          status: itemStatus(Boolean(project.identity.name?.trim())),
          valuePreview: preview(project.identity.name),
          focus: identityFocus(PROJECT_ANCHOR.name),
        }),
        projectItem({
          id: "organization-id",
          label: "Organization id",
          mapsTo: "exchange.json organizationId / groupId",
          why: "Owning Anypoint org — becomes the Exchange GAV groupId.",
          tier: "required",
          status: itemStatus(Boolean(project.identity.organizationId?.trim())),
          valuePreview: preview(project.identity.organizationId),
          focus: identityFocus(PROJECT_ANCHOR.organizationId),
        }),
        projectItem({
          id: "asset-id",
          label: "Asset id",
          mapsTo: "exchange.json assetId",
          why: "Exchange asset slug used when publishing this network project.",
          tier: "required",
          status: itemStatus(
            Boolean(project.identity.assetId?.trim()),
            Boolean(project.identity.assetId?.trim()) && !isValidExchangeAssetId(project.identity.assetId)
          ),
          valuePreview: preview(project.identity.assetId),
          schemaMessage:
            project.identity.assetId?.trim() && !isValidExchangeAssetId(project.identity.assetId)
              ? exchangeAssetIdValidationMessage(project.identity.assetId)
              : undefined,
          focus: identityFocus(PROJECT_ANCHOR.assetId),
        }),
        projectItem({
          id: "version",
          label: "Asset version",
          mapsTo: "exchange.json version · yaml info.version (Builder default)",
          why: "Semver published to Exchange for this network release.",
          tier: "required",
          status: itemStatus(Boolean(project.identity.version?.trim())),
          valuePreview: preview(project.identity.version),
          focus: identityFocus(PROJECT_ANCHOR.version),
        }),
        projectItem({
          id: "api-version",
          label: "Version group",
          mapsTo: "exchange.json apiVersion",
          why: 'Exchange publish/deploy lane (versionGroup). ACB/CLI default "v1" — keep stable across releases; Exchange increments semver inside the group.',
          tier: "required",
          status: itemStatus(Boolean(project.identity.apiVersion?.trim())),
          valuePreview: preview(project.identity.apiVersion),
          focus: identityFocus(PROJECT_ANCHOR.apiVersion),
        }),
        projectItem({
          id: "descriptor-version",
          label: "Descriptor version",
          mapsTo: "exchange.json descriptorVersion",
          why: "MuleSoft ExchangeDescriptor format version — protected at 1.0.0 unless import supplies another supported value.",
          tier: "required",
          status: itemStatus(Boolean(project.identity.descriptorVersion?.trim())),
          valuePreview: preview(project.identity.descriptorVersion),
          focus: identityFocus(PROJECT_ANCHOR.descriptorVersion),
        }),
      ],
    },
    {
      title: "Listing & yaml metadata",
      subtitle: "Optional enrichment — omitted from export when empty.",
      items: [
        projectItem({
          id: "description",
          label: "Project description",
          mapsTo: "exchange.json description",
          why: "Longer description for Exchange consumers browsing the asset.",
          tier: "optional",
          status: itemStatus(Boolean(project.identity.description?.trim())),
          valuePreview: preview(project.identity.description),
          focus: identityFocus(PROJECT_ANCHOR.description),
        }),
        projectItem({
          id: "tags",
          label: "Tags",
          mapsTo: "exchange.json tags",
          why: "Searchable keywords for Exchange discovery.",
          tier: "optional",
          status: itemStatus((project.identity.tags?.length ?? 0) > 0),
          valuePreview: preview(project.identity.tags?.join(", ")),
          focus: identityFocus(PROJECT_ANCHOR.tags),
        }),
        projectItem({
          id: "yaml-info",
          label: "Yaml info overrides",
          mapsTo: "agent-network.yaml info.*",
          why: "Optional yaml-only metadata (summary, tags, alternate info.version such as v1).",
          tier: "optional",
          status: itemStatus(Boolean(project.identity.yamlInfo && Object.keys(project.identity.yamlInfo).length > 0)),
          valuePreview: project.identity.yamlInfo
            ? preview(
                [
                  project.identity.yamlInfo.version ? `version=${project.identity.yamlInfo.version}` : null,
                  project.identity.yamlInfo.summary ? "summary" : null,
                  project.identity.yamlInfo.tags?.length ? `${project.identity.yamlInfo.tags.length} tags` : null,
                ]
                  .filter(Boolean)
                  .join(", ")
              )
            : null,
          focus: identityFocus(PROJECT_ANCHOR.yamlInfo),
        }),
      ],
    },
    {
      title: "Exchange assets",
      subtitle: "Published dependencies — each becomes a yaml connection + exchange.json dependency.",
      items: [
        projectItem({
          id: "assets",
          label: "Exchange dependencies",
          mapsTo: "exchange.json dependencies[]",
          why: "Published Exchange assets composed into this network — not registry-local yaml definitions.",
          tier: "recommended",
          status: itemStatus(exchangeAssets.length > 0),
          valuePreview: assetPreview,
          focus: { tab: "assets" },
        }),
        ...exchangeAssets.map((asset) => {
          const needsAuth = authKindRequiresAuthentication(CONNECTION_KIND_BY_KIND[asset.kind]);
          const hasAuth = Boolean(asset.authentication);
          return projectItem({
            id: `asset-${asset.id}`,
            label: `${asset.name} (${asset.kind})`,
            mapsTo: `connection ${connectionNameForAsset(asset)}`,
            why: needsAuth
              ? "LLM connections require authentication for deploy-time credentials."
              : "Imported Exchange asset referenced by broker actions or LLM bindings.",
            tier: needsAuth ? "required" : "recommended",
            status: itemStatus(Boolean(asset.groupId && asset.assetId && asset.version), needsAuth && !hasAuth),
            valuePreview: preview(`${asset.groupId}:${asset.assetId}:${asset.version}`),
            focus: { tab: "assets", assetId: asset.id },
          });
        }),
      ],
    },
    {
      title: "Deploy variables",
      subtitle: "Derived from asset connections and policy bindings — edited on the Variables tab.",
      items: [
        projectItem({
          id: "variables",
          label: "Variable groups",
          mapsTo: "exchange.json metadata.variables",
          why: "Deploy-time URLs, secrets, and policy config referenced as ${group.field} in yaml and .agent.",
          tier: "recommended",
          status: itemStatus(project.assets.length > 0 || Object.keys(project.policyBindings ?? {}).length > 0),
          valuePreview:
            project.assets.length > 0
              ? `${project.assets.length} asset group${project.assets.length === 1 ? "" : "s"} (+ policy bindings)`
              : null,
          focus: { tab: "variables" },
        }),
      ],
    },
    {
      title: "Broker & public A2A contract",
      subtitle: "Single broker MVP — yaml brokers map + interfaces.a2a.card.",
      items: [
        projectItem({
          id: "broker",
          label: "Broker configured",
          mapsTo: "yaml brokers.* · brokers/*.agent",
          why: "Every network exposes exactly one broker as the A2A front door in Builder MVP.",
          tier: "required",
          status: itemStatus(Boolean(broker)),
          valuePreview: broker ? preview(broker.name) : null,
          focus: { tab: "a2a-card" },
        }),
        ...(broker
          ? [
              projectItem({
                id: "broker-key",
                label: "Broker key",
                mapsTo: "yaml brokers key · .agent config.agent_name · filename",
                why: "Stable identifier linking yaml, agent file, and graph — must be a valid map key.",
                tier: "required",
                status: itemStatus(isValidBrokerKey(broker.name)),
                valuePreview: preview(broker.name),
                focus: { tab: "a2a-card", anchor: A2A_CARD_ANCHOR.name },
              }),
              projectItem({
                id: "a2a-required",
                label: "A2A card required fields",
                mapsTo: "yaml brokers.*.interfaces.a2a.card",
                why: "Public agent card clients read for discovery and invocation. Deploy fails if required card fields (e.g. description) are omitted.",
                tier: "required",
                status: itemStatus(
                  cardSummary !== null && cardSummary.requiredSet === cardSummary.requiredTotal
                ),
                valuePreview: (() => {
                  if (!broker) return null;
                  const missing = buildA2aCardCompleteness(broker.card)
                    .groups.flatMap((g) => g.items)
                    .filter((i) => i.tier === "required" && i.status !== "set")
                    .map((i) => i.label);
                  if (missing.length > 0) return `Missing: ${missing.join(", ")}`;
                  return cardSummary
                    ? `${cardSummary.requiredSet}/${cardSummary.requiredTotal} required`
                    : null;
                })(),
                focus: { tab: "a2a-card", anchor: A2A_CARD_ANCHOR.endpointUrl },
              }),
              projectItem({
                id: "a2a-recommended",
                label: "A2A card recommendations",
                mapsTo: "yaml brokers.*.interfaces.a2a.card",
                why: "Skills, provider, HTTPS endpoint, and modes improve discoverability.",
                tier: "recommended",
                status: itemStatus(
                  cardSummary !== null && cardSummary.recommendedSet === cardSummary.recommendedTotal
                ),
                valuePreview: cardSummary
                  ? `${cardSummary.recommendedSet}/${cardSummary.recommendedTotal} recommended`
                  : null,
                focus: { tab: "a2a-card", anchor: A2A_CARD_ANCHOR.primarySkill },
              }),
              projectItem({
                id: "a2a-access",
                label: "A2A interface policies",
                mapsTo: "yaml brokers.*.interfaces.a2a.policies",
                why: "Inbound/outbound API policies applied at the broker ingress.",
                tier: "optional",
                status: itemStatus(
                  Boolean(broker.interfacePolicies?.inbound?.length || broker.interfacePolicies?.outbound?.length)
                ),
                valuePreview:
                  broker.interfacePolicies?.inbound?.length || broker.interfacePolicies?.outbound?.length
                    ? `${(broker.interfacePolicies.inbound?.length ?? 0) + (broker.interfacePolicies.outbound?.length ?? 0)} binding(s)`
                    : null,
                focus: { tab: "access" },
              }),
            ]
          : []),
      ],
    },
    {
      title: "AgentScript runtime",
      subtitle: "brokers/*.agent — instructions, LLMs, actions, and graph flow.",
      items: broker
        ? [
            projectItem({
              id: "instructions",
              label: "System instructions",
              mapsTo: "brokers/*.agent system.instructions",
              why: "Top-level broker behavior guidance applied to all graph nodes.",
              tier: "recommended",
              status: itemStatus(Boolean(broker.systemInstructions?.trim())),
              valuePreview: preview(broker.systemInstructions),
              focus: { tab: "behavior" },
            }),
            projectItem({
              id: "llm-bindings",
              label: "LLM bindings",
              mapsTo: "brokers/*.agent llm:",
              why: "Maps graph generator/orchestrator nodes to imported LLM connections.",
              tier: llmNodes > 0 ? "required" : "recommended",
              status: itemStatus(broker.llmBindings.length > 0),
              valuePreview:
                broker.llmBindings.length > 0
                  ? broker.llmBindings.map((b) => b.name).join(", ")
                  : llmNodes > 0
                    ? `${llmNodes} graph node(s) need LLM`
                    : null,
              focus: { tab: "llms" },
            }),
            projectItem({
              id: "actions",
              label: "Broker actions",
              mapsTo: "brokers/*.agent actions:",
              why: "Named @actions targets when graph nodes invoke agents or MCP tools (A2A send / MCP tool). Reasoning-only orchestrators do not need any.",
              tier: graphReferencesActions ? "required" : "recommended",
              status: itemStatus(!graphReferencesActions || broker.actions.length > 0),
              valuePreview:
                broker.actions.length > 0
                  ? `${broker.actions.length} action${broker.actions.length === 1 ? "" : "s"}`
                  : graphReferencesActions
                    ? "Graph references actions"
                    : null,
              focus: { tab: "actions" },
            }),
            projectItem({
              id: "graph-trigger",
              label: "Graph trigger",
              mapsTo: "brokers/*.agent graph trigger node",
              why: "Exactly one A2A entry node must start the conversation flow.",
              tier: "required",
              status: itemStatus(broker.nodes.some((n) => n.kind === "trigger")),
              valuePreview: broker.nodes.find((n) => n.kind === "trigger")?.name ?? null,
              focus: { tab: "graph", nodeId: broker.nodes.find((n) => n.kind === "trigger")?.id },
            }),
            projectItem({
              id: "graph-echo",
              label: "Terminal echo response",
              mapsTo: "brokers/*.agent graph echo node",
              why: "At least one echo node sends the final A2A task/artifact/status response.",
              tier: "required",
              status: itemStatus(broker.nodes.some((n) => n.kind === "echo")),
              valuePreview: broker.nodes.filter((n) => n.kind === "echo").map((n) => n.name).join(", ") || null,
              focus: { tab: "graph", nodeId: broker.nodes.find((n) => n.kind === "echo")?.id },
            }),
            projectItem({
              id: "graph-size",
              label: "Graph nodes",
              mapsTo: "brokers/*.agent graph",
              why: "Full orchestration flow — routers, generators, executors wired with on_exit transitions.",
              tier: "recommended",
              status: itemStatus(broker.nodes.length > 2),
              valuePreview: `${broker.nodes.length} node${broker.nodes.length === 1 ? "" : "s"}`,
              focus: { tab: "graph" },
            }),
          ]
        : [],
    },
  ];

  return {
    groups,
    summary: summarizeCompleteness(groups),
  };
}
