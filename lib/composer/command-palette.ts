/** Command palette entries and matching, kept pure so they can be unit tested. */

import type { ComposerProject } from "@/lib/composer/model";
import { PANEL_TAB_GROUPS, type PanelTab } from "@/lib/composer/panel-tabs";

export type CommandAction =
  | { kind: "openTab"; tab: PanelTab }
  | { kind: "selectNode"; nodeId: string }
  | { kind: "addNode"; nodeKind: string }
  | { kind: "resetLayout" }
  | { kind: "toggleHelp" }
  | { kind: "undo" }
  | { kind: "redo" };

export interface Command {
  id: string;
  label: string;
  /** Short category shown to the right of the label. */
  group: string;
  /** Extra text matched against the query but not displayed. */
  keywords?: string;
  action: CommandAction;
}

const ADDABLE_KINDS = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];

export function buildCommands(project: ComposerProject): Command[] {
  const commands: Command[] = [];

  for (const group of PANEL_TAB_GROUPS) {
    for (const tab of group.tabs) {
      commands.push({
        id: `tab:${tab.id}`,
        label: `Go to ${tab.label}`,
        group: group.title,
        keywords: tab.id,
        action: { kind: "openTab", tab: tab.id },
      });
    }
  }

  const broker = project.brokers[0];
  if (broker) {
    for (const node of broker.nodes) {
      commands.push({
        id: `node:${node.id}`,
        label: node.name,
        group: node.kind,
        keywords: `${node.kind} ${node.label ?? ""}`,
        action: { kind: "selectNode", nodeId: node.id },
      });
    }
    if (!broker.nodes.some((n) => n.kind === "trigger")) {
      commands.push({
        id: "add:trigger",
        label: "Add trigger node",
        group: "Add",
        action: { kind: "addNode", nodeKind: "trigger" },
      });
    }
    for (const kind of ADDABLE_KINDS) {
      commands.push({
        id: `add:${kind}`,
        label: `Add ${kind} node`,
        group: "Add",
        action: { kind: "addNode", nodeKind: kind },
      });
    }
  }

  commands.push(
    { id: "cmd:resetLayout", label: "Reset to hierarchical layout", group: "Canvas", action: { kind: "resetLayout" } },
    { id: "cmd:help", label: "Toggle help mode", group: "View", action: { kind: "toggleHelp" } },
    { id: "cmd:undo", label: "Undo", group: "Edit", action: { kind: "undo" } },
    { id: "cmd:redo", label: "Redo", group: "Edit", action: { kind: "redo" } }
  );

  return commands;
}

/**
 * Subsequence match (so "gen" matches "Add generator node" and "aden" does not
 * need to be contiguous), ranked by how early and how tightly the query hits.
 */
export function scoreCommand(command: Command, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const haystack = `${command.label} ${command.keywords ?? ""} ${command.group}`.toLowerCase();

  const direct = command.label.toLowerCase().indexOf(q);
  if (direct === 0) return 1000;
  if (direct > 0) return 800 - direct;
  if (haystack.includes(q)) return 500;

  let index = 0;
  let spread = 0;
  let last = -1;
  for (const char of q) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return null;
    if (last >= 0) spread += found - last;
    last = found;
    index = found + 1;
  }
  return 200 - Math.min(spread, 190);
}

export function filterCommands(commands: Command[], query: string, limit = 12): Command[] {
  const scored: Array<{ command: Command; score: number }> = [];
  for (const command of commands) {
    const score = scoreCommand(command, query);
    if (score !== null) scored.push({ command, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.command);
}
