/** Deployment target kind — maps to CLI gateway / target-space flags. */
export type DeployTargetKind = "shared" | "private";

/** One deploy-time property passed to the CLI as `--property name:value`. */
export interface DeployProperty {
  name: string;
  value: string;
}

/**
 * Options required by `agent-network project deploy`.
 * Validated by lifecycle command runners before argv is built.
 */
export interface DeployOptions {
  /**
   * Business group id taken from the session's UI context. The server turns it
   * into the org *name* the CLI's `--organization` flag needs, so this is never
   * typed by the user. Environment and gateway names only resolve inside it.
   */
  organizationId?: string;
  /** Anypoint environment name (e.g. PRD, Sandbox). */
  environment: string;
  targetKind: DeployTargetKind;
  /** Shared space: single gateway for ingress and egress. */
  gateway?: string;
  /** Private space only (--target-space). Shared space is derived from --gateway by the CLI. */
  targetSpace?: string;
  ingressGw?: string;
  egressGw?: string;
  properties: DeployProperty[];
}

/** Variable row parsed from exchange.json metadata.variables. */
export interface ProjectDeployVariable {
  /** Dot path, e.g. openaiLlm.baseUrl */
  key: string;
  description?: string;
  default: string;
  secret: boolean;
}

export interface ProjectDeployMeta {
  projectName?: string;
  variables: ProjectDeployVariable[];
}

export const DEFAULT_SHARED_GATEWAY = "agent-network-shared-gw";
export const DEFAULT_PRIVATE_SPACE = "myPrivateSpace";
export const DEFAULT_INGRESS_GW = "agent-network-ingress-gw";
export const DEFAULT_EGRESS_GW = "agent-network-egress-gw";

export function defaultDeployOptions(): DeployOptions {
  return {
    organizationId: "",
    environment: "",
    targetKind: "shared",
    gateway: "",
    targetSpace: "",
    ingressGw: "",
    egressGw: "",
    properties: [],
  };
}

/** Build initial property values from exchange.json defaults. */
export function propertiesFromVariables(variables: ProjectDeployVariable[]): DeployProperty[] {
  return variables.map((v) => ({
    name: v.key,
    value: v.default ?? "",
  }));
}

export function getPropertyValue(properties: DeployProperty[], name: string): string {
  return properties.find((p) => p.name === name)?.value ?? "";
}

export function setPropertyValue(
  properties: DeployProperty[],
  name: string,
  value: string
): DeployProperty[] {
  const idx = properties.findIndex((p) => p.name === name);
  if (idx === -1) return [...properties, { name, value }];
  const next = [...properties];
  next[idx] = { name, value };
  return next;
}

/** Secrets without a value must be supplied before deploy. */
export function missingRequiredSecrets(
  variables: ProjectDeployVariable[],
  properties: DeployProperty[]
): ProjectDeployVariable[] {
  return variables.filter((v) => {
    if (!v.secret) return false;
    const value = getPropertyValue(properties, v.key).trim();
    const defaultValue = (v.default ?? "").trim();
    return !value && !defaultValue;
  });
}

/**
 * Publish chains a build, and build resolves API instances against the
 * selected environment — so publish needs organization + environment even
 * though it has no gateway/space/secrets of its own to configure.
 */
export function publishOptionsReady(
  options: DeployOptions
): { ok: true } | { ok: false; reason: string } {
  if (!(options.organizationId ?? "").trim()) {
    return { ok: false, reason: "Select a business group in the left menu." };
  }
  if (!options.environment.trim()) {
    return { ok: false, reason: "Select an environment in the left menu." };
  }
  return { ok: true };
}

export function deployOptionsReady(
  options: DeployOptions,
  variables: ProjectDeployVariable[]
): { ok: true } | { ok: false; reason: string } {
  if (!(options.organizationId ?? "").trim()) {
    return { ok: false, reason: "Select a business group in the left menu." };
  }
  if (!options.environment.trim()) {
    return { ok: false, reason: "Select an environment in the left menu." };
  }
  if (options.targetKind === "shared") {
    if (!(options.gateway ?? "").trim()) {
      return { ok: false, reason: "Select a gateway for shared space deployment." };
    }
  } else {
    if (!(options.targetSpace ?? "").trim()) {
      return { ok: false, reason: "Select a private space for deployment." };
    }
    if (!(options.ingressGw ?? "").trim() || !(options.egressGw ?? "").trim()) {
      return { ok: false, reason: "Select ingress and egress gateways." };
    }
  }
  const missing = missingRequiredSecrets(variables, options.properties);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Provide values for: ${missing.map((v) => v.key).join(", ")}`,
    };
  }
  return { ok: true };
}
