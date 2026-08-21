"use client";

/**
 * Composer store: a single `ComposerProject` edited via a reducer. The model is
 * the only editable source of truth; the file views subscribe and re-serialize.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import type { Dispatch, ReactNode } from "react";
import type {
  Broker,
  BrokerAction,
  ComposerProject,
  CustomVariable,
  GraphNode,
  GraphNodeKind,
  ImportedAsset,
  LlmBinding,
  ProjectIdentity,
  VariableOverride,
} from "@/lib/composer/model";
import { stripStoredCardSecurity } from "@/lib/composer/a2a-card-security-from-policies";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import type { NetworkRegistry } from "@/lib/composer/registry/types";
import { sanitizeConnectionPolicies } from "@/lib/composer/connectivity/connection-extras";
import { pruneUnreferencedPolicyBindings } from "@/lib/composer/connectivity/policy-bindings";
import { assignDefaultConnectionName, connectionNameForAsset } from "@/lib/composer/model";
import {
  createActionForAsset,
  createActionsForMcpAsset,
  createEmptyProject,
  createLlmBindingForAsset,
  createNode,
} from "@/lib/composer/factory";
import { REQUEST_MESSAGE_TEXT_EXPRESSION } from "@/lib/composer/agentfabric-expression-catalog";
import { customVariablesMatch } from "@/lib/composer/variable-keys";
import {
  ROUTER_OTHERWISE_SLOT,
  ROUTER_ROUTE_SLOT,
  routerOutputFromHandleId,
} from "@/lib/composer/agentfabric-graph";
import { isAllowedTransitionTarget } from "@/lib/composer/graph-transitions";
import { checkConnectionCompatibilityByIds } from "@/lib/composer/graph-connection-compatibility";
import { applyHierarchicalGraphLayout } from "@/lib/composer/broker-graph-layout";
import type { GraphLayoutDirection } from "@/lib/composer/agentfabric-graph-layout";
import {
  loadComposerProjectFromSession,
  saveComposerProjectToSession,
} from "@/lib/composer/session-persistence";
import {
  historyReducer,
  initHistory,
  type HistoryAction,
  type HistoryState,
} from "@/lib/composer/history";
import {
  applyConvertRegistryEntityToDependency,
  type RegistryEntityKind,
} from "@/lib/composer/registry/convert-to-dependencies";

export type ComposerAction =
  | { type: "loadProject"; project: ComposerProject }
  | { type: "resetProject"; organizationId?: string }
  | { type: "setIdentity"; patch: Partial<ProjectIdentity> }
  | { type: "setRegistry"; registry: NetworkRegistry | undefined }
  | { type: "addAsset"; asset: ImportedAsset }
  | { type: "updateAsset"; id: string; patch: Partial<ImportedAsset> }
  | { type: "updatePolicyBinding"; bindingName: string; patch: Partial<DeclaredPolicyBinding> }
  | { type: "ensurePolicyBinding"; bindingName: string; binding: DeclaredPolicyBinding }
  | {
      type: "upsertUnmatchedDependency";
      dependency: {
        groupId: string;
        assetId: string;
        version: string;
        classifier: string;
        packaging?: string;
      };
    }
  | {
      type: "removeUnmatchedDependency";
      dependency: {
        groupId: string;
        assetId: string;
        version: string;
        classifier: string;
        packaging?: string;
      };
    }
  | { type: "removeAsset"; id: string }
  | {
      type: "convertRegistryEntityToDependency";
      registryKind: RegistryEntityKind;
      entityKey: string;
      groupId: string;
      assetId: string;
      version: string;
      name: string;
      namespace?: string;
      meta?: unknown;
    }
  | { type: "setVariableOverride"; key: string; patch: VariableOverride }
  | { type: "addCustomVariable"; variable: CustomVariable }
  | { type: "updateCustomVariable"; group: string; field: string; flat?: boolean; patch: Partial<CustomVariable> }
  | { type: "removeCustomVariable"; group: string; field: string; flat?: boolean }
  | { type: "updateBroker"; patch: Partial<Omit<Broker, "id" | "nodes" | "actions" | "llmBindings">> }
  | { type: "updateCard"; patch: Partial<Broker["card"]> }
  | { type: "setDefaultLlm"; bindingName: string | undefined }
  | { type: "addLlmBinding"; binding: LlmBinding }
  | { type: "updateLlmBinding"; id: string; patch: Partial<LlmBinding> }
  | { type: "removeLlmBinding"; id: string }
  | { type: "addAction"; action: BrokerAction }
  | { type: "updateAction"; id: string; patch: Partial<BrokerAction> }
  | { type: "removeAction"; id: string }
  | {
      type: "addNode";
      kind: GraphNodeKind;
      position: { x: number; y: number };
      /** Pre-generated so the caller can select the node it just created. */
      id?: string;
      /** Wire the new node up in the same step (drag-to-create). */
      connectFrom?: { nodeId: string; sourceHandle?: string | null };
    }
  | {
      /** Splice a node into an existing edge: source → new → original target. */
      type: "insertNodeOnEdge";
      kind: GraphNodeKind;
      position: { x: number; y: number };
      id?: string;
      sourceId: string;
      targetId: string;
      sourceHandle?: string | null;
    }
  | { type: "updateNode"; id: string; patch: Partial<GraphNode> }
  | { type: "moveNode"; id: string; position: { x: number; y: number } }
  | { type: "layoutNodes"; positions: Record<string, { x: number; y: number }> }
  | { type: "resetGraphLayoutToHierarchical"; direction?: GraphLayoutDirection }
  | { type: "removeNode"; id: string }
  | { type: "connect"; sourceId: string; targetId: string; sourceHandle?: string | null }
  | { type: "disconnect"; sourceId: string; targetId: string; sourceHandle?: string | null };

function updateBroker(project: ComposerProject, fn: (b: Broker) => Broker): ComposerProject {
  if (project.brokers.length === 0) return project;
  const next = fn(project.brokers[0]);
  // Preserve identity on no-ops so callers (undo history) can skip them.
  if (next === project.brokers[0]) return project;
  const brokers = project.brokers.slice();
  brokers[0] = next;
  return { ...project, brokers };
}

/**
 * Rewrite every node reference to an action. Passing `to: null` drops the
 * reference entirely (deletion); a string renames it. Without this, renaming or
 * deleting an action leaves nodes pointing at a name that no longer resolves.
 */
function remapActionRefs(broker: Broker, from: string, to: string | null): Broker {
  const nodes = broker.nodes.map((node) => {
    const next: GraphNode = { ...node };

    if (next.executorStatements?.some((s) => s.kind === "run" && s.actionName === from)) {
      next.executorStatements = next.executorStatements.map((s) => {
        if (s.kind !== "run" || s.actionName !== from) return s;
        if (to === null) return s;
        return { ...s, actionName: to };
      });
      if (to === null) {
        next.executorStatements = next.executorStatements.filter((s) => s.kind !== "run" || s.actionName !== from);
        if (next.executorStatements.length === 0) delete next.executorStatements;
      }
    }

    if (next.actionRefs?.includes(from)) {
      const refs = to === null
        ? next.actionRefs.filter((r) => r !== from)
        : next.actionRefs.map((r) => (r === from ? to : r));
      if (refs.length > 0) next.actionRefs = refs;
      else delete next.actionRefs;
    }

    if (next.actionBindings?.some((b) => b.actionName === from)) {
      const bindings = to === null
        ? next.actionBindings.filter((b) => b.actionName !== from)
        : next.actionBindings.map((b) => (b.actionName === from ? { ...b, actionName: to } : b));
      if (bindings.length > 0) next.actionBindings = bindings;
      else delete next.actionBindings;
    }

    return next;
  });
  return { ...broker, nodes };
}

/** Same as `remapActionRefs`, for llm binding names (node bindings + broker default). */
function remapLlmRefs(broker: Broker, from: string, to: string | null): Broker {
  const nodes = broker.nodes.map((node) => {
    if (node.llmBindingName !== from) return node;
    const next: GraphNode = { ...node };
    if (to === null) delete next.llmBindingName;
    else next.llmBindingName = to;
    return next;
  });
  const next: Broker = { ...broker, nodes };
  if (next.defaultLlmBindingName === from) {
    if (to === null) delete next.defaultLlmBindingName;
    else next.defaultLlmBindingName = to;
  }
  return next;
}

function newRouteId(): string {
  return `route-${Math.random().toString(36).slice(2)}`;
}

/** Prefer echo as the trigger's initial node; otherwise the first non-trigger node. */
function defaultInitialTargetForTrigger(broker: Broker, triggerId: string) {
  const candidates = broker.nodes.filter((n) => n.id !== triggerId && n.kind !== "trigger");
  if (candidates.length === 0) return undefined;
  return candidates.find((n) => n.kind === "echo") ?? candidates[0];
}

/**
 * When nodes are added from the palette (not drag-connect), wire the trigger's
 * required initial transition so the graph and inspector stay in sync.
 */
function autoWireTriggerOnAdd(
  broker: Broker,
  added: GraphNode,
  connectFrom?: { nodeId: string; sourceHandle?: string | null }
): Broker {
  if (connectFrom) {
    return connectNodes(broker, connectFrom.nodeId, added.id, connectFrom.sourceHandle);
  }
  if (added.kind === "trigger") {
    const target = defaultInitialTargetForTrigger(broker, added.id);
    return target ? connectNodes(broker, added.id, target.id, "bottom") : broker;
  }
  const trigger = broker.nodes.find((n) => n.kind === "trigger");
  if (trigger && !trigger.onExitTarget) {
    return connectNodes(broker, trigger.id, added.id, "bottom");
  }
  return broker;
}

/**
 * Point `sourceId`'s outgoing transition at `targetId`. Routers gain (or retarget)
 * a route for the handle that was dragged; progress/artifact echoes use on_exit.
 */
function connectNodes(
  broker: Broker,
  sourceId: string,
  targetId: string,
  sourceHandle?: string | null
): Broker {
  const compatibility = checkConnectionCompatibilityByIds(
    broker,
    sourceId,
    targetId,
    sourceHandle
  );
  if (!compatibility.ok) return broker;

  return {
    ...broker,
    nodes: broker.nodes.map((n) => {
      if (n.id !== sourceId) return n;
      if (n.kind === "router") {
        const routes = n.routes ?? [];
        const routeId = routerOutputFromHandleId(sourceHandle);
        if (routeId === ROUTER_OTHERWISE_SLOT) {
          return { ...n, otherwiseTargetNodeId: targetId };
        }
        if (routeId) {
          const existingIdx = routes.findIndex((route) => route.id === routeId);
          if (existingIdx >= 0) {
            const nextRoutes = routes.slice();
            nextRoutes[existingIdx] = { ...nextRoutes[existingIdx], targetNodeId: targetId };
            return { ...n, routes: nextRoutes };
          }
        }
        return {
          ...n,
          routes: [...routes, { id: newRouteId(), targetNodeId: targetId, when: "true", label: "" }],
        };
      }
      return { ...n, onExitTarget: targetId };
    }),
  };
}

/**
 * A generator wired straight off the trigger has nothing to read but the
 * inbound request, so seed the message expression rather than leaving the
 * prompt empty (which is a blocking validation error).
 */
function seedTriggerGeneratorPrompt(broker: Broker): Broker {
  const trigger = broker.nodes.find((n) => n.kind === "trigger");
  if (!trigger?.onExitTarget) return broker;
  const target = broker.nodes.find((n) => n.id === trigger.onExitTarget);
  if (!target || target.kind !== "generator" || target.prompt?.trim()) return broker;
  return {
    ...broker,
    nodes: broker.nodes.map((n) =>
      n.id === target.id ? { ...n, prompt: REQUEST_MESSAGE_TEXT_EXPRESSION } : n
    ),
  };
}

function uniqueNodeName(broker: Broker, kind: GraphNodeKind): string {
  const existing = new Set(broker.nodes.map((n) => n.name));
  if (kind === "trigger") {
    if (!existing.has("trigger")) return "trigger";
    let i = 2;
    while (existing.has(`trigger${i}`)) i += 1;
    return `trigger${i}`;
  }
  let i = 1;
  let name = `${kind}${i}`;
  while (existing.has(name)) {
    i += 1;
    name = `${kind}${i}`;
  }
  return name;
}

export function composerReducer(project: ComposerProject, action: ComposerAction): ComposerProject {
  const dependencyKey = (dep: {
    groupId: string;
    assetId: string;
    version: string;
    classifier: string;
    packaging?: string;
  }): string => `${dep.groupId}:${dep.assetId}:${dep.version}:${dep.classifier}:${dep.packaging ?? "zip"}`;

  const normalizedUnmatchedDependencies = (
    deps: Array<{ groupId: string; assetId: string; version: string; classifier: string; packaging: string }> | undefined
  ) => {
    const seen = new Set<string>();
    const out: Array<{ groupId: string; assetId: string; version: string; classifier: string; packaging: string }> = [];
    for (const dep of deps ?? []) {
      const key = dependencyKey(dep);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(dep);
    }
    return out;
  };

  const hasDependency = (target: {
    groupId: string;
    assetId: string;
    version: string;
    classifier: string;
    packaging?: string;
  }) => {
    const key = dependencyKey(target);
    for (const asset of project.assets) {
      const classifier =
        asset.kind === "agent"
          ? "agent-metadata"
          : asset.kind === "mcp"
            ? "mcp-metadata"
            : "llm-metadata";
      const dep = {
        groupId: asset.namespace || asset.groupId,
        assetId: asset.assetId,
        version: asset.version,
        classifier,
        packaging: asset.packaging ?? "zip",
      };
      if (dependencyKey(dep) === key) return true;
    }
    for (const dep of project.unmatchedDependencies ?? []) {
      if (dependencyKey(dep) === key) return true;
    }
    return false;
  };

  switch (action.type) {
    case "loadProject":
      return action.project;

    case "resetProject":
      return createEmptyProject(action.organizationId);

    case "setIdentity": {
      const patch = { ...action.patch };
      if (patch.organizationId !== undefined && project.identity.organizationId?.trim()) {
        delete patch.organizationId;
      }
      if (patch.descriptorVersion !== undefined) {
        delete patch.descriptorVersion;
      }
      return { ...project, identity: { ...project.identity, ...patch } };
    }

    case "setRegistry":
      return { ...project, registry: action.registry };

    case "addAsset": {
      const asset = assignDefaultConnectionName(project, action.asset);
      let next: ComposerProject = { ...project, assets: [...project.assets, asset] };
      // Auto-derive a broker action or llm binding from the composed asset.
      if (asset.kind === "llm") {
        const binding = createLlmBindingForAsset(asset);
        if (binding) {
          next = updateBroker(next, (b) => ({
            ...b,
            llmBindings: [...b.llmBindings, binding],
            defaultLlmBindingName: b.defaultLlmBindingName ?? binding.name,
          }));
        }
      } else {
        const usedNames = new Set(next.brokers[0]?.actions.map((a) => a.name) ?? []);
        if (asset.kind === "mcp") {
          const created = createActionsForMcpAsset(asset, usedNames);
          if (created.length > 0) {
            next = updateBroker(next, (b) => ({ ...b, actions: [...b.actions, ...created] }));
          }
        } else {
          const created = createActionForAsset(asset);
          if (created) {
            next = updateBroker(next, (b) => ({ ...b, actions: [...b.actions, created] }));
          }
        }
      }
      return next;
    }

    case "updateAsset": {
      const existing = project.assets.find((a) => a.id === action.id);
      let patch: Partial<ImportedAsset> =
        action.patch.policies !== undefined
          ? { ...action.patch, policies: sanitizeConnectionPolicies(action.patch.policies) }
          : action.patch;
      if (
        existing &&
        patch.assetId !== undefined &&
        patch.assetId !== existing.assetId
      ) {
        patch = { ...patch, meta: undefined };
      }
      const assets = project.assets.map((a) => (a.id === action.id ? { ...a, ...patch } : a));
      const updated = assets.find((a) => a.id === action.id);
      const policyBindings = updated
        ? pruneUnreferencedPolicyBindings(project.policyBindings, { ...project, assets })
        : project.policyBindings;
      const next = { ...project, assets, policyBindings };

      // Actions and llm bindings target a connection by name, so a rename has to
      // carry through or they stop resolving.
      const prevConn = existing ? connectionNameForAsset(existing) : null;
      const nextConn = updated ? connectionNameForAsset(updated) : null;
      if (!prevConn || !nextConn || prevConn === nextConn) return next;
      return updateBroker(next, (b) => ({
        ...b,
        actions: b.actions.map((ac) => (ac.connectionName === prevConn ? { ...ac, connectionName: nextConn } : ac)),
        llmBindings: b.llmBindings.map((lb) =>
          lb.connectionName === prevConn ? { ...lb, connectionName: nextConn } : lb
        ),
      }));
    }

    case "updatePolicyBinding": {
      const existing = project.policyBindings[action.bindingName] ?? {
        ref: { name: action.bindingName },
        configuration: {},
      };
      let next: ComposerProject = {
        ...project,
        policyBindings: {
          ...project.policyBindings,
          [action.bindingName]: { ...existing, ...action.patch },
        },
      };
      const nextBinding = next.policyBindings[action.bindingName];
      const version = nextBinding.templateVersion?.trim();
      if (version) {
        const dep = {
          groupId: nextBinding.ref.namespace ?? project.identity.organizationId,
          assetId: nextBinding.ref.name,
          version,
          classifier: "schema",
          packaging: "zip",
        };
        if (!hasDependency(dep)) {
          next = {
            ...next,
            unmatchedDependencies: normalizedUnmatchedDependencies([
              ...(next.unmatchedDependencies ?? []),
              dep,
            ]),
          };
        }
      }
      return next;
    }

    case "ensurePolicyBinding": {
      const existing = project.policyBindings[action.bindingName];
      const next: ComposerProject = existing
        ? project
        : {
            ...project,
            policyBindings: {
              ...project.policyBindings,
              [action.bindingName]: action.binding,
            },
          };
      const binding = next.policyBindings[action.bindingName];
      const version = binding?.templateVersion?.trim();
      if (!binding || !version) return next;
      const dep = {
        groupId: binding.ref.namespace ?? project.identity.organizationId,
        assetId: binding.ref.name,
        version,
        classifier: "schema",
        packaging: "zip",
      };
      if (hasDependency(dep)) return next;
      return {
        ...next,
        unmatchedDependencies: normalizedUnmatchedDependencies([
          ...(next.unmatchedDependencies ?? []),
          dep,
        ]),
      };
    }

    case "upsertUnmatchedDependency": {
      const dep = {
        ...action.dependency,
        packaging: action.dependency.packaging ?? "zip",
      };
      if (hasDependency(dep)) return project;
      return {
        ...project,
        unmatchedDependencies: normalizedUnmatchedDependencies([
          ...(project.unmatchedDependencies ?? []),
          dep,
        ]),
      };
    }

    case "removeUnmatchedDependency": {
      const key = dependencyKey({
        ...action.dependency,
        packaging: action.dependency.packaging ?? "zip",
      });
      const next = (project.unmatchedDependencies ?? []).filter(
        (dep) => dependencyKey(dep) !== key
      );
      if (next.length === (project.unmatchedDependencies ?? []).length) return project;
      return { ...project, unmatchedDependencies: next };
    }

    case "convertRegistryEntityToDependency":
      return applyConvertRegistryEntityToDependency(project, action);

    case "removeAsset": {
      const asset = project.assets.find((a) => a.id === action.id);
      const next = { ...project, assets: project.assets.filter((a) => a.id !== action.id) };
      if (!asset) return next;
      const connName = connectionNameForAsset(asset);
      const nextAssets = next.assets;
      const pruned = pruneUnreferencedPolicyBindings(next.policyBindings, { ...next, assets: nextAssets });
      return updateBroker({ ...next, policyBindings: pruned }, (b) => {
        const droppedActions = b.actions.filter((ac) => ac.connectionName === connName);
        const droppedBindings = b.llmBindings.filter((lb) => lb.connectionName === connName);
        let updated: Broker = {
          ...b,
          actions: b.actions.filter((ac) => ac.connectionName !== connName),
          llmBindings: b.llmBindings.filter((lb) => lb.connectionName !== connName),
        };
        for (const ac of droppedActions) updated = remapActionRefs(updated, ac.name, null);
        for (const lb of droppedBindings) updated = remapLlmRefs(updated, lb.name, null);
        return updated;
      });
    }

    case "setVariableOverride":
      return {
        ...project,
        variableOverrides: {
          ...project.variableOverrides,
          [action.key]: { ...project.variableOverrides?.[action.key], ...action.patch },
        },
      };

    case "addCustomVariable": {
      const existing = project.customVariables ?? [];
      if (existing.some((v) => customVariablesMatch(v, action.variable))) return project;
      return { ...project, customVariables: [...existing, action.variable] };
    }

    case "updateCustomVariable":
      return {
        ...project,
        customVariables: (project.customVariables ?? []).map((v) => {
          const matches = action.flat
            ? v.flat === true && v.field === action.field
            : !v.flat && v.group === action.group && v.field === action.field;
          return matches ? { ...v, ...action.patch } : v;
        }),
      };

    case "removeCustomVariable":
      return {
        ...project,
        customVariables: (project.customVariables ?? []).filter((v) =>
          action.flat
            ? !(v.flat && v.field === action.field)
            : !(v.group === action.group && v.field === action.field && !v.flat)
        ),
      };

    case "updateBroker": {
      let next = updateBroker(project, (b) => {
        const updated = { ...b, ...action.patch };
        if (action.patch.interfacePolicies !== undefined) {
          updated.card = stripStoredCardSecurity(updated.card);
        }
        return updated;
      });
      if (action.patch.interfacePolicies !== undefined) {
        next = {
          ...next,
          policyBindings: pruneUnreferencedPolicyBindings(next.policyBindings, next),
        };
      }
      return next;
    }

    case "updateCard":
      return updateBroker(project, (b) => {
        const patch = { ...action.patch };
        delete patch.securitySchemes;
        delete patch.securityRequirements;
        if (patch.skills) {
          patch.skills = patch.skills.map((skill) => {
            const nextSkill = { ...skill };
            delete nextSkill.securityRequirements;
            return nextSkill;
          });
        }
        return { ...b, card: stripStoredCardSecurity({ ...b.card, ...patch }) };
      });

    case "setDefaultLlm":
      return updateBroker(project, (b) => ({ ...b, defaultLlmBindingName: action.bindingName }));

    case "addLlmBinding":
      return updateBroker(project, (b) => ({ ...b, llmBindings: [...b.llmBindings, action.binding] }));

    case "updateLlmBinding":
      return updateBroker(project, (b) => {
        const existing = b.llmBindings.find((lb) => lb.id === action.id);
        const next: Broker = {
          ...b,
          llmBindings: b.llmBindings.map((lb) => (lb.id === action.id ? { ...lb, ...action.patch } : lb)),
        };
        const renamed = action.patch.name;
        if (!existing || renamed === undefined || renamed === existing.name) return next;
        return remapLlmRefs(next, existing.name, renamed);
      });

    case "removeLlmBinding":
      return updateBroker(project, (b) => {
        const existing = b.llmBindings.find((lb) => lb.id === action.id);
        const next: Broker = { ...b, llmBindings: b.llmBindings.filter((lb) => lb.id !== action.id) };
        return existing ? remapLlmRefs(next, existing.name, null) : next;
      });

    case "addAction":
      return updateBroker(project, (b) => ({ ...b, actions: [...b.actions, action.action] }));

    case "updateAction":
      return updateBroker(project, (b) => {
        const existing = b.actions.find((ac) => ac.id === action.id);
        const next: Broker = {
          ...b,
          actions: b.actions.map((ac) => (ac.id === action.id ? { ...ac, ...action.patch } : ac)),
        };
        const renamed = action.patch.name;
        if (!existing || renamed === undefined || renamed === existing.name) return next;
        return remapActionRefs(next, existing.name, renamed);
      });

    case "removeAction":
      return updateBroker(project, (b) => {
        const existing = b.actions.find((ac) => ac.id === action.id);
        const next: Broker = { ...b, actions: b.actions.filter((ac) => ac.id !== action.id) };
        return existing ? remapActionRefs(next, existing.name, null) : next;
      });

    case "addNode":
      return updateBroker(project, (b) => {
        if (action.kind === "trigger" && b.nodes.some((n) => n.kind === "trigger")) return b;
        const name = uniqueNodeName(b, action.kind);
        const created = createNode(action.kind, name, action.position);
        const node = {
          ...created,
          ...(action.id ? { id: action.id } : {}),
          ...(action.kind === "trigger" ? { interfaceName: b.interfaceName } : {}),
        };
        const withNode: Broker = { ...b, nodes: [...b.nodes, node] };
        return seedTriggerGeneratorPrompt(autoWireTriggerOnAdd(withNode, node, action.connectFrom));
      });

    case "insertNodeOnEdge":
      return updateBroker(project, (b) => {
        if (action.kind === "trigger" || action.kind === "echo") return b;
        const name = uniqueNodeName(b, action.kind);
        const created = createNode(action.kind, name, action.position);
        const node = { ...created, ...(action.id ? { id: action.id } : {}) };
        const withNode: Broker = { ...b, nodes: [...b.nodes, node] };
        const rewired = connectNodes(withNode, action.sourceId, node.id, action.sourceHandle);
        return seedTriggerGeneratorPrompt(connectNodes(rewired, node.id, action.targetId, null));
      });

    case "updateNode":
      return updateBroker(project, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => {
          if (n.id !== action.id) return n;
          const patch = { ...action.patch };
          if (patch.onExitTarget !== undefined) {
            const target = b.nodes.find((candidate) => candidate.id === patch.onExitTarget);
            if (!isAllowedTransitionTarget(target)) delete patch.onExitTarget;
          }
          if (patch.otherwiseTargetNodeId !== undefined) {
            const target = b.nodes.find((candidate) => candidate.id === patch.otherwiseTargetNodeId);
            if (!isAllowedTransitionTarget(target)) delete patch.otherwiseTargetNodeId;
          }
          if (patch.routes !== undefined) {
            patch.routes = patch.routes.filter((route) => {
              const target = b.nodes.find((candidate) => candidate.id === route.targetNodeId);
              return isAllowedTransitionTarget(target);
            });
          }
          return { ...n, ...patch };
        }),
      }));

    case "moveNode":
      return {
        ...updateBroker(project, (b) => ({
          ...b,
          nodes: b.nodes.map((n) => (n.id === action.id ? { ...n, position: action.position } : n)),
        })),
        graphLayoutPinned: true,
      };

    case "layoutNodes":
      return updateBroker(project, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => {
          const position = action.positions[n.id];
          return position ? { ...n, position } : n;
        }),
      }));

    case "resetGraphLayoutToHierarchical": {
      const direction = action.direction ?? project.graphLayoutDirection ?? "vertical";
      if (project.brokers.length === 0) {
        return { ...project, graphLayoutPinned: false, graphLayoutDirection: direction };
      }
      const broker = applyHierarchicalGraphLayout(project.brokers[0], direction);
      const brokers = project.brokers.slice();
      brokers[0] = broker;
      return { ...project, brokers, graphLayoutPinned: false, graphLayoutDirection: direction };
    }

    case "removeNode":
      return updateBroker(project, (b) => {
        // The trigger is the graph's entry point — deleting it strands every node.
        if (b.nodes.find((n) => n.id === action.id)?.kind === "trigger") return b;
        return {
          ...b,
          nodes: b.nodes
            .filter((n) => n.id !== action.id)
            // Clear dangling transitions to the removed node.
            .map((n) => ({
              ...n,
              onExitTarget: n.onExitTarget === action.id ? undefined : n.onExitTarget,
              otherwiseTargetNodeId:
                n.otherwiseTargetNodeId === action.id ? undefined : n.otherwiseTargetNodeId,
              routes: n.routes?.filter((r) => r.targetNodeId !== action.id),
            })),
        };
      });

    case "connect":
      return updateBroker(project, (b) =>
        seedTriggerGeneratorPrompt(
          connectNodes(b, action.sourceId, action.targetId, action.sourceHandle)
        )
      );

    case "disconnect":
      return updateBroker(project, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => {
          if (n.id !== action.sourceId) return n;
          if (n.kind === "router") {
            const routes = n.routes ?? [];
            const routeId = routerOutputFromHandleId(action.sourceHandle);
            if (routeId === ROUTER_OTHERWISE_SLOT) {
              return { ...n, otherwiseTargetNodeId: undefined };
            }
            if (routeId && routeId !== ROUTER_ROUTE_SLOT) {
              return { ...n, routes: routes.filter((route) => route.id !== routeId) };
            }
            return {
              ...n,
              routes: routes.filter((route) => route.targetNodeId !== action.targetId),
              otherwiseTargetNodeId:
                n.otherwiseTargetNodeId === action.targetId ? undefined : n.otherwiseTargetNodeId,
            };
          }
          return { ...n, onExitTarget: n.onExitTarget === action.targetId ? undefined : n.onExitTarget };
        }),
      }));

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

interface ComposerStore {
  project: ComposerProject;
  dispatch: Dispatch<ComposerAction>;
  undo: () => void;
  redo: () => void;
  /** Ends the current typing run so the next edit starts a new undo entry. */
  checkpoint: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const ComposerContext = createContext<ComposerStore | null>(null);

function reduceWithHistory(state: HistoryState, action: HistoryAction): HistoryState {
  return historyReducer(state, action, composerReducer);
}

export function ComposerProvider({
  children,
  initialProject,
}: {
  children: ReactNode;
  initialProject?: ComposerProject;
}) {
  const [history, dispatchHistory] = useReducer(
    reduceWithHistory,
    initialProject ?? createEmptyProject(),
    initHistory
  );
  const project = history.present;
  const [sessionReady, setSessionReady] = useState(Boolean(initialProject));

  useEffect(() => {
    if (initialProject) return;
    const restored = loadComposerProjectFromSession();
    if (restored) dispatchHistory({ type: "loadProject", project: restored });
    setSessionReady(true);
  }, [initialProject]);

  useEffect(() => {
    if (!sessionReady) return;
    saveComposerProjectToSession(project);
  }, [project, sessionReady]);

  const dispatch = dispatchHistory as Dispatch<ComposerAction>;
  const undo = useCallback(() => dispatchHistory({ type: "history/undo" }), []);
  const redo = useCallback(() => dispatchHistory({ type: "history/redo" }), []);
  const checkpoint = useCallback(() => dispatchHistory({ type: "history/checkpoint" }), []);

  const value = useMemo(
    () => ({
      project,
      dispatch,
      undo,
      redo,
      checkpoint,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
    }),
    [project, dispatch, undo, redo, checkpoint, history.past.length, history.future.length]
  );
  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

export function useComposer(): ComposerStore {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error("useComposer must be used within a ComposerProvider");
  return ctx;
}
