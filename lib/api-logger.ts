/**
 * API Request/Response Logger
 * 
 * Logs all API calls with full request/response details for debugging.
 * Can be disabled via ENABLE_API_LOGGING environment variable.
 * 
 * IMPORTANT: Never logs customer data - all sensitive fields are sanitized.
 * NOTE: access_token and refresh_token are logged (not redacted) for debugging/curl recreation.
 */

/**
 * Check if API logging is enabled
 * Set ENABLE_API_LOGGING=true to enable logging
 * If not set, logging is disabled by default (no logging)
 */
export function isLoggingEnabled(): boolean {
  const enabled = process.env.ENABLE_API_LOGGING;
  // Default to false (no logging) unless explicitly enabled
  if (enabled === undefined) {
    return false;
  }
  return enabled === "true" || enabled === "1";
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
      // Keep only the token type, mask the actual token
      const tokenType = typeof value === "string" && value.split(" ")[0];
      sanitized[key] = `${tokenType || "Bearer"} [REDACTED]`;
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
  
  const body = bodyToLog ? sanitizeBody(bodyToLog) : undefined;

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
  const sanitizedBody = body ? sanitizeBody(body) : undefined;

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
          body: response.body ? sanitizeBody(response.body) : undefined,
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
    
    // Clone response to read body without consuming it
    const clonedResponse = response.clone();
    
    // Read response body (but don't block on it)
    let responseBody: unknown;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      try {
        responseBody = await clonedResponse.json();
      } catch {
        // Failed to parse JSON, try text
        try {
          responseBody = await clonedResponse.text();
        } catch {
          responseBody = "[Unable to read response body]";
        }
      }
    } else {
      try {
        const text = await clonedResponse.text();
        responseBody = text.length > 1000 ? `[LARGE_TEXT:${text.length} chars]` : text;
      } catch {
        responseBody = "[Unable to read response body]";
      }
    }

    // Log response
    logApiResponse(
      url,
      method,
      response.status,
      response.statusText,
      response.headers,
      responseBody
    );

    // Return original response
    return response;
  } catch (error) {
    // Log error
    logApiError(url, method, error);
    throw error;
  }
}
