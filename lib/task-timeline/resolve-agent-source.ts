import { parse as parseYaml } from "yaml";
import type { ProjectZipEntry } from "@/lib/composer/import/select-project-files";

/**
 * Pick the `.agent` source file belonging to one broker out of a published
 * project zip.
 *
 * Kept free of the AgentScript parser on purpose: this is the part with real
 * decisions in it (which file, and when to refuse), so it stays importable by
 * plain Node for tests, while the parser only loads inside the app bundle.
 */

export interface AgentSourceResolution {
  entry: ProjectZipEntry | null;
  /** `brokers` key from agent-network.yaml, when the match came from there. */
  brokerKey?: string;
  /** Why no file could be chosen, for the view's empty state. */
  reason?: string;
}

/**
 * Broker keys and filenames disagree on separators — the key
 * `it_help_investigation` ships as `it-help-investigation.agent` — so names are
 * compared with separators removed.
 */
function canonicalName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAgentFile(filename: string): boolean {
  return /\.agent$/i.test(filename);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

interface YamlBrokerRef {
  key: string;
  implementation?: string;
  cardName?: string;
}

/**
 * Read every broker and its `implementation` path. The Composer's own YAML parser
 * is single-broker and drops `implementation`, but that field is the only reliable
 * link from a broker name to its source file, so it is read directly here.
 */
function readBrokerRefs(entries: ProjectZipEntry[]): YamlBrokerRef[] {
  const yamlEntry = entries.find((e) => /agent-network\.ya?ml$/i.test(e.filename));
  if (yamlEntry === undefined) return [];

  let doc: unknown;
  try {
    doc = parseYaml(yamlEntry.content);
  } catch {
    return [];
  }

  const root = doc as { brokers?: Record<string, unknown> } | null;
  const brokers = root?.brokers;
  if (typeof brokers !== "object" || brokers === null) return [];

  const refs: YamlBrokerRef[] = [];
  for (const [key, raw] of Object.entries(brokers)) {
    const value = raw as
      | { implementation?: unknown; interfaces?: { a2a?: { card?: { name?: unknown } } } }
      | null;
    const implementation =
      typeof value?.implementation === "string" ? value.implementation : undefined;
    const cardName =
      typeof value?.interfaces?.a2a?.card?.name === "string"
        ? value.interfaces.a2a.card.name
        : undefined;
    refs.push({
      key,
      ...(implementation != null ? { implementation } : {}),
      ...(cardName != null ? { cardName } : {}),
    });
  }
  return refs;
}

/**
 * `candidateNames` should carry every name the task knows the broker by (log agent
 * name, asset id, app id, API name) because none of them is guaranteed to equal
 * the YAML key.
 *
 * Refuses rather than guesses when several agents are published and none matches:
 * drawing the wrong agent's graph would misrepresent what ran, which is worse
 * than drawing nothing.
 */
export function resolveAgentEntry(
  entries: ProjectZipEntry[],
  candidateNames: string[]
): AgentSourceResolution {
  const agentEntries = entries.filter((e) => isAgentFile(e.filename));
  if (agentEntries.length === 0) {
    return { entry: null, reason: "The published project contains no .agent source file." };
  }

  const wanted = new Set(candidateNames.map(canonicalName).filter((n) => n !== ""));

  for (const ref of readBrokerRefs(entries)) {
    const names = [ref.key, ref.cardName].filter((n): n is string => n != null);
    if (!names.some((n) => wanted.has(canonicalName(n)))) continue;
    if (ref.implementation == null) continue;

    const target = normalizePath(ref.implementation);
    const match = agentEntries.find((e) => {
      const path = normalizePath(e.filename);
      return path === target || path.endsWith(`/${target}`) || target.endsWith(path);
    });
    if (match !== undefined) return { entry: match, brokerKey: ref.key };
  }

  // Unambiguous project: one source file, so there is nothing to get wrong.
  if (agentEntries.length === 1) {
    return { entry: agentEntries[0] };
  }

  return {
    entry: null,
    reason:
      `This project publishes ${agentEntries.length} .agent files and none could be matched to ` +
      `this task's broker, so the correct graph is ambiguous.`,
  };
}

export interface ExchangeAssetVersion {
  version: string;
  createdAt?: string | null;
}

/**
 * Choose which published version a task ran against.
 *
 * Tasks do not record the asset version, so it has to be inferred: the newest
 * version published at or before the task started is the one that was live when
 * it ran. Taking the latest version instead would silently draw edits made after
 * the fact. Falls back to the newest overall when timing is unavailable, which the
 * caller flags as un-pinned.
 */
export function chooseVersionForTask(
  versions: ExchangeAssetVersion[],
  taskStartedAtMs?: number
): string | null {
  const dated = versions
    .map((v) => ({ version: v.version, at: v.createdAt != null ? Date.parse(v.createdAt) : NaN }))
    .filter((v) => v.version.trim() !== "");
  if (dated.length === 0) return null;

  const parseable = dated.filter((v) => Number.isFinite(v.at));
  if (taskStartedAtMs != null && Number.isFinite(taskStartedAtMs) && parseable.length > 0) {
    const published = parseable.filter((v) => v.at <= taskStartedAtMs);
    if (published.length > 0) {
      return published.reduce((newest, v) => (v.at > newest.at ? v : newest)).version;
    }
  }

  if (parseable.length > 0) {
    return parseable.reduce((newest, v) => (v.at > newest.at ? v : newest)).version;
  }
  return dated[0].version;
}
