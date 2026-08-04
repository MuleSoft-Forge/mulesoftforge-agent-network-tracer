/**
 * Minimal OpenAI-compatible SSE parser.
 *
 * The Flex Gateway LLM Proxy proxies provider SSE streams verbatim for
 * `/chat/completions?stream=true` and `/responses?stream=true`. Each event is
 * a line block separated by a blank line; event data starts with `data: `.
 * A terminating `data: [DONE]` line is emitted by OpenAI-format streams.
 */

export interface SseEvent {
  /** Raw data payload (JSON string for OpenAI, SSE framing stripped). */
  data: string;
  /** Optional named event (e.g. "message", "delta"). */
  event?: string;
}

/**
 * Consume a browser ReadableStream of SSE bytes and yield parsed events.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const remaining = buffer.trim();
        if (remaining.length > 0) {
          const evt = parseEventBlock(remaining);
          if (evt) yield evt;
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      // Split on blank lines (event boundary: \n\n or \r\n\r\n).
      let boundary = findBoundary(buffer);
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + boundaryLengthAt(buffer, boundary));
        const evt = parseEventBlock(block);
        if (evt) yield evt;
        boundary = findBoundary(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function findBoundary(s: string): number {
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function boundaryLengthAt(s: string, index: number): number {
  return s.startsWith("\r\n\r\n", index) ? 4 : 2;
}

function parseEventBlock(block: string): SseEvent | null {
  const lines = block.split(/\r?\n/);
  let data = "";
  let event: string | undefined;
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      data += (data.length > 0 ? "\n" : "") + line.slice(5).trimStart();
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
  }
  if (data.length === 0) return null;
  return { data, event };
}

/**
 * Extract the text delta from an OpenAI Chat Completions streaming chunk.
 * Returns empty string when the chunk has no textual delta.
 */
export function extractChatCompletionDelta(eventJson: unknown): string {
  if (!eventJson || typeof eventJson !== "object") return "";
  const obj = eventJson as { choices?: Array<{ delta?: { content?: unknown } }> };
  const content = obj.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

/**
 * Extract the text delta from a Responses API streaming chunk.
 * Responses streams use `response.output_text.delta` events containing `{ delta: "..." }`.
 */
export function extractResponsesDelta(eventJson: unknown): string {
  if (!eventJson || typeof eventJson !== "object") return "";
  const obj = eventJson as { delta?: unknown; type?: unknown };
  if (typeof obj.delta === "string") return obj.delta;
  return "";
}
