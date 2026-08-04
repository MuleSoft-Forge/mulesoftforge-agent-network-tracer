/**
 * Undo/redo wrapper around the composer reducer.
 *
 * Rapid edits to the same field (typing) collapse into a single history entry so
 * one undo reverts a word rather than a keystroke. Coalescing is keyed on the
 * action shape and only merges *consecutive* runs, keeping the reducer pure.
 */

import type { ComposerProject } from "@/lib/composer/model";
import type { ComposerAction } from "@/lib/composer/store";

export const HISTORY_LIMIT = 100;

export interface HistoryState {
  past: ComposerProject[];
  present: ComposerProject;
  future: ComposerProject[];
  /** Coalescing key of the last committed action; null breaks the run. */
  lastKey: string | null;
}

export type HistoryAction =
  | ComposerAction
  | { type: "history/undo" }
  | { type: "history/redo" }
  /** Ends the current coalescing run without changing the project (e.g. field blur). */
  | { type: "history/checkpoint" };

/**
 * Which actions merge with an identical preceding action. Declared as a full
 * Record so a newly added ComposerAction must opt in or out explicitly.
 */
const COALESCES: Record<ComposerAction["type"], boolean> = {
  loadProject: false,
  resetProject: false,
  setIdentity: true,
  setRegistry: true,
  addAsset: false,
  updateAsset: true,
  updatePolicyBinding: true,
  ensurePolicyBinding: false,
  removeAsset: false,
  convertRegistryEntityToDependency: false,
  setVariableOverride: true,
  addCustomVariable: false,
  updateCustomVariable: true,
  removeCustomVariable: false,
  updateBroker: true,
  updateCard: true,
  setDefaultLlm: false,
  addLlmBinding: false,
  updateLlmBinding: true,
  removeLlmBinding: false,
  addAction: false,
  updateAction: true,
  removeAction: false,
  addNode: false,
  insertNodeOnEdge: false,
  updateNode: true,
  moveNode: false,
  layoutNodes: false,
  resetGraphLayoutToHierarchical: false,
  removeNode: false,
  connect: false,
  disconnect: false,
};

/** Actions that discard history entirely — the project is being replaced. */
function resetsHistory(action: ComposerAction): boolean {
  return action.type === "loadProject" || action.type === "resetProject";
}

/**
 * Identity of a coalescing run. Includes the patched field names so moving from
 * one field to another in the same object starts a new entry.
 */
export function coalesceKey(action: ComposerAction): string | null {
  if (!COALESCES[action.type]) return null;

  switch (action.type) {
    case "updateNode":
    case "updateAsset":
    case "updateAction":
    case "updateLlmBinding":
      return `${action.type}:${action.id}:${Object.keys(action.patch).sort().join(",")}`;
    case "setIdentity":
    case "updateBroker":
    case "updateCard":
      return `${action.type}:${Object.keys(action.patch).sort().join(",")}`;
    case "updatePolicyBinding":
      return `${action.type}:${action.bindingName}:${Object.keys(action.patch).sort().join(",")}`;
    case "setVariableOverride":
      return `${action.type}:${action.key}`;
    case "updateCustomVariable":
      return `${action.type}:${action.group}.${action.field}`;
    default:
      return action.type;
  }
}

export function initHistory(present: ComposerProject): HistoryState {
  return { past: [], present, future: [], lastKey: null };
}

export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
  reduce: (project: ComposerProject, action: ComposerAction) => ComposerProject
): HistoryState {
  if (action.type === "history/undo") {
    const previous = state.past[state.past.length - 1];
    if (previous === undefined) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      lastKey: null,
    };
  }

  if (action.type === "history/redo") {
    const next = state.future[0];
    if (next === undefined) return state;
    return {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1),
      lastKey: null,
    };
  }

  if (action.type === "history/checkpoint") {
    return state.lastKey === null ? state : { ...state, lastKey: null };
  }

  const present = reduce(state.present, action);
  if (present === state.present) return state;

  if (resetsHistory(action)) {
    return { past: [], present, future: [], lastKey: null };
  }

  const key = coalesceKey(action);
  // Merge into the current entry rather than pushing a new one.
  if (key !== null && key === state.lastKey && state.past.length > 0) {
    return { past: state.past, present, future: [], lastKey: key };
  }

  const past = [...state.past, state.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present,
    future: [],
    lastKey: key,
  };
}
