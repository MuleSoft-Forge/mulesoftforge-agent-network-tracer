import type { Dispatch } from "react";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import {
  extractJsonRpcErrorMessage,
  normalizeA2AVersion,
} from "./a2a-version";
import { findBrokerNodeId } from "./graph-builder";
import type { InvokeAction, InvokeAuthConfig, InvokeMessage } from "./types";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ANT_THINKING_STEP_MS = 3200;
const ANT_THINKING_STEPS = [
  "🐜 ANT scout is wiggling antennae to map the path…",
  "🐜 ANT workers are marching packets in a neat little line…",
  "🐜 ANT is carrying one byte at a time (teamwork makes the dream work)…",
  "🐜 ANT queen approved this route: efficient and very ant-tastic…",
  "🐜 ANT colony is tunneling through APIs crumb by crumb…",
  "🐜 ANT scribes are drawing the graph in sugar lines…",
  "🐜 ANT engineers are reinforcing the bridge to your broker…",
  "🐜 ANT navigators are following pheromone trails to the right skill…",
  "🐜 ANT couriers are hauling context back to the nest…",
  "🐜 ANT is doing a tiny victory dance while waiting for the reply…",
  "🐜 ANT foreman says: stay calm, the colony is routing…",
  "🐜 ANT orchestra is synchronizing tiny footsteps and tool calls…",
] as const;

function newMsg(role: InvokeMessage["role"], content: string): InvokeMessage {
  return { id: crypto.randomUUID(), role, content, timestamp: new Date() };
}

// ── A2A response extraction ───────────────────────────────────────────────────
//
// A2A message/send (and SendMessage v1) responses carry task status, artifact
// text parts, and optional history — not a standard "skill used" or downstream
// agent/MCP identifier. Skills live on the AgentCard manifest only. Artifact
// metadata is extension-specific and not parsed here. Use Tracer task/callstack
// for factual routing after the fact.

function extractPartsText(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  const texts: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object") {
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") texts.push(p.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

function extractTextFromResultObject(result: Record<string, unknown>): string | null {
  const task = result.task as Record<string, unknown> | undefined;
  if (task) {
    const taskArtifacts = task.artifacts as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(taskArtifacts) && taskArtifacts.length > 0) {
      const texts: string[] = [];
      for (const artifact of taskArtifacts) {
        const t = extractPartsText(artifact.parts);
        if (t) texts.push(t);
      }
      if (texts.length > 0) return texts.join("\n");
    }
    const taskStatus = task.status as Record<string, unknown> | undefined;
    const taskStatusMsg = taskStatus?.message as Record<string, unknown> | undefined;
    if (taskStatusMsg) {
      const t = extractPartsText(taskStatusMsg.parts);
      if (t) return t;
    }
  }

  const artifacts = result.artifacts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(artifacts) && artifacts.length > 0) {
    const texts: string[] = [];
    for (const artifact of artifacts) {
      const t = extractPartsText(artifact.parts);
      if (t) texts.push(t);
    }
    if (texts.length > 0) return texts.join("\n");
  }
  const directParts = extractPartsText(result.parts);
  if (directParts) return directParts;
  const msg = result.message as Record<string, unknown> | undefined;
  if (msg) {
    const t = extractPartsText(msg.parts);
    if (t) return t;
    if (typeof msg.content === "string") return msg.content;
  }
  const status = result.status as Record<string, unknown> | undefined;
  if (status) {
    const statusMsg = status.message as Record<string, unknown> | undefined;
    if (statusMsg) {
      const t = extractPartsText(statusMsg.parts);
      if (t) return t;
    }
  }
  for (const key of ["response", "answer", "output", "text", "content", "reply"]) {
    if (typeof result[key] === "string") return result[key] as string;
  }
  return null;
}

function extractTextFromA2AResponse(data: unknown): string {
  if (typeof data === "string" && data.trim()) return data;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const result = obj.result as Record<string, unknown> | undefined;
    if (result) {
      const fromResult = extractTextFromResultObject(result);
      if (fromResult) return fromResult;
    }
    for (const key of ["response", "answer", "output", "text", "content", "reply", "message"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
    return `Broker returned an unrecognised format. Raw: ${JSON.stringify(data).slice(0, 300)}`;
  }
  return String(data);
}

// ── Simulation (no broker URL — offline demo only) ───────────────────────────

function detectSimulatedTargetNodes(text: string, graph: CanonicalGraph): CanonicalGraph["nodes"] {
  const subNodes = graph.nodes.filter((n) => n.type === "AGENT" || n.type === "MCP");
  const lower = text.toLowerCase();
  const hits = subNodes.filter((n) => {
    const words = n.label.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => lower.includes(w));
  });
  const picked =
    hits.length > 0 ? hits : subNodes.slice(0, Math.min(2, subNodes.length));
  return picked;
}

function getSimulatedResponse(label: string, query: string): string {
  const lower = query.toLowerCase();
  const name = label.toLowerCase();
  if (/erp|inventory|distribution|sap/.test(name)) {
    if (/inventory|stock/.test(lower)) return "SAP ERP: 1,240 MWh stored, 312 MWh committed.";
    if (/order/.test(lower)) return "SAP ERP: 12 open orders — Order #ERP-2891 (500 MWh, due next week).";
    return "SAP ERP: 3 active contracts, 847 MWh available Q3.";
  }
  if (/crm|account|customer|salesforce/.test(name)) {
    if (/account|customer/.test(lower)) return "Salesforce CRM: 4 accounts flagged for renewal this quarter.";
    return "Salesforce CRM: Account 'Energa SA' — Tier 1 customer, renewal window Q3.";
  }
  if (/search|google|mcp|market|web/.test(name)) {
    if (/energy|price/.test(lower)) return "Nord Pool day-ahead: €79.4/MWh DE/LU, €81.2/MWh FR.";
    return "EU energy prices stabilised at €82/MWh (TTF gas spot).";
  }
  return `${label}: processed "${query.slice(0, 60)}${query.length > 60 ? "…" : ""}".`;
}

function synthesize(results: { name: string; text: string }[], query: string): string {
  if (results.length === 1) {
    return `🐜 ANT scout report from ${results[0].name}:\n\n${results[0].text}\n\n✨ Colony note: one clean trail, one clear answer.`;
  }
  const parts = results.map((r) => `**${r.name}**\n${r.text}`).join("\n\n");
  return `🐜 ANT colony gathered data from ${results.length} agents for "${query.slice(0, 60)}${query.length > 60 ? "…" : ""}":\n\n${parts}\n\n✅ ANT-tastic outcome: all systems nominal and marching in formation.`;
}

// ── Real broker call (via same-origin server proxy) ──────────────────────────

export async function callRealBroker(
  userMessage: string,
  brokerUrl: string,
  graph: CanonicalGraph,
  dispatch: Dispatch<InvokeAction>,
  auth: InvokeAuthConfig,
  a2aVersion = "0.3"
): Promise<void> {
  const brokerId = findBrokerNodeId(graph);

  dispatch({ type: "SET_PROCESSING", value: true, step: ANT_THINKING_STEPS[0] });
  dispatch({ type: "RESET_NODE_STATUSES" });

  if (brokerId) {
    dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: brokerId });
  }

  let responseText = "";
  let callError = "";
  let thinkingTimer: ReturnType<typeof setInterval> | null = null;

  try {
    let stepIndex = 0;
    thinkingTimer = setInterval(() => {
      stepIndex = (stepIndex + 1) % ANT_THINKING_STEPS.length;
      dispatch({ type: "SET_CURRENT_STEP", step: ANT_THINKING_STEPS[stepIndex] });
    }, ANT_THINKING_STEP_MS);

    const res = await fetch("/api/invoke/broker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brokerUrl,
        message: userMessage,
        a2aVersion: normalizeA2AVersion(a2aVersion) ?? "0.3",
        auth,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(
        (errBody as Record<string, unknown>).error as string ?? `HTTP ${res.status}`
      );
    }
    const data = await res.json();
    const jsonRpcError = extractJsonRpcErrorMessage(data);
    if (jsonRpcError) {
      throw new Error(jsonRpcError);
    }
    responseText = extractTextFromA2AResponse(data);
  } catch (err) {
    callError = err instanceof Error ? err.message : "Unknown error";
  } finally {
    if (thinkingTimer) clearInterval(thinkingTimer);
  }

  if (callError) {
    if (brokerId) dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "error" });
    dispatch({
      type: "ADD_MESSAGE",
      message: newMsg("error", `🐜 Oops, ANT hit a pebble in the tunnel.\nBroker call failed: ${callError}`),
    });
    dispatch({ type: "SET_PROCESSING", value: false });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: null });
    await delay(2000);
    dispatch({ type: "RESET_NODE_STATUSES" });
    return;
  }

  if (brokerId) dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "complete" });

  dispatch({
    type: "ADD_MESSAGE",
    message: newMsg("agent", responseText),
  });

  dispatch({ type: "SET_PROCESSING", value: false });
  dispatch({ type: "SET_ACTIVE_NODE", nodeId: null });
  await delay(2000);
  dispatch({ type: "RESET_NODE_STATUSES" });
}

// ── Simulation (no broker URL) ──────────────────────────────────────────────

const SIM_STEP_MS = 400;

export async function runSimulation(
  userMessage: string,
  graph: CanonicalGraph,
  dispatch: Dispatch<InvokeAction>
): Promise<void> {
  const brokerId = findBrokerNodeId(graph);
  const targetNodes = detectSimulatedTargetNodes(userMessage, graph);

  dispatch({ type: "SET_PROCESSING", value: true, step: "🐜 ANT sandbox mode: simulating (no broker URL)…" });
  dispatch({ type: "RESET_NODE_STATUSES" });

  await delay(SIM_STEP_MS * 0.6);

  dispatch({ type: "SET_CURRENT_STEP", step: "🐜 ANT is routing through the colony…" });
  if (brokerId) {
    dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: brokerId });
  }
  await delay(SIM_STEP_MS);

  dispatch({
    type: "SET_CURRENT_STEP",
    step: `🐜 ANT is simulating ${targetNodes.map((n) => n.label).join(", ")}…`,
  });
  await delay(SIM_STEP_MS * 0.5);

  const results: { name: string; text: string }[] = [];
  for (const n of targetNodes) {
    dispatch({ type: "SET_CURRENT_STEP", step: `🐜 ANT worker at ${n.label} is running…` });
    dispatch({ type: "SET_NODE_STATUS", nodeId: n.id, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: n.id });
    await delay(SIM_STEP_MS * 1.2);

    const text = getSimulatedResponse(n.label, userMessage);
    dispatch({ type: "SET_NODE_STATUS", nodeId: n.id, status: "complete" });
    results.push({ name: n.label, text });
    await delay(SIM_STEP_MS * 0.25);
  }

  dispatch({ type: "SET_CURRENT_STEP", step: "🐜 ANT is synthesizing crumbs into one answer…" });
  if (brokerId) {
    dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: brokerId });
  }
  await delay(SIM_STEP_MS * 0.8);
  if (brokerId) dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "complete" });

  dispatch({
    type: "ADD_MESSAGE",
    message: newMsg("agent", synthesize(results, userMessage)),
  });

  dispatch({ type: "SET_PROCESSING", value: false });
  dispatch({ type: "SET_ACTIVE_NODE", nodeId: null });
  await delay(2000);
  dispatch({ type: "RESET_NODE_STATUSES" });
}

/** Call real broker if a URL is provided, otherwise simulate. */
export async function handleSend(
  userMessage: string,
  brokerUrl: string,
  graph: CanonicalGraph,
  dispatch: Dispatch<InvokeAction>,
  auth: InvokeAuthConfig,
  a2aVersion = "0.3"
): Promise<void> {
  dispatch({ type: "ADD_MESSAGE", message: newMsg("user", userMessage) });

  if (brokerUrl.trim()) {
    return callRealBroker(userMessage, brokerUrl, graph, dispatch, auth, a2aVersion);
  }
  return runSimulation(userMessage, graph, dispatch);
}
