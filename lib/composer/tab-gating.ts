/**
 * Ordered-tab gating for the Builder — the guided build order for a project
 * being authored from scratch.
 *
 * A stage unlocks the next one only when the project data that stage owns is
 * actually present. Gating on "no validation errors on earlier tabs" does not
 * work, because validation only reports a tab when its content is *wrong*, never
 * when it is simply absent: an empty Variables, A2A Interface, AS LLM or AS
 * Actions tab is error-free. Under that rule, filling in the Project tab left
 * every later stage with zero errors and unlocked the whole builder at once.
 *
 * A stage is cleared by holding its data. We intentionally do NOT require that
 * the user has opened a tab previously, because imported or already-complete
 * projects should never be blocked by "review-only" walkthrough steps.
 */

import { buildA2aCardCompleteness } from "@/lib/composer/a2a-card-completeness";
import { A2A_CARD_ANCHOR } from "@/lib/composer/a2a-card-field-anchors";
import { isValidBrokerKey } from "@/lib/composer/broker-key";
import { isValidExchangeAssetId } from "@/lib/composer/exchange-asset-id";
import type { AssetKind, Broker, ComposerProject } from "@/lib/composer/model";
import { connectionNameForAsset, primaryBroker } from "@/lib/composer/model";
import { PANEL_TAB_GROUPS, type PanelTab } from "@/lib/composer/panel-tabs";
import { PROJECT_ANCHOR, type ProjectFocusTarget } from "@/lib/composer/project-field-anchors";
import type { ValidationResult } from "@/lib/composer/validation/issue";
import { issuesByTab } from "@/lib/composer/validation/selectors";

export type GateStageId =
  | "project"
  | "inventory"
  | "variables"
  | "interface"
  | "card"
  | "instructions"
  | "llms"
  | "actions"
  | "graph";

export interface GateRequirement {
  id: string;
  /** Imperative one-liner: what the builder has to do to clear this. */
  label: string;
  met: boolean;
  /** Where the work happens — drives click-to-focus from the checklist. */
  focus: ProjectFocusTarget;
}

export interface GateStage {
  id: GateStageId;
  label: string;
  /** Tabs owned by this stage. They unlock together. */
  tabs: PanelTab[];
  /** Tab the checklist and "next stage" affordances navigate to. */
  primaryTab: PanelTab;
  requirements: GateRequirement[];
  outstanding: GateRequirement[];
  /** Blocking errors reported against this stage's tabs. */
  errors: number;
  /** No data of its own to demand — clearing it is just a review pass. */
  reviewOnly: boolean;
  /** Every requirement met and nothing blocking. */
  dataComplete: boolean;
  satisfied: boolean;
}

export interface TabLock {
  blockedBy: GateStageId;
  /** Tooltip text: which stage blocks this tab, and what that stage still needs. */
  reason: string;
  /** Where to send the builder to clear the block. */
  focus: ProjectFocusTarget;
}

export interface TabGate {
  /** Resolved from the caller's setting — always concrete, never "auto". */
  enabled: boolean;
  stages: GateStage[];
  /** First unsatisfied stage, or the last stage when everything is done. */
  activeStage: GateStage;
  /** Locked tabs only — empty when gating is switched off. */
  locked: Map<PanelTab, TabLock>;
}

interface StageSpec {
  id: GateStageId;
  tabs: PanelTab[];
  primaryTab: PanelTab;
  requirements: (project: ComposerProject, broker: Broker | undefined) => GateRequirement[];
}

function requirement(
  id: string,
  label: string,
  met: boolean,
  focus: ProjectFocusTarget
): GateRequirement {
  return { id, label, met, focus };
}

function identityRequirements(project: ComposerProject): GateRequirement[] {
  const identity = project.identity;
  const assetId = identity.assetId?.trim() ?? "";
  return [
    requirement("identity.name", "Name the network", Boolean(identity.name?.trim()), {
      tab: "identity",
      anchor: PROJECT_ANCHOR.name,
    }),
    requirement(
      "identity.organization",
      "Set the owning organization id",
      Boolean(identity.organizationId?.trim()),
      { tab: "identity", anchor: PROJECT_ANCHOR.organizationId }
    ),
    requirement(
      "identity.asset-id",
      "Set a valid Exchange asset id",
      assetId.length > 0 && isValidExchangeAssetId(assetId),
      { tab: "identity", anchor: PROJECT_ANCHOR.assetId }
    ),
    requirement("identity.version", "Set the asset version", Boolean(identity.version?.trim()), {
      tab: "identity",
      anchor: PROJECT_ANCHOR.version,
    }),
    requirement("identity.api-version", "Set the version group", Boolean(identity.apiVersion?.trim()), {
      tab: "identity",
      anchor: PROJECT_ANCHOR.apiVersion,
    }),
  ];
}

function registryInventoryCount(project: ComposerProject): number {
  const registry = project.registry;
  if (!registry) return 0;
  return (
    registry.agents.length +
    registry.mcps.length +
    registry.llms.length +
    Object.keys(registry.passthroughAgents ?? {}).length +
    Object.keys(registry.passthroughMcps ?? {}).length +
    Object.keys(registry.passthroughLlms ?? {}).length
  );
}

function inventoryRequirements(project: ComposerProject): GateRequirement[] {
  const hasExchangeOrRegistryInventory =
    project.assets.length > 0 || registryInventoryCount(project) > 0;
  return [
    requirement(
      "inventory.connection",
      "Add at least one asset or registry connection — an LLM, MCP server, or agent",
      hasExchangeOrRegistryInventory,
      { tab: "assets" }
    ),
  ];
}

function cardRequirements(broker: Broker | undefined): GateRequirement[] {
  if (!broker) return [];
  const requirements = [
    requirement("card.broker-key", "Give the broker a key", isValidBrokerKey(broker.name), {
      tab: "a2a-card",
      anchor: A2A_CARD_ANCHOR.brokerKey,
    }),
  ];
  for (const group of buildA2aCardCompleteness(broker.card).groups) {
    for (const item of group.items) {
      if (item.tier !== "required") continue;
      requirements.push(
        requirement(`card.${item.id}`, `Set ${item.label}`, item.status === "set", {
          tab: "a2a-card",
          anchor: item.anchor,
        })
      );
    }
  }
  return requirements;
}

function instructionRequirements(broker: Broker | undefined): GateRequirement[] {
  if (!broker) return [];
  return [];
}

/**
 * Only demanded once an LLM connection exists to bind — a network wired purely
 * from MCP tools or downstream agents needs no binding, and gating on one would
 * be a dead end.
 */
function llmRequirements(project: ComposerProject, broker: Broker | undefined): GateRequirement[] {
  if (!broker) return [];
  if (!project.assets.some((asset) => asset.kind === "llm")) return [];
  return [
    requirement(
      "llms.binding",
      "Bind an imported LLM connection",
      broker.llmBindings.length > 0,
      { tab: "llms" }
    ),
  ];
}

function connectionNoun(kind: AssetKind): string {
  switch (kind) {
    case "agent":
      return "agent";
    case "mcp":
      return "MCP server";
    case "llm":
      return "LLM";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * One requirement per imported MCP server or agent: nothing in the graph can
 * reach a connection that no action targets. LLM connections are bound on the
 * AS LLM stage instead, so they are skipped here.
 */
function actionRequirements(project: ComposerProject, broker: Broker | undefined): GateRequirement[] {
  if (!broker) return [];
  const targeted = new Set(broker.actions.map((action) => action.connectionName));
  const requirements: GateRequirement[] = [];
  for (const asset of project.assets) {
    if (asset.kind === "llm") continue;
    requirements.push(
      requirement(
        `actions.${asset.id}`,
        `Add an action calling ${connectionNoun(asset.kind)} "${asset.name}"`,
        targeted.has(connectionNameForAsset(asset)),
        { tab: "actions" }
      )
    );
  }
  return requirements;
}

const STAGE_SPECS: StageSpec[] = [
  {
    id: "project",
    tabs: ["identity"],
    primaryTab: "identity",
    requirements: (project) => identityRequirements(project),
  },
  {
    id: "inventory",
    tabs: ["registry", "assets"],
    primaryTab: "assets",
    requirements: (project) => inventoryRequirements(project),
  },
  {
    id: "variables",
    tabs: ["variables"],
    primaryTab: "variables",
    requirements: () => [],
  },
  {
    id: "interface",
    tabs: ["access"],
    primaryTab: "access",
    requirements: () => [],
  },
  {
    id: "card",
    tabs: ["a2a-card"],
    primaryTab: "a2a-card",
    requirements: (_project, broker) => cardRequirements(broker),
  },
  {
    id: "instructions",
    tabs: ["behavior"],
    primaryTab: "behavior",
    requirements: (_project, broker) => instructionRequirements(broker),
  },
  {
    id: "llms",
    tabs: ["llms"],
    primaryTab: "llms",
    requirements: llmRequirements,
  },
  {
    id: "actions",
    tabs: ["actions"],
    primaryTab: "actions",
    requirements: actionRequirements,
  },
  {
    id: "graph",
    tabs: ["graph"],
    primaryTab: "graph",
    requirements: () => [],
  },
];

function tabLabels(): Map<PanelTab, string> {
  const labels = new Map<PanelTab, string>();
  for (const group of PANEL_TAB_GROUPS) {
    for (const tab of group.tabs) labels.set(tab.id, tab.label);
  }
  return labels;
}

const TAB_LABELS = tabLabels();

function panelTabLabel(tab: PanelTab): string {
  return TAB_LABELS.get(tab) ?? tab;
}

function buildStages(
  project: ComposerProject,
  validation: ValidationResult,
  _visitedTabs: ReadonlySet<PanelTab>
): GateStage[] {
  const broker = primaryBroker(project);
  const countsByTab = issuesByTab(validation);

  return STAGE_SPECS.map((spec) => {
    const requirements = spec.requirements(project, broker);
    const outstanding = requirements.filter((r) => !r.met);
    const errors = spec.tabs.reduce((total, tab) => total + (countsByTab.get(tab)?.errors ?? 0), 0);
    const dataComplete = outstanding.length === 0 && errors === 0;
    return {
      id: spec.id,
      label: panelTabLabel(spec.primaryTab),
      tabs: spec.tabs,
      primaryTab: spec.primaryTab,
      requirements,
      outstanding,
      errors,
      reviewOnly: requirements.length === 0,
      dataComplete,
      satisfied: dataComplete,
    };
  });
}

function lockReason(stage: GateStage): string {
  const [first, ...rest] = stage.outstanding;
  if (!first) {
    if (stage.errors > 0) {
      return `Fix ${stage.errors} error${stage.errors === 1 ? "" : "s"} on "${stage.label}" first`;
    }
    return `Open "${stage.label}" first`;
  }
  const more = rest.length > 0 ? ` (+${rest.length} more)` : "";
  return `Finish "${stage.label}" first: ${first.label}${more}`;
}

/**
 * `enabled: "auto"` keeps guided order on while any stage is still short of its
 * data. A project that arrives complete — an opened example, a round-tripped
 * import — has no build order left to walk, so nothing locks.
 */
export function buildTabGate(input: {
  project: ComposerProject;
  validation: ValidationResult;
  visitedTabs: ReadonlySet<PanelTab>;
  enabled: boolean | "auto";
}): TabGate {
  const stages = buildStages(input.project, input.validation, input.visitedTabs);
  const firstUnsatisfied = stages.find((stage) => !stage.satisfied);
  const activeStage = firstUnsatisfied ?? stages[stages.length - 1];
  const enabled =
    input.enabled === "auto"
      ? stages.some((stage) => stage.id !== "graph" && !stage.dataComplete)
      : input.enabled;

  const locked = new Map<PanelTab, TabLock>();
  if (enabled) {
    for (let i = 0; i < stages.length; i += 1) {
      const blocking = stages.slice(0, i).find((stage) => !stage.satisfied);
      if (!blocking) continue;
      const lock: TabLock = {
        blockedBy: blocking.id,
        reason: lockReason(blocking),
        focus: blocking.outstanding[0]?.focus ?? { tab: blocking.primaryTab },
      };
      for (const tab of stages[i].tabs) locked.set(tab, lock);
    }
  }

  return { enabled, stages, activeStage, locked };
}

export function tabLock(gate: TabGate, tab: PanelTab): TabLock | null {
  return gate.locked.get(tab) ?? null;
}

export function isTabLocked(gate: TabGate, tab: PanelTab): boolean {
  return gate.locked.has(tab);
}

