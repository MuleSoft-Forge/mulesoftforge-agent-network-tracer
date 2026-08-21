/**
 * Secret redaction for anything derived from the CLI or job payload before it is
 * logged, persisted, or streamed to a client. Extends the desktop redaction in
 * lib/desktop/cli-output-parser.ts with runtime-secret patterns.
 */

const ANSI_RE = /\x1b\[[0-9;]*m/g;

// `--property fooSecret:VALUE` style flags carrying secrets.
const SECRET_PROPERTY_RE = /(--property\s+\S*(?:apiKey|secret|password|token)\S*:)\S+/gi;

// Common credential flags: --client_secret VALUE / --client-secret=VALUE etc.
const SECRET_FLAG_RE =
  /(--?(?:client[_-]?secret|client[_-]?id|password|token|access[_-]?token|refresh[_-]?token)[=\s]+)("?)[^\s"]+\2/gi;

// Bearer tokens in headers or logs.
const BEARER_RE = /(bearer\s+)[A-Za-z0-9._\-]+/gi;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Redact secrets from arbitrary text. Applied to every CLI chunk and to any
 * value that might reach logs/clients.
 */
export function redactSecrets(text: string): string {
  return stripAnsi(text)
    .replace(SECRET_PROPERTY_RE, "$1••••••")
    .replace(SECRET_FLAG_RE, "$1••••••")
    .replace(BEARER_RE, "$1••••••");
}

/**
 * Redact known literal secret values (e.g. the resolved client secret for a
 * job) wherever they appear. Values shorter than 6 chars are ignored to avoid
 * mangling ordinary output.
 */
export function redactValues(text: string, values: Iterable<string>): string {
  let out = text;
  for (const value of values) {
    const v = (value ?? "").trim();
    if (v.length < 6) continue;
    out = out.split(v).join("••••••");
  }
  return out;
}
