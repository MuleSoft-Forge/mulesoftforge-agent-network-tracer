"use client";

/**
 * Composer store: a single `ComposerProject` edited via a reducer. The model is
 * the only editable source of truth; the file views subscribe and re-serialize.
 */

import { createContext, useContext, useMemo, useReducer } from "react";
import type { Dispatch, ReactNode } from "react";
import type {
  Broker,
  BrokerAction,
  ComposerProject,
  GraphNode,
  GraphNodeKind,
  ImportedAsset,
  LlmBinding,
  ProjectIdentity,
  VariableOverride,
} from "@/lib/composer/model";
import { connectionNameForAsset } from "@/lib/composer/model";
import {
  createActionForAsset,
  createEmptyProject,
  createLlmBindingForAsset,
  createNode,
} from "@/lib/composer/factory";

export type ComposerAction =
  | { type: "loadProject"; project: ComposerProject }
  | { type: "resetProject"; organizationId?: string }
  | { type: "setIdentity"; patch: Partial<ProjectIdentity> }
  | { type: "addAsset"; asset: ImportedAsset }
  | { type: "updateAsset"; id: string; patch: Partial<ImportedAsset> }
  | { type: "removeAsset"; id: string }
  | { type: "setVariableOverride"; key: string; patch: VariableOverride }
  | { type: "updateBroker"; patch: Partial<Omit<Broker, "id" | "nodes" | "actions" | "llmBindings">> }
  | { type: "updateCard"; patch: Partial<Broker["card"]> }
  | { type: "setDefaultLlm"; bindingName: string | undefined }
  | { type: "addLlmBinding"; binding: LlmBinding }
  | { type: "updateLlmBinding"; id: string; patch: Partial<LlmBinding> }
  | { type: "removeLlmBinding"; id: string }
  | { type: "addAction"; action: BrokerAction }
  | { type: "updateAction"; id: string; patch: Partial<BrokerAction> }
  | { type: "removeAction"; id: string }
  | { type: "addNode"; kind: GraphNodeKind; position: { x: number; y: number } }
  | { type: "updateNode"; id: string; patch: Partial<GraphNode> }
  | { type: "moveNode"; id: string; position: { x: number; y: number } }
  | { type: "removeNode"; id: string }
  | { type: "connect"; sourceId: string; targetId: string }
  | { type: "disconnect"; sourceId: string; targetId: string };

function updateBroker(project: ComposerProject, fn: (b: Broker) => Broker): ComposerProject {
  if (project.brokers.length === 0) return project;
  const brokers = project.brokers.slice();
  brokers[0] = fn(brokers[0]);
  return { ...project, brokers };
}

function uniqueNodeName(broker: Broker, kind: GraphNodeKind): string {
  let i = 1;
  const existing = new Set(broker.nodes.map((n) => n.name));
  let name = `${kind}${i}`;
  while (existing.has(name)) {
    i += 1;
    name = `${kind}${i}`;
  }
  return name;
}

export function composerReducer(project: ComposerProject, action: ComposerAction): ComposerProject {
  switch (action.type) {
    case "loadProject":
      return action.project;

    case "resetProject":
      return createEmptyProject(action.organizationId);

    case "setIdentity":
      return { ...project, identity: { ...project.identity, ...action.patch } };

    case "addAsset": {
      const asset = action.asset;
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
        const created = createActionForAsset(asset);
        if (created) {
          next = updateBroker(next, (b) => ({ ...b, actions: [...b.actions, created] }));
        }
      }
      return next;
    }

    case "updateAsset":
      return {
        ...project,
        assets: project.assets.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)),
      };

    case "removeAsset": {
      const asset = project.assets.find((a) => a.id === action.id);
      const next = { ...project, assets: project.assets.filter((a) => a.id !== action.id) };
      if (!asset) return next;
      const connName = connectionNameForAsset(asset);
      return updateBroker(next, (b) => ({
        ...b,
        actions: b.actions.filter((ac) => ac.connectionName !== connName),
        llmBindings: b.llmBindings.filter((lb) => lb.connectionName !== connName),
      }));
    }

    case "setVariableOverride":
      return {
        ...project,
        variableOverrides: { ...project.variableOverrides, [action.key]: action.patch },
      };

    case "updateBroker":
      return updateBroker(project, (b) => ({ ...b, ...action.patch }));

    case "updateCard":
      return updateBroker(project, (b) => ({ ...b, card: { ...b.card, ...action.patch } }));

    case "setDefaultLlm":
      return updateBroker(project, (b) => ({ ...b, defaultLlmBindingName: action.bindingName }));

    case "addLlmBinding":
      return updateBroker(project, (b) => ({ ...b, llmBindings: [...b.llmBindings, action.binding] }));

    case "updateLlmBinding":
      return updateBroker(project, (b) => ({
        ...b,
        llmBindings: b.llmBindings.map((lb) => (lb.id === action.id ? { ...lb, ...action.patch } : lb)),
      }));

    case "removeLlmBinding":
      return updateBroker(project, (b) => ({
        ...b,
        llmBindings: b.llmBindings.filter((lb) => lb.id !== action.id),
      }));

    case "addAction":
      return updateBroker(project, (b) => ({ ...b, actions: [...b.actions, action.action] }));

    case "updateAction":
      return updateBroker(project, (b) => ({
        ...b,
        actions: b.actions.map((ac) => (ac.id === action.id ? { ...ac, ...action.patch } : ac)),
      }));

    case "removeAction":
      return updateBroker(project, (b) => ({
        ...b,
        actions: b.actions.filter((ac) => ac.id !== action.id),
      }));

    case "addNode":
      return updateBroker(project, (b) => {
        const name = uniqueNodeName(b, action.kind);
        return { ...b, nodes: [...b.nodes, createNode(action.kind, name, action.position)] };
      });

    case "updateNode":
      return updateBroker(project, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === action.id ? { ...n, ...action.patch } : n)),
      }));

    case "moveNode":
      return updateBroker(project, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === action.id ? { ...n, position: action.position } : n)),
      }));

    case "removeNode":
      return updateBroker(project, (b) => ({
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
      }));

    case "connect":
      return updateBroker(project, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => {
          if (n.id !== action.sourceId) return n;
          if (n.kind === "router") {
            // Add a route (or set otherwise if none yet).
            const routes = n.routes ?? [];
            return {
              ...n,
              routes: [
                ...routes,
                {
                  id: `route-${Math.random().toString(36).slice(2)}`,
                  targetNodeId: action.targetId,
                  when: "true",
                  label: "",
                },
              ],
            };
          }
          if (n.kind === "echo") return n; // terminal
          return { ...n, onExitTarget: action.targetId };
        }),
      }));

    case "disconnect":
      return updateBroker(project, (b) => ({
        ...b,
        nodes: b.nodes.map((n) => {
          if (n.id !== action.sourceId) return n;
          if (n.kind === "router") {
            return {
              ...n,
              routes: n.routes?.filter((r) => r.targetNodeId !== action.targetId),
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
}

const ComposerContext = createContext<ComposerStore | null>(null);

export function ComposerProvider({
  children,
  initialProject,
}: {
  children: ReactNode;
  initialProject?: ComposerProject;
}) {
  const [project, dispatch] = useReducer(
    composerReducer,
    initialProject ?? createEmptyProject()
  );
  const value = useMemo(() => ({ project, dispatch }), [project]);
  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

export function useComposer(): ComposerStore {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error("useComposer must be used within a ComposerProvider");
  return ctx;
}
