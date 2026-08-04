// Validate deploy options and append CLI flags. Runs in the Electron main process
// only — the renderer never supplies raw argv.

const TARGET_KINDS = new Set(["shared", "private"]);

/** Disallow control chars; keep gateway / property names safe for argv. */
function assertToken(value, label, { maxLen = 128, allowDots = false } = {}) {
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

function assertEnvironment(value) {
  const s = String(value ?? "").trim();
  if (!s || s.length > 128 || /[\x00-\x1f]/.test(s)) {
    throw new Error("A valid environment name is required.");
  }
  return s;
}

function assertPropertyValue(name, value) {
  const s = String(value ?? "");
  if (!s || s.length > 8192 || /[\x00-\x1f]/.test(s)) {
    throw new Error(`Invalid deploy property value for ${name}.`);
  }
  if (
    /\$ anypoint-cli|anypoint-cli-v4 agent-network|Using shared space|derived from gateway/i.test(
      s
    )
  ) {
    throw new Error(`Deploy property ${name} looks corrupted — re-enter the value.`);
  }
  return s;
}

/**
 * @param {unknown} deploy
 * @returns {{ environment: string, targetKind: 'shared'|'private', gateway?: string, targetSpace?: string, ingressGw?: string, egressGw?: string, properties: Array<{name:string,value:string}> }}
 */
function validateDeployOptions(deploy) {
  if (!deploy || typeof deploy !== "object") {
    throw new Error("Deploy options are required.");
  }

  const environment = assertEnvironment(deploy.environment);
  const targetKind = deploy.targetKind;
  if (!TARGET_KINDS.has(targetKind)) {
    throw new Error("Deployment target must be shared or private.");
  }

  /** @type {{ environment: string, targetKind: 'shared'|'private', gateway?: string, targetSpace?: string, ingressGw?: string, egressGw?: string, properties: Array<{name:string,value:string}> }} */
  const out = { environment, targetKind, properties: [] };

  if (targetKind === "shared") {
    out.gateway = assertToken(deploy.gateway, "gateway name", { allowDots: true });
  } else {
    out.targetSpace = assertToken(deploy.targetSpace, "target space", { allowDots: true });
    out.ingressGw = assertToken(deploy.ingressGw, "ingress gateway", { allowDots: true });
    out.egressGw = assertToken(deploy.egressGw, "egress gateway", { allowDots: true });
  }

  const properties = Array.isArray(deploy.properties) ? deploy.properties : [];
  const seen = new Set();
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
 * @param {string[]} argv
 * @param {unknown} deploy
 */
function appendDeployArgv(argv, deploy) {
  const options = validateDeployOptions(deploy);
  argv.push("--environment", options.environment);

  if (options.targetKind === "shared") {
    // Single-gateway mode: CLI derives --target-space from the gateway (same as ACB).
    argv.push("--gateway", options.gateway);
  } else {
    argv.push("--target-space", options.targetSpace);
    argv.push("--ingress-gw", options.ingressGw);
    argv.push("--egress-gw", options.egressGw);
  }

  for (const prop of options.properties) {
    argv.push("--property", `${prop.name}:${prop.value}`);
  }
}

module.exports = { validateDeployOptions, appendDeployArgv };
