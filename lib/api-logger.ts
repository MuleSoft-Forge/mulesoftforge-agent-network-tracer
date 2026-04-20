/**
 * API Request/Response Logger
 *
 * Logs all API calls with full request/response details for debugging.
 * Set ENABLE_API_LOGGING=true locally to enable `debugLog` / `loggedFetch` output.
 *
 * On deployed Vercel builds (`VERCEL=1` and `NODE_ENV=production`), verbose logging
 * is always off so dashboard env mistakes cannot enable it. Local `vercel dev` is
 * unaffected (`NODE_ENV=development`).
 *
 * IMPORTANT: Never logs customer data - all sensitive fields are sanitized.
 * NOTE: access_token and refresh_token are logged (not redacted) for debugging/curl recreation.
 */

/** Deployed Vercel (serverless/edge) — not local `next dev` or typical `vercel dev`. */
function isVercelProductionBuild(): boolean {
  return process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
}

/**
 * Check if API logging is enabled.
 * Set ENABLE_API_LOGGING=true to enable logging (local / non-Vercel only).
 * If not set, logging is disabled by default.
 */
export function isLoggingEnabled(): boolean {
  if (isVercelProductionBuild()) {
    return false;
  }
  const enabled = process.env.ENABLE_API_LOGGING;
  if (enabled === undefined) {
    return false;
  }
  return enabled === "true" || enabled === "1";
}

/** Max length for full response body when DEBUG_FULL_RESPONSES is set (avoid huge logs). */
const FULL_RESPONSE_MAX_CHARS = 50000;

/**
 * When true, request/response bodies are logged in full (truncated to FULL_RESPONSE_MAX_CHARS)
 * instead of being sanitized. Use only for local/debug; never in production.
 * Set DEBUG_FULL_RESPONSES=true (or 1) to enable.
 */
export function isFullResponseLoggingEnabled(): boolean {
  if (isVercelProductionBuild()) {
    return false;
  }
  const v = process.env.DEBUG_FULL_RESPONSES;
  return v === "true" || v === "1";
}

/**
 * Local development only (client or server). Never logs in production builds (including Vercel).
 * Prefer this over raw `console.log` for noisy traces.
 */
export function devLog(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "development") return;
  console.log(...args);
}

/** Same as {@link devLog} for warnings. */
export function devWarn(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "development") return;
  console.warn(...args);
}

function truncateForLog(body: unknown): unknown {
  const str = typeof body === "string" ? body : JSON.stringify(body);
  if (str.length <= FULL_RESPONSE_MAX_CHARS) return body;
  return str.slice(0, FULL_RESPONSE_MAX_CHARS) + `\n...[TRUNCATED ${str.length - FULL_RESPONSE_MAX_CHARS} more chars]`;
}

/**
 * Debug logger that respects ENABLE_API_LOGGING feature flag
 * Use this for all internal debug logging (session management, auth flow, etc.)
 */
export function debugLog(...args: unknown[]): void {
  if (!isLoggingEnabled()) {
    return;
  }
  console.log(...args);
}

/**
 * Debug error logger that respects ENABLE_API_LOGGING feature flag
 * Use this for error logging that should only appear when logging is enabled
 */
export function debugError(...args: unknown[]): void {
  if (!isLoggingEnabled()) {
    return;
  }
  console.error(...args);
}

/**
 * Debug warn logger that respects ENABLE_API_LOGGING feature flag
 * Use this for warnings that should only appear when logging is enabled
 */
export function debugWarn(...args: unknown[]): void {
  if (!isLoggingEnabled()) {
    return;
  }
  console.warn(...args);
}

/**
 * Fields that contain customer data and should be sanitized
 * 
 * NOTE: access_token and refresh_token are NOT redacted - they're needed for debugging/curl recreation
 */
const SENSITIVE_FIELDS = [
  "authorization",
  "bearer",
  "client_secret",
  "password",
  "email",
  "username",
  "firstName",
  "lastName",
  "message",
  "userMessage",
  "content",
  "body",
  "text",
  "input",
  "output",
  "reasoning",
  "toolInput",
  "toolOutput",
  "a2aResponse",
  "llmFinalResponse",
  "llmReasoning",
] as const;

/**
 * Sanitize headers to remove sensitive data
 */
function sanitizeHeaders(headers: HeadersInit): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const headerObj = headers instanceof Headers 
    ? Object.fromEntries(headers.entries())
    : Array.isArray(headers)
    ? Object.fromEntries(headers)
    : headers;

  for (const [key, value] of Object.entries(headerObj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "authorization") {
      // Log full value for debugging/curl (do not redact)
      sanitized[key] = String(value);
    } else if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = String(value);
    }
  }

  return sanitized;
}

/**
 * Sanitize request/response body to remove customer data
 */
function sanitizeBody(body: unknown, depth = 0): unknown {
  // Prevent deep recursion
  if (depth > 10) {
    return "[MAX_DEPTH]";
  }

  if (body === null || body === undefined) {
    return body;
  }

  if (typeof body === "string") {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(body);
      return sanitizeBody(parsed, depth + 1);
    } catch {
      // Not JSON, check if it looks like sensitive data
      if (body.length > 1000) {
        return `[LARGE_STRING:${body.length} chars]`;
      }
      // Check for patterns that might indicate customer data
      if (
        SENSITIVE_FIELDS.some((field) =>
          body.toLowerCase().includes(field.toLowerCase())
        )
      ) {
        return "[REDACTED]";
      }
      return body;
    }
  }

  if (typeof body !== "object") {
    return body;
  }

  if (Array.isArray(body)) {
    return body.map((item) => sanitizeBody(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const lowerKey = key.toLowerCase();
    
    // Skip sensitive fields entirely
    if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field))) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    // Recursively sanitize nested objects
    if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeBody(value, depth + 1);
    } else if (typeof value === "string" && value.length > 1000) {
      sanitized[key] = `[LARGE_STRING:${value.length} chars]`;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Format headers for curl command
 */
function formatHeadersForCurl(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `-H "${key}: ${value}"`)
    .join(" \\\n  ");
}

/**
 * Format request body for curl command
 */
function formatBodyForCurl(body: unknown): string {
  if (body === null || body === undefined) {
    return "";
  }

  if (typeof body === "string") {
    // Try to parse and pretty-print JSON
    try {
      const parsed = JSON.parse(body);
      return `-d '${JSON.stringify(parsed, null, 2)}'`;
    } catch {
      // If it's URL-encoded form data, use -d (not --data-urlencode for simplicity)
      return `-d '${body}'`;
    }
  }

  // If it's an object (like from URLSearchParams), format as form data
  if (typeof body === "object" && !Array.isArray(body) && body !== null) {
    const entries = Object.entries(body);
    if (entries.length > 0) {
      // Check if it looks like form data (simple key-value pairs)
      const isFormData = entries.every(([_, v]) => typeof v === "string" || typeof v === "number");
      if (isFormData) {
        const formData = entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
        return `-d '${formData}'`;
      }
    }
  }

  return `-d '${JSON.stringify(body, null, 2)}'`;
}

/**
 * Log API request details
 */
export function logApiRequest(
  url: string,
  options: RequestInit = {}
): void {
  if (!isLoggingEnabled()) {
    return;
  }

  const method = options.method || "GET";
  const headers = sanitizeHeaders(options.headers || {});
  
  // Handle different body types
  let bodyToLog: unknown;
  if (options.body) {
    if (typeof options.body === "string") {
      bodyToLog = options.body;
    } else if (options.body instanceof URLSearchParams) {
      // Convert URLSearchParams to object for logging (but keep access_token/refresh_token visible)
      const params: Record<string, string> = {};
      for (const [key, value] of options.body.entries()) {
        params[key] = value;
      }
      bodyToLog = params;
    } else if (options.body instanceof FormData) {
      bodyToLog = "[FormData]";
    } else {
      bodyToLog = options.body;
    }
  }
  
  const body = bodyToLog
    ? (isFullResponseLoggingEnabled() ? truncateForLog(bodyToLog) : sanitizeBody(bodyToLog))
    : undefined;

  const logEntry = {
    type: "API_REQUEST",
    timestamp: new Date().toISOString(),
    method,
    url,
    headers,
    body,
    curl: `curl -X ${method} \\
  ${formatHeadersForCurl(headers)} \\
  ${body ? formatBodyForCurl(body) : ""} \\
  "${url}"`,
  };

  debugLog("[API_REQUEST]", JSON.stringify(logEntry, null, 2));
}

/**
 * Log API response details
 */
export function logApiResponse(
  url: string,
  method: string,
  status: number,
  statusText: string,
  headers: Headers,
  body?: unknown
): void {
  if (!isLoggingEnabled()) {
    return;
  }

  const sanitizedHeaders = sanitizeHeaders(headers);
  const sanitizedBody = body
    ? (isFullResponseLoggingEnabled() ? truncateForLog(body) : sanitizeBody(body))
    : undefined;

  const logEntry = {
    type: "API_RESPONSE",
    timestamp: new Date().toISOString(),
    method,
    url,
    status,
    statusText,
    headers: sanitizedHeaders,
    body: sanitizedBody,
  };

  debugLog("[API_RESPONSE]", JSON.stringify(logEntry, null, 2));
}

/**
 * Log API error details
 */
export function logApiError(
  url: string,
  method: string,
  error: Error | unknown,
  response?: { status: number; statusText: string; body?: unknown }
): void {
  if (!isLoggingEnabled()) {
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  const logEntry = {
    type: "API_ERROR",
    timestamp: new Date().toISOString(),
    method,
    url,
    error: errorMessage,
    stack: errorStack,
    response: response
      ? {
          status: response.status,
          statusText: response.statusText,
          body: response.body
            ? (isFullResponseLoggingEnabled() ? truncateForLog(response.body) : sanitizeBody(response.body))
            : undefined,
        }
      : undefined,
  };

  debugError("[API_ERROR]", JSON.stringify(logEntry, null, 2));
}

/**
 * Wrapper for fetch that automatically logs requests and responses
 */
export async function loggedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = options.method || "GET";
  
  // Log request
  logApiRequest(url, options);

  try {
    const response = await fetch(url, options);

    // Read the body exactly once as a buffer, then hand back a fresh Response
    // built from that buffer. This avoids `response.clone()` — which on
    // Node/undici can leave the original body in a "Body is unusable" state
    // after the clone is parsed (observed on some chunked/HTTP2 responses).
    let bodyBuffer: ArrayBuffer | null = null;
    try {
      bodyBuffer = await response.arrayBuffer();
    } catch {
      bodyBuffer = null;
    }

    let responseBody: unknown;
    const contentType = response.headers.get("content-type");
    if (bodyBuffer == null) {
      responseBody = "[Unable to read response body]";
    } else if (contentType?.includes("application/json")) {
      try {
        const text = new TextDecoder("utf-8").decode(bodyBuffer);
        responseBody = text.length === 0 ? "" : (JSON.parse(text) as unknown);
      } catch {
        try {
          responseBody = new TextDecoder("utf-8").decode(bodyBuffer);
        } catch {
          responseBody = "[Unable to read response body]";
        }
      }
    } else {
      try {
        const text = new TextDecoder("utf-8").decode(bodyBuffer);
        responseBody = text.length > 1000 ? `[LARGE_TEXT:${text.length} chars]` : text;
      } catch {
        responseBody = "[Unable to read response body]";
      }
    }

    logApiResponse(
      url,
      method,
      response.status,
      response.statusText,
      response.headers,
      responseBody
    );

    // Rebuild a Response so callers can still use `.json()` / `.text()`.
    // Strip `content-encoding` since the body has already been decompressed
    // by `arrayBuffer()` and we are handing raw bytes back.
    const rebuiltHeaders = new Headers(response.headers);
    rebuiltHeaders.delete("content-encoding");
    rebuiltHeaders.delete("content-length");
    return new Response(bodyBuffer, {
      status: response.status,
      statusText: response.statusText,
      headers: rebuiltHeaders,
    });
  } catch (error) {
    logApiError(url, method, error);
    throw error;
  }
}
