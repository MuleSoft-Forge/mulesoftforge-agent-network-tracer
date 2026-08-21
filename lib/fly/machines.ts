/**
 * Minimal Fly.io Machines API client, scoped to what the Ops page needs:
 * see every machine in the app and start/stop/restart one.
 *
 * Configuration comes from the environment. `FLY_APP_NAME` is injected by Fly
 * into every machine, so only the token has to be provisioned by hand:
 *
 *   fly secrets set FLY_API_TOKEN="$(fly tokens create deploy -x 8760h)"
 *
 * When the token is absent the client reports "not configured" rather than
 * throwing, so the rest of the diagnostics still render locally.
 */

import "server-only";

const FLY_API_BASE = "https://api.machines.dev/v1";
const REQUEST_TIMEOUT_MS = 10_000;

export interface FlyConfig {
  appName: string;
  token: string;
}

export interface FlyMachineCheck {
  name?: string;
  status?: string;
  output?: string;
  updated_at?: string;
}

export interface FlyMachineService {
  internal_port?: number;
  protocol?: string;
  autostop?: boolean | string;
  autostart?: boolean;
  min_machines_running?: number;
}

export interface FlyMachine {
  id: string;
  name?: string;
  state?: string;
  region?: string;
  private_ip?: string;
  created_at?: string;
  updated_at?: string;
  image_ref?: {
    registry?: string;
    repository?: string;
    tag?: string;
    digest?: string;
    labels?: Record<string, string> | null;
  };
  config?: {
    metadata?: Record<string, string>;
    guest?: { cpu_kind?: string; cpus?: number; memory_mb?: number };
    services?: FlyMachineService[];
    restart?: { policy?: string };
  };
  checks?: FlyMachineCheck[];
}

export interface FlyApp {
  name?: string;
  status?: string;
  organization?: { slug?: string; name?: string };
}

export type FlyMachineAction = "start" | "stop" | "restart";

/** Thrown for transport failures and non-2xx Fly responses alike. */
export class FlyApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "FlyApiError";
  }
}

function trimmed(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function readFlyConfig(): FlyConfig | null {
  const token = trimmed("FLY_API_TOKEN");
  const appName = trimmed("FLY_APP_NAME");
  if (!token || !appName) return null;
  return { token, appName };
}

/**
 * What this process knows about itself. Present on Fly, empty locally — which
 * is exactly the signal the Ops page uses to say "you're not on Fly right now".
 */
export interface FlySelfInfo {
  appName: string | null;
  machineId: string | null;
  region: string | null;
  imageRef: string | null;
  processGroup: string | null;
}

export function readFlySelfInfo(): FlySelfInfo {
  return {
    appName: trimmed("FLY_APP_NAME") ?? null,
    machineId: trimmed("FLY_MACHINE_ID") ?? null,
    region: trimmed("FLY_REGION") ?? null,
    imageRef: trimmed("FLY_IMAGE_REF") ?? null,
    processGroup: trimmed("FLY_PROCESS_GROUP") ?? null,
  };
}

async function flyRequest<T>(
  config: FlyConfig,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${FLY_API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FlyApiError(`Could not reach the Fly Machines API: ${message}`, null);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.slice(0, 400).trim();
    throw new FlyApiError(
      `Fly API ${response.status} on ${path}${detail ? ` — ${detail}` : ""}`,
      response.status
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listMachines(config: FlyConfig): Promise<FlyMachine[]> {
  return flyRequest<FlyMachine[]>(config, `/apps/${encodeURIComponent(config.appName)}/machines`);
}

export function getApp(config: FlyConfig): Promise<FlyApp> {
  return flyRequest<FlyApp>(config, `/apps/${encodeURIComponent(config.appName)}`);
}

export function runMachineAction(
  config: FlyConfig,
  machineId: string,
  action: FlyMachineAction
): Promise<unknown> {
  const app = encodeURIComponent(config.appName);
  const id = encodeURIComponent(machineId);
  switch (action) {
    case "start":
      return flyRequest(config, `/apps/${app}/machines/${id}/start`, { method: "POST" });
    case "stop":
      return flyRequest(config, `/apps/${app}/machines/${id}/stop`, { method: "POST" });
    case "restart":
      return flyRequest(config, `/apps/${app}/machines/${id}/restart`, { method: "POST" });
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Fly's process group for a machine, as set by `[processes]` in fly.toml. */
export function processGroupOf(machine: FlyMachine): string | null {
  return machine.config?.metadata?.fly_process_group ?? null;
}

/**
 * Whether a stopped machine is a problem. Machines that serve HTTP carry a
 * `services` block and are allowed to autostop to zero; a machine with no
 * services is a background process (our lifecycle worker) that should be up.
 * Deriving it from the machine config keeps this correct if the process
 * topology in fly.toml changes.
 */
export function expectsAlwaysOn(machine: FlyMachine): boolean {
  const services = machine.config?.services ?? [];
  if (services.length === 0) return true;
  return services.every((service) => service.autostop === false || service.autostop === "off");
}

export function imageTagOf(machine: FlyMachine): string | null {
  const ref = machine.image_ref;
  if (!ref) return null;
  return ref.tag ?? ref.digest ?? null;
}
