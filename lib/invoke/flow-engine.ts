import type { Dispatch } from "react";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import type { InvokeAction, InvokeMessage } from "./types";
import { findBrokerNodeId } from "./graph-builder";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function newMsg(
  role: InvokeMessage["role"],
  content: string,
  attribution?: InvokeMessage["attribution"]
): InvokeMessage {
  return { id: crypto.randomUUID(), role, content, attribution, timestamp: new Date() };
}

// ── A2A response extraction ───────────────────────────────────────────────────

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

function extractTextFromA2AResponse(data: unknown): string {
  if (typeof data === "string" && data.trim()) return data;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const result = obj.result as Record<string, unknown> | undefined;
    if (result) {
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
    }
    for (const key of ["response", "answer", "output", "text", "content", "reply", "message"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
    return `Broker returned an unrecognised format. Raw: ${JSON.stringify(data).slice(0, 300)}`;
  }
  return String(data);
}

// ── Skill/node matching ───────────────────────────────────────────────────────

function detectTargetNodeIds(
  text: string,
  graph: CanonicalGraph,
  preferredNodeId?: string
): string[] {
  const subNodes = graph.nodes.filter((n) => n.type === "AGENT" || n.type === "MCP");
  if (preferredNodeId) {
    const preferred = subNodes.find((n) => n.id === preferredNodeId);
    if (preferred) return [preferred.id];
  }
  const lower = text.toLowerCase();
  const hits = subNodes.filter((n) => {
    const words = n.label.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => lower.includes(w));
  });
  return hits.length > 0
    ? hits.map((n) => n.id)
    : subNodes.slice(0, Math.min(2, subNodes.length)).map((n) => n.id);
}

// ── Simulation responses ──────────────────────────────────────────────────────

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
  if (results.length === 1) return `Based on the ${results[0].name}:\n\n${results[0].text}`;
  const parts = results.map((r) => `**${r.name}**\n${r.text}`).join("\n\n");
  return `Data from ${results.length} agents for "${query.slice(0, 60)}${query.length > 60 ? "…" : ""}":\n\n${parts}\n\nAll systems nominal.`;
}

// ── Real broker call (via same-origin server proxy) ──────────────────────────

export async function callRealBroker(
  userMessage: string,
  brokerUrl: string,
  graph: CanonicalGraph,
  preferredNodeId: string | undefined,
  dispatch: Dispatch<InvokeAction>
): Promise<void> {
  const brokerId = findBrokerNodeId(graph);
  const targetNodeIds = detectTargetNodeIds(userMessage, graph, preferredNodeId);
  const targetNodes = graph.nodes.filter((n) => targetNodeIds.includes(n.id));

  dispatch({ type: "SET_PROCESSING", value: true, step: "Sending query…" });
  dispatch({ type: "RESET_NODE_STATUSES" });

  if (brokerId) {
    dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: brokerId });
  }

  let responseText = "";
  let callError = "";

  try {
    const res = await fetch("/api/invoke/broker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brokerUrl,
        message: userMessage,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(
        (errBody as Record<string, unknown>).error as string ?? `HTTP ${res.status}`
      );
    }
    const data = await res.json();
    responseText = extractTextFromA2AResponse(data);
  } catch (err) {
    callError = err instanceof Error ? err.message : "Unknown error";
  }

  if (callError) {
    if (brokerId) dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "error" });
    dispatch({
      type: "ADD_MESSAGE",
      message: newMsg("error", `Broker call failed: ${callError}`),
    });
    dispatch({ type: "SET_PROCESSING", value: false });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: null });
    await delay(2000);
    dispatch({ type: "RESET_NODE_STATUSES" });
    return;
  }

  if (brokerId) dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "complete" });

  for (const n of targetNodes) {
    dispatch({ type: "SET_CURRENT_STEP", step: `${n.label} handling…` });
    dispatch({ type: "SET_NODE_STATUS", nodeId: n.id, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: n.id });
    await delay(400);
    dispatch({ type: "SET_NODE_STATUS", nodeId: n.id, status: "complete" });
    await delay(150);
  }

  dispatch({ type: "SET_CURRENT_STEP", step: "Synthesising…" });
  if (brokerId) {
    dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: brokerId });
  }
  await delay(300);
  if (brokerId) dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "complete" });

  dispatch({
    type: "ADD_MESSAGE",
    message: newMsg(
      "agent",
      responseText,
      targetNodes.map((n) => ({ name: n.label, nodeType: n.type }))
    ),
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
  preferredNodeId: string | undefined,
  dispatch: Dispatch<InvokeAction>
): Promise<void> {
  const brokerId = findBrokerNodeId(graph);
  const targetNodeIds = detectTargetNodeIds(userMessage, graph, preferredNodeId);
  const targetNodes = graph.nodes.filter((n) => targetNodeIds.includes(n.id));

  dispatch({ type: "SET_PROCESSING", value: true, step: "Sending query…" });
  dispatch({ type: "RESET_NODE_STATUSES" });

  await delay(SIM_STEP_MS * 0.6);

  dispatch({ type: "SET_CURRENT_STEP", step: "Broker routing…" });
  if (brokerId) {
    dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: brokerId });
  }
  await delay(SIM_STEP_MS);

  dispatch({ type: "SET_CURRENT_STEP", step: `Routing to ${targetNodes.map((n) => n.label).join(", ")}…` });
  await delay(SIM_STEP_MS * 0.5);

  const results: { name: string; text: string }[] = [];
  for (const n of targetNodes) {
    dispatch({ type: "SET_CURRENT_STEP", step: `${n.label} running…` });
    dispatch({ type: "SET_NODE_STATUS", nodeId: n.id, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: n.id });
    await delay(SIM_STEP_MS * 1.2);

    const text = getSimulatedResponse(n.label, userMessage);
    dispatch({ type: "SET_NODE_STATUS", nodeId: n.id, status: "complete" });
    results.push({ name: n.label, text });
    await delay(SIM_STEP_MS * 0.25);
  }

  dispatch({ type: "SET_CURRENT_STEP", step: "Synthesising…" });
  if (brokerId) {
    dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "active" });
    dispatch({ type: "SET_ACTIVE_NODE", nodeId: brokerId });
  }
  await delay(SIM_STEP_MS * 0.8);
  if (brokerId) dispatch({ type: "SET_NODE_STATUS", nodeId: brokerId, status: "complete" });

  const finalResponse = synthesize(results, userMessage);
  dispatch({
    type: "ADD_MESSAGE",
    message: newMsg(
      "agent",
      finalResponse,
      targetNodes.map((n) => ({ name: n.label, nodeType: n.type }))
    ),
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
  preferredNodeId: string | undefined,
  dispatch: Dispatch<InvokeAction>
): Promise<void> {
  dispatch({ type: "ADD_MESSAGE", message: newMsg("user", userMessage) });

  if (brokerUrl.trim()) {
    return callRealBroker(userMessage, brokerUrl, graph, preferredNodeId, dispatch);
  }
  return runSimulation(userMessage, graph, preferredNodeId, dispatch);
}
