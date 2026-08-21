/**
 * Fetch a failed deploy's *own* Runtime Manager logs.
 *
 * A deploy can "succeed" at the CLI facet level yet still fail — the app is
 * created but never becomes healthy (a broker fails connection validation, a
 * dependency is unreachable, …). Runtime Manager keeps the deployment pending,
 * so the CLI eventually times out with a generic "request is hanging" message
 * while the real cause sits in the app's own log. This module resolves that
 * deployment and pulls the log lines, which the worker then streams into the
 * job's event log and runs the diagnosis catalog over.
 *
 * Dependency-light on purpose (the lifecycle worker imports it): global `fetch`
 * and pure helpers only — no `@/` alias imports, no `loggedFetch`, no Next.js.
 */

import { buildAmcLogsUrl } from "../api/amc-logs";
import { chooseSpecIdAtOrBefore, type AmcSpecDescriptor } from "../broker-tasks/amc-spec-selection";
import {
  deploymentNameCandidates,
  deploymentNamesMatch,
  type AmcDeploymentItem,
} from "../broker-context/amc-deployment-match";
import type { ProjectFileEntry } from "./contracts";

/** How far back to look for the deploy's log lines. The deploy itself is bounded
 *  by the CLI timeout (~5 min) plus the preceding build, so this comfortably
 *  covers the window in which the failure was written. */
const DEFAULT_WINDOW_MS = 20 * 60 * 1000;
/** A network deploy can create several apps (per-broker + graph facets); cap how
 *  many we pull logs for so a large network can't flood the event log. */
const DEFAULT_MAX_DEPLOYMENTS = 3;
/** Per-deployment line cap — enough for the error block without a log dump. */
const DEFAULT_MAX_LINES = 80;
/** Each upstream call is bounded so a hung Anypoint request never wedges the worker. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface FetchDeployLogsOptions {
  baseUrl: string;
  orgId: string;
  accessToken: string;
  /** The environment *name* the deploy targeted (as passed to the CLI). */
  environmentName: string;
  /** The uploaded project bundle — used to derive candidate deployment names. */
  project: ProjectFileEntry[];
  windowMs?: number;
  maxDeployments?: number;
  maxLines?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface DeployLogBundle {
  deploymentName: string;
  deploymentId: string;
  /** Log lines in chronological order, already trimmed to `maxLines`. */
  lines: string[];
}

export interface DeployFailureLogs {
  /** False when the environment name could not be matched (nothing else ran). */
  environmentFound: boolean;
  environmentId: string | null;
  /** One entry per matched deployment we could read logs for. */
  bundles: DeployLogBundle[];
}

interface EnvInfo {
  id: string;
  name: string;
  type?: string;
}

interface AmcLogEntry {
  timestamp?: number;
  message?: string;
  logLevel?: string;
}

async function getJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  accessToken: string
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function listRuntimeEnvironments(
  fetchImpl: typeof fetch,
  baseUrl: string,
  orgId: string,
  accessToken: string
): Promise<EnvInfo[]> {
  const url = `${baseUrl}/accounts/api/organizations/${orgId}/environments`;
  const data = await getJson<{ data?: EnvInfo[] }>(fetchImpl, url, accessToken);
  const all = data?.data ?? [];
  return all.filter((e) => (e.type || "").toLowerCase() !== "design");
}

function matchEnvironment(environments: EnvInfo[], name: string): EnvInfo | null {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  return (
    environments.find((e) => (e.name || "").toLowerCase() === target) ??
    environments.find((e) => (e.name || "").toLowerCase().includes(target)) ??
    null
  );
}

/**
 * Candidate deployment names for this project. Data-driven: the Exchange
 * name/assetId plus each broker key found under `brokers/*.agent`, expanded to
 * their hyphen variants. No project-, broker-, or tenant-specific literals.
 */
export function deploymentNameCandidatesFromProject(project: ProjectFileEntry[]): string[] {
  const rawNames: string[] = [];

  const exchange = project.find(
    (f) => f.filename === "exchange.json" || f.filename.endsWith("/exchange.json")
  );
  if (exchange) {
    try {
      const parsed = JSON.parse(exchange.content) as { name?: unknown; assetId?: unknown };
      if (typeof parsed.assetId === "string" && parsed.assetId.trim()) rawNames.push(parsed.assetId.trim());
      if (typeof parsed.name === "string" && parsed.name.trim()) rawNames.push(parsed.name.trim());
    } catch {
      // A malformed bundle just yields fewer candidates; matching still tries brokers.
    }
  }

  for (const file of project) {
    const match = /(?:^|\/)brokers\/([^/]+)\.agent$/.exec(file.filename);
    if (match?.[1]) rawNames.push(match[1]);
  }

  return deploymentNameCandidates(...rawNames);
}

function selectMatchingDeployments(
  items: AmcDeploymentItem[],
  candidates: string[],
  max: number
): AmcDeploymentItem[] {
  const chosen: AmcDeploymentItem[] = [];
  const seen = new Set<string>();
  const take = (item: AmcDeploymentItem): void => {
    if (!item.id || seen.has(item.id)) return;
    seen.add(item.id);
    chosen.push(item);
  };

  // Exact matches first so the network's own app wins over near-name neighbours.
  for (const candidate of candidates) {
    for (const item of items) if (item.name === candidate) take(item);
  }
  for (const candidate of candidates) {
    for (const item of items) if (deploymentNamesMatch(item.name, candidate)) take(item);
  }

  return chosen.slice(0, max);
}

async function resolveSpecId(
  fetchImpl: typeof fetch,
  baseUrl: string,
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  endTimeMs: number
): Promise<string | null> {
  const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs`;
  const specs = await getJson<AmcSpecDescriptor[]>(fetchImpl, specsUrl, accessToken);
  if (Array.isArray(specs)) {
    const specId = chooseSpecIdAtOrBefore(specs, endTimeMs);
    if (specId) return specId;
  }
  const depUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;
  const dep = await getJson<{ desiredVersion?: string; replicas?: Array<{ id: string }> }>(
    fetchImpl,
    depUrl,
    accessToken
  );
  return dep?.desiredVersion ?? dep?.replicas?.[0]?.id ?? null;
}

async function fetchLogLines(
  fetchImpl: typeof fetch,
  baseUrl: string,
  orgId: string,
  envId: string,
  deploymentId: string,
  specId: string,
  accessToken: string,
  startTime: number,
  endTime: number,
  maxLines: number
): Promise<string[]> {
  const url = buildAmcLogsUrl({
    baseUrl,
    organizationId: orgId,
    environmentId: envId,
    deploymentId,
    specificationId: specId,
    search: { length: Math.min(Math.max(maxLines, 1), 1000), startTime, endTime, descending: true },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const entries = (await res.json()) as AmcLogEntry[];
      if (!Array.isArray(entries)) return [];
      // The endpoint returns newest-first; take the most recent slice and flip
      // it back to chronological order for display.
      return entries
        .slice(0, maxLines)
        .reverse()
        .map((entry) => {
          const ts = entry.timestamp != null ? new Date(entry.timestamp).toISOString() : "";
          const level = entry.logLevel ? `[${entry.logLevel}] ` : "";
          return `${ts} ${level}${entry.message ?? ""}`.trim();
        })
        .filter((line) => line.length > 0);
    }
    const text = await res.text();
    return text
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the deployment(s) this project produced in the target environment and
 * return their recent Runtime Manager log lines. Best-effort throughout: any
 * missing permission, unmatched name, or upstream error yields an empty bundle
 * list rather than throwing, so the caller can fall back to a plain message.
 */
export async function fetchDeployFailureLogs(
  options: FetchDeployLogsOptions
): Promise<DeployFailureLogs> {
  const {
    baseUrl,
    orgId,
    accessToken,
    environmentName,
    project,
    windowMs = DEFAULT_WINDOW_MS,
    maxDeployments = DEFAULT_MAX_DEPLOYMENTS,
    maxLines = DEFAULT_MAX_LINES,
    fetchImpl = fetch,
  } = options;

  const empty: DeployFailureLogs = { environmentFound: false, environmentId: null, bundles: [] };
  if (!baseUrl || !orgId || !accessToken) return empty;

  const environments = await listRuntimeEnvironments(fetchImpl, baseUrl, orgId, accessToken);
  const env = matchEnvironment(environments, environmentName);
  if (!env) return empty;

  const endTime = Date.now();
  const startTime = endTime - windowMs;

  const candidates = deploymentNameCandidatesFromProject(project);
  const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`;
  const list = await getJson<{ items?: AmcDeploymentItem[] }>(fetchImpl, listUrl, accessToken);
  const items = (list?.items ?? []).filter(
    (item): item is AmcDeploymentItem =>
      typeof item?.id === "string" && typeof item?.name === "string"
  );
  const selected = selectMatchingDeployments(items, candidates, maxDeployments);

  const bundles: DeployLogBundle[] = [];
  for (const deployment of selected) {
    const specId = await resolveSpecId(
      fetchImpl,
      baseUrl,
      orgId,
      env.id,
      deployment.id,
      accessToken,
      endTime
    );
    if (!specId) continue;
    const lines = await fetchLogLines(
      fetchImpl,
      baseUrl,
      orgId,
      env.id,
      deployment.id,
      specId,
      accessToken,
      startTime,
      endTime,
      maxLines
    );
    if (lines.length > 0) {
      bundles.push({ deploymentName: deployment.name, deploymentId: deployment.id, lines });
    }
  }

  return { environmentFound: true, environmentId: env.id, bundles };
}
