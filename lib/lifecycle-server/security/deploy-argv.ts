/**
 * Validate deploy options and append CLI flags. Ported from
 * electron/cli/deploy-argv.js. The client never supplies raw argv; every value
 * is re-validated here before it can reach the spawned process.
 */

import type { DeployOptions, DeployProperty, DeployTargetKind } from "../contracts";

const TARGET_KINDS = new Set<DeployTargetKind>(["shared", "private"]);

interface AssertTokenOptions {
  maxLen?: number;
  allowDots?: boolean;
}

/** Disallow control chars; keep gateway / property names safe for argv. */
function assertToken(value: unknown, label: string, options: AssertTokenOptions = {}): string {
  const { maxLen = 128, allowDots = false } = options;
  const s = String(value ?? "").trim();
  if (!s || s.length > maxLen || /[\x00-\x1f]/.test(s)) {
    throw new Error(`Invalid ${label}.`);
  }
  const pattern = allowDots ? /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/ : /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  if (!pattern.test(s)) {
    throw new Error(`Invalid ${label}.`);
  }
  return s;
}

function assertEnvironment(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || s.length > 128 || /[\x00-\x1f]/.test(s)) {
    throw new Error("A valid environment name is required.");
  }
  return s;
}

/**
 * Business group names are display names, so they may contain spaces and
 * punctuation that `assertToken` rejects. spawn runs with shell:false, so a
 * single argv element with spaces is inert.
 *
 * Required: without it the CLI resolves the environment (and therefore the
 * gateway list) in the token's default org instead of the selected business
 * group. The enqueue route always fills this in from the user's profile.
 */
function assertOrganization(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || s.length > 128 || /[\x00-\x1f]/.test(s)) {
    throw new Error("A valid organization (business group) name is required.");
  }
  return s;
}

function assertPropertyValue(name: string, value: unknown): string {
  const s = String(value ?? "");
  if (!s || s.length > 8192 || /[\x00-\x1f]/.test(s)) {
    throw new Error(`Invalid deploy property value for ${name}.`);
  }
  if (/\$ anypoint-cli|anypoint-cli-v4 agent-network|Using shared space|derived from gateway/i.test(s)) {
    throw new Error(`Deploy property ${name} looks corrupted — re-enter the value.`);
  }
  return s;
}

interface ValidatedDeploy {
  organization: string;
  environment: string;
  targetKind: DeployTargetKind;
  gateway?: string;
  targetSpace?: string;
  ingressGw?: string;
  egressGw?: string;
  properties: DeployProperty[];
}

export function validateDeployOptions(deploy: DeployOptions | undefined): ValidatedDeploy {
  if (!deploy || typeof deploy !== "object") {
    throw new Error("Deploy options are required.");
  }

  const environment = assertEnvironment(deploy.environment);
  const targetKind = deploy.targetKind;
  if (!TARGET_KINDS.has(targetKind)) {
    throw new Error("Deployment target must be shared or private.");
  }

  const out: ValidatedDeploy = {
    organization: assertOrganization(deploy.organization),
    environment,
    targetKind,
    properties: [],
  };

  switch (targetKind) {
    case "shared":
      out.gateway = assertToken(deploy.gateway, "gateway name", { allowDots: true });
      break;
    case "private":
      out.targetSpace = assertToken(deploy.targetSpace, "target space", { allowDots: true });
      out.ingressGw = assertToken(deploy.ingressGw, "ingress gateway", { allowDots: true });
      out.egressGw = assertToken(deploy.egressGw, "egress gateway", { allowDots: true });
      break;
    default: {
      const _exhaustive: never = targetKind;
      throw new Error(`Unhandled target kind: ${String(_exhaustive)}`);
    }
  }

  const properties = Array.isArray(deploy.properties) ? deploy.properties : [];
  const seen = new Set<string>();
  for (const entry of properties) {
    if (!entry || typeof entry !== "object") continue;
    const name = assertToken(entry.name, "property name", { allowDots: true, maxLen: 256 });
    if (seen.has(name)) continue;
    seen.add(name);
    const value = assertPropertyValue(name, entry.value);
    out.properties.push({ name, value });
  }

  return out;
}

/**
 * ANYPOINT_ORG / ANYPOINT_ENV env vars for every CLI step, not just `deploy`.
 * `build` and `publish` accept no --organization/--environment flags at all,
 * so without this they fall back to the CLI's own account-level defaults (root
 * org, "default environment") — which may not exist, and even when they do,
 * may not match the business group the user actually selected. Setting these
 * env vars seeds the same flags' defaults for every command uniformly.
 */
export function deployContextEnv(deploy: DeployOptions | undefined): Record<string, string> {
  if (!deploy) return {};
  return {
    ANYPOINT_ORG: assertOrganization(deploy.organization),
    ANYPOINT_ENV: assertEnvironment(deploy.environment),
  };
}

/** Append validated deploy flags to argv. */
export function appendDeployArgv(argv: string[], deploy: DeployOptions | undefined): void {
  const options = validateDeployOptions(deploy);
  argv.push("--organization", options.organization);
  argv.push("--environment", options.environment);

  switch (options.targetKind) {
    case "shared":
      argv.push("--gateway", options.gateway as string);
      break;
    case "private":
      argv.push("--target-space", options.targetSpace as string);
      argv.push("--ingress-gw", options.ingressGw as string);
      argv.push("--egress-gw", options.egressGw as string);
      break;
    default: {
      const _exhaustive: never = options.targetKind;
      throw new Error(`Unhandled target kind: ${String(_exhaustive)}`);
    }
  }

  for (const prop of options.properties) {
    argv.push("--property", `${prop.name}:${prop.value}`);
  }
}
