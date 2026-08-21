/**
 * API Request/Response Logger
 *
 * Logs all API calls with full request/response details for debugging.
 * Set ENABLE_API_LOGGING=true locally to enable `debugLog` / `loggedFetch` output.
 *
 * Logging is **development-only** (`NODE_ENV=development`). Production builds
 * (including Vercel production and preview) never emit logs, regardless of env vars.
 *
 * IMPORTANT: Never logs customer data - all sensitive fields are sanitized.
 * Tokens (Authorization bearer, access_token, refresh_token, client_secret) are
 * redacted by default. For local debugging / curl recreation, set
 * `DEBUG_INCLUDE_TOKENS=1` AND run with `NODE_ENV=development`. The opt-in is
 * deliberately narrow so production logs never include tokens.
 */

/** Local `next dev` / `vercel dev` only — never true on deployed production/preview. */
function isDevelopmentRuntime(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Check if API logging is enabled.
 * Set ENABLE_API_LOGGING=true to enable logging (local development only).
 * If not set, logging is disabled by default.
 */
export function isLoggingEnabled(): boolean {
  if (!isDevelopmentRuntime()) {
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
 * Bodies above this size are described rather than parsed, sanitized and
 * pretty-printed. Monitoring log-search returns multi-megabyte pages; walking
 * one of those object graphs, then `JSON.stringify(…, null, 2)`, then a
 * *synchronous* `console.log` to a pipe costs far more than the upstream
 * request it is describing and stalls the event loop while it runs.
 */
const LOG_BODY_MAX_BYTES = 256 * 1024;

/**
 * Strings longer than this are not speculatively parsed as embedded JSON. Log
 * `message` fields routinely carry large JSON-ish payloads, and attempting to
 * parse (then recursively sanitize) every one of them dominates logging cost.
 */
const EMBEDDED_JSON_MAX_CHARS = 4096;

/**
 * When true, request/response bodies are logged in full (truncated to FULL_RESPONSE_MAX_CHARS)
 * instead of being sanitized. Use only for local/debug; never in production.
 * Set DEBUG_FULL_RESPONSES=true (or 1) to enable.
 */
export function isFullResponseLoggingEnabled(): boolean {
  if (!isDevelopmentRuntime()) {
    return false;
  }
  const v = process.env.DEBUG_FULL_RESPONSES;
  return v === "true" || v === "1";
}

/**
 * When true, tokens (Authorization, access_token, refresh_token, client_secret)
 * are logged verbatim for curl/debug convenience. Requires BOTH
 * `DEBUG_INCLUDE_TOKENS=1` and `NODE_ENV=development` — so a stray env var in
 * a preview / staging / production deployment cannot leak tokens.
 */
export function isTokenLoggingEnabled(): boolean {
  if (!isDevelopmentRuntime()) return false;
  const v = process.env.DEBUG_INCLUDE_TOKENS;
  return v === "true" || v === "1";
}

/**
 * Log a bearer token for local curl/probe reproduction. The token is only
 * emitted when {@link isTokenLoggingEnabled} (DEBUG_INCLUDE_TOKENS=1 + dev);
 * with API logging on but token logging off, a hint is printed instead so the
 * operator knows how to reveal it. Never emits anything in production.
 */
export function debugToken(label: string, token: string | undefined | null): void {
  if (!isLoggingEnabled()) return;
  if (!token) {
    console.log(`${label} Bearer (none)`);
    return;
  }
  if (isTokenLoggingEnabled()) {
    console.log(`${label} Bearer ${token}`);
  } else {
    console.log(`${label} Bearer [REDACTED — set DEBUG_INCLUDE_TOKENS=1 (dev only) to reveal]`);
  }
}

/**
 * Local development only (client or server). Never logs in production builds (including Vercel).
 * Prefer this over raw `console.log` for noisy traces.
 */
export function devLog(...args: unknown[]): void {
  if (!isDevelopmentRuntime()) return;
  console.log(...args);
}

/** Same as {@link devLog} for warnings. */
export function devWarn(...args: unknown[]): void {
  if (!isDevelopmentRuntime()) return;
  console.warn(...args);
}

function truncateForLog(body: unknown): unknown {
  const str = typeof body === "string" ? body : JSON.stringify(body);
  if (str.length <= FULL_RESPONSE_MAX_CHARS) return body;
  return str.slice(0, FULL_RESPONSE_MAX_CHARS) + `\n...[TRUNCATED ${str.length - FULL_RESPONSE_MAX_CHARS} more chars]`;
}

/**
 * Canonical pipeline for logging a body: always sanitize (token + PII
 * redaction), then — if DEBUG_FULL_RESPONSES is off — truncate any outer
 * value that got too big. Callers should use this instead of combining
 * `truncateForLog` and `sanitizeBody` ad-hoc; the previous ad-hoc form
 * skipped redaction when DEBUG_FULL_RESPONSES was set.
 */
function prepareBodyForLog(body: unknown): unknown {
  const fullLogging = isFullResponseLoggingEnabled();
  const sanitized = sanitizeBody(body, 0, { preserveLargeStrings: fullLogging });
  return fullLogging ? truncateForLog(sanitized) : sanitized;
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
 * Body field names whose *contents* are customer data. Matched via
 * `lowerKey.includes(field)` so e.g. `userMessage` matches `message`. These
 * are only applied to request/response bodies, not headers — a header named
 * `content-type` would otherwise get wrongly redacted by "content".
 */
const SENSITIVE_BODY_FIELDS = [
  "password",
  "email",
  "username",
  "firstname",
  "lastname",
  "message",
  "usermessage",
  "content",
  "body",
  "text",
  "input",
  "output",
  "reasoning",
  "toolinput",
  "tooloutput",
  "a2aresponse",
  "llmfinalresponse",
  "llmreasoning",
] as const;

/**
 * Exact header names to redact. Exact match avoids false positives like
 * `content-type` / `content-encoding` being caught by a substring match.
 */
const SENSITIVE_HEADERS = new Set<string>([
  "cookie",
  "set-cookie",
  "x-api-key",
]);

/**
 * Token field names (request bodies, response bodies, and Authorization-style
 * headers). Tokens are redacted by default; `DEBUG_INCLUDE_TOKENS=1` in dev
 * reverses this for local curl reproduction.
 */
const TOKEN_FIELDS = [
  "authorization",
  "bearer",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
] as const;

/**
 * Sanitize headers. Token-style headers (Authorization, client_secret, etc.)
 * are redacted unless token logging is explicitly enabled; an explicit small
 * set of other headers (Cookie, X-Api-Key) is always redacted. Everything
 * else — including `Content-Type`, `Content-Encoding`, CSP headers — is kept
 * verbatim because those are not secrets and are useful for debugging.
 */
function sanitizeHeaders(headers: HeadersInit): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const headerObj = headers instanceof Headers
    ? Object.fromEntries(headers.entries())
    : Array.isArray(headers)
    ? Object.fromEntries(headers)
    : headers;

  const tokensAllowed = isTokenLoggingEnabled();
  for (const [key, value] of Object.entries(headerObj)) {
    const lowerKey = key.toLowerCase();
    if (TOKEN_FIELDS.some((field) => lowerKey.includes(field))) {
      sanitized[key] = tokensAllowed ? String(value) : "[REDACTED]";
    } else if (SENSITIVE_HEADERS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = String(value);
    }
  }

  return sanitized;
}

/**
 * Sanitize request/response body. Token fields are redacted unless token
 * logging is explicitly enabled; customer-data fields are always redacted.
 *
 * When `options.preserveLargeStrings` is true (DEBUG_FULL_RESPONSES), long
 * string values are kept intact — but redaction still runs. This split
 * matters: without it, enabling DEBUG_FULL_RESPONSES also silently disabled
 * token/PII redaction, which is a production-hazard-level bug.
 */
function sanitizeBody(
  body: unknown,
  depth = 0,
  options: { preserveLargeStrings?: boolean } = {}
): unknown {
  if (depth > 10) return "[MAX_DEPTH]";
  if (body === null || body === undefined) return body;

  if (typeof body === "string") {
    if (body.length <= EMBEDDED_JSON_MAX_CHARS) {
      try {
        const parsed = JSON.parse(body);
        return sanitizeBody(parsed, depth + 1, options);
      } catch {
        /* not embedded JSON — fall through to the plain-string handling */
      }
    }
    if (!options.preserveLargeStrings && body.length > 1000) {
      return `[LARGE_STRING:${body.length} chars]`;
    }
    if (SENSITIVE_BODY_FIELDS.some((field) => body.toLowerCase().includes(field))) {
      return "[REDACTED]";
    }
    return body;
  }

  if (typeof body !== "object") return body;

  if (Array.isArray(body)) {
    return body.map((item) => sanitizeBody(item, depth + 1, options));
  }

  const sanitized: Record<string, unknown> = {};
  const tokensAllowed = isTokenLoggingEnabled();
  for (const [key, value] of Object.entries(body)) {
    const lowerKey = key.toLowerCase();

    if (TOKEN_FIELDS.some((field) => lowerKey.includes(field))) {
      sanitized[key] = tokensAllowed ? value : "[REDACTED]";
      continue;
    }

    if (SENSITIVE_BODY_FIELDS.some((field) => lowerKey.includes(field))) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeBody(value, depth + 1, options);
    } else if (
      !options.preserveLargeStrings &&
      typeof value === "string" &&
      value.length > 1000
    ) {
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
    ? (prepareBodyForLog(bodyToLog))
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
  const sanitizedBody = body ? prepareBodyForLog(body) : undefined;

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
          body: response.body ? prepareBodyForLog(response.body) : undefined,
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

  // Hot path: logging disabled → skip the buffer+rebuild round-trip entirely.
  // Response buffering is expensive (whole body into RAM; Exchange zip downloads
  // and monitoring search results can be megabytes) and is only useful when
  // we're going to log the response body.
  if (!isLoggingEnabled()) {
    return fetch(url, options);
  }

  // Log request
  logApiRequest(url, options);

  try {
    const response = await fetch(url, options);

    // When the server tells us up front that the body is large, skip buffering
    // it entirely and stream it straight through — a multi-megabyte copy plus a
    // rebuilt Response is pure overhead when we are not going to log the body.
    const declaredLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > LOG_BODY_MAX_BYTES) {
      logApiResponse(
        url,
        method,
        response.status,
        response.statusText,
        response.headers,
        `[BODY_NOT_BUFFERED:${declaredLength} bytes, type=${response.headers.get("content-type") ?? "unknown"}]`
      );
      return response;
    }

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
    } else if (bodyBuffer.byteLength > LOG_BODY_MAX_BYTES) {
      responseBody = `[BODY_TOO_LARGE_TO_LOG:${bodyBuffer.byteLength} bytes, type=${contentType ?? "unknown"}]`;
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
