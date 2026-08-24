import type { AgentCard } from "./types";

/** Normalize Exchange / card version strings to an A2A-Version header value. */
export function normalizeA2AVersion(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (lower === "v1" || lower === "a2a_v1" || lower.startsWith("1.")) return "1.0";
  if (lower.startsWith("0.3")) return "0.3";
  return value;
}

export function inferA2AVersionFromCardClassifier(
  classifier: string | null | undefined
): string | null {
  if (!classifier) return null;
  const lower = classifier.toLowerCase();
  if (lower.includes("a2a-v1") || lower.includes("a2a-v2")) return "1.0";
  if (lower === "a2a-card" || lower === "agent-card") return "0.3";
  return null;
}

export function inferA2AVersionFromCard(card: AgentCard | null | undefined): string {
  if (!card) return "0.3";

  const direct = normalizeA2AVersion(card.protocolVersion);
  if (direct) return direct;

  for (const iface of card.supportedInterfaces ?? []) {
    const fromInterface = normalizeA2AVersion(iface.protocolVersion);
    if (fromInterface) return fromInterface;
  }

  return "0.3";
}

export function jsonRpcSendMethod(a2aVersion: string): string {
  const normalized = normalizeA2AVersion(a2aVersion);
  return normalized?.startsWith("1.") ? "SendMessage" : "message/send";
}

export function isA2AVersion1(a2aVersion: string): boolean {
  return normalizeA2AVersion(a2aVersion)?.startsWith("1.") ?? false;
}

export interface BrokerSendMessageRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: { message: Record<string, unknown> };
}

/** Build a version-correct JSON-RPC body for broker message/send. */
export function buildBrokerSendMessageRequest(
  a2aVersion: string,
  messageText: string,
  contextId?: string | null,
  id: string = crypto.randomUUID()
): BrokerSendMessageRequest {
  const messageId = crypto.randomUUID();
  const contextIdField = contextId ? { contextId } : {};
  if (isA2AVersion1(a2aVersion)) {
    return {
      jsonrpc: "2.0",
      id,
      method: "SendMessage",
      params: {
        message: {
          role: "ROLE_USER",
          parts: [{ text: messageText }],
          messageId,
          ...contextIdField,
        },
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    method: "message/send",
    params: {
      message: {
        role: "user",
        kind: "message",
        parts: [{ kind: "text", text: messageText }],
        messageId,
        ...contextIdField,
      },
    },
  };
}

/** Pull the conversation contextId back out of a message/send (or SendMessage v1) response, so the next turn can carry it forward. */
export function extractContextIdFromA2AResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const result = (data as Record<string, unknown>).result as Record<string, unknown> | undefined;
  if (!result || typeof result !== "object") return null;

  if (typeof result.contextId === "string" && result.contextId) return result.contextId;

  const task = result.task as Record<string, unknown> | undefined;
  if (task && typeof task.contextId === "string" && task.contextId) return task.contextId;

  const message = result.message as Record<string, unknown> | undefined;
  if (message && typeof message.contextId === "string" && message.contextId) return message.contextId;

  const status = result.status as Record<string, unknown> | undefined;
  const statusMessage = status?.message as Record<string, unknown> | undefined;
  if (statusMessage && typeof statusMessage.contextId === "string" && statusMessage.contextId) {
    return statusMessage.contextId;
  }

  return null;
}

/** v0.3 agents assume 0.3 when the header is omitted; v1.0+ requires A2A-Version. */
export function a2aVersionRequestHeaders(a2aVersion: string): Record<string, string> {
  const normalized = normalizeA2AVersion(a2aVersion);
  if (!normalized || normalized === "0.3") return {};
  return { "A2A-Version": normalized };
}

export function extractJsonRpcErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  const error = obj.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

export function extractProtocolVersionFromCardPayload(card: unknown): string | null {
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const record = card as Record<string, unknown>;
  const direct = normalizeA2AVersion(
    typeof record.protocolVersion === "string" ? record.protocolVersion : null
  );
  if (direct) return direct;

  const interfaces = record.supportedInterfaces;
  if (!Array.isArray(interfaces)) return null;
  for (const iface of interfaces) {
    if (!iface || typeof iface !== "object" || Array.isArray(iface)) continue;
    const fromInterface = normalizeA2AVersion(
      typeof (iface as Record<string, unknown>).protocolVersion === "string"
        ? ((iface as Record<string, unknown>).protocolVersion as string)
        : null
    );
    if (fromInterface) return fromInterface;
  }
  return null;
}
