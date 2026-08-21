import { loggedFetch, debugLog, debugError, debugToken } from "@/lib/api-logger";
import { measurePhase, type PhaseTimer } from "@/lib/api/timing";
import {
  extractStringsFromPickledTask,
  looksLikePickle,
  parsePickledA2ATask,
  parsePickledGraphState,
} from "@/lib/object-store/pickle-a2a";
import {
  buildTaskStoryFromStorageEntry,
  describeV2StorageShape,
  extractStringsFromV2StorageEntry,
  isV1TasksPartition,
  isV2GraphStatePartition,
  isV2TaskStorePartition,
  rankV2GraphStatePartitions,
  rankV2TaskPartitions,
  type ObjectStoreBrokerFormat,
  type TaskStory,
  type TaskStoryStateEntry,
} from "@/lib/object-store/v2-parser";

const OBJECT_STORE_REGIONS = [
  // North America
  "us-east-1",      // US East (N. Virginia)
  "us-east-2",      // US East (Ohio)
  "us-west-1",      // US West (N. California)
  "us-west-2",      // US West (Oregon)
  "ca-central-1",   // Canada (Central)
  "us-gov-west-1", // US GovCloud (West)
  // Europe
  "eu-west-1",      // Ireland
  "eu-west-2",      // UK (London)
  "eu-central-1",   // Germany (Frankfurt)
  // Asia Pacific
  "ap-southeast-1", // Singapore
  "ap-southeast-2", // Australia (Sydney)
  "ap-northeast-1", // Japan (Tokyo)
  // South America
  "sa-east-1",      // Brazil (São Paulo)
] as const;

type ObjectStoreRegion = string;

const DEFAULT_OBJECT_STORE_FALLBACK_REGIONS: ObjectStoreRegion[] = [
  "us-east-1",
  "us-west-2",
  "eu-central-1",
  "ca-central-1",
];
const OBJECT_STORE_REGION_CACHE_TTL_MS = 30 * 60 * 1000;
const objectStoreRegionCache = new Map<
  string,
  { regions: ObjectStoreRegion[]; cachedAt: number }
>();

interface ObjectStoreValue {
  keyId: string;
  valueType: "BINARY" | "STRING";
  binaryValue?: string; // Base64-encoded (v1 Java serialization)
  stringValue?: string; // JSON StorageEntry (v2 broker)
}

interface ObjectStoreStoresResponse {
  values: Array<{
    storeId: string;
    name?: string;
    /** Store-level key expiry. The runtime cannot set a per-key TTL, so this
     * is the effective retention for every entry in the store. */
    defaultTtlSeconds?: number | null;
  }>;
}

const STORE_RETENTION_CACHE_TTL_MS = 30 * 60 * 1000;
const storeRetentionCache = new Map<
  string,
  { retentionMs: number; cachedAt: number }
>();

/** Cache key for the per-deployment store facts: location and retention. */
function deploymentStoreKey(orgId: string, envId: string, deploymentId: string): string {
  return `${orgId}:${envId}:${deploymentId}`;
}

const STORE_LOCATION_CACHE_TTL_MS = 30 * 60 * 1000;
const storeLocationCache = new Map<
  string,
  { storeId: string; region: ObjectStoreRegion; cachedAt: number }
>();

/**
 * Resolve with the first promise to yield a non-null value, or null once every
 * promise has settled without one. Unlike `Promise.race` this ignores losers
 * that resolve null or reject, so a fast "not here" answer cannot mask a
 * slower "found it", and a slow straggler cannot delay a hit that already
 * arrived. Rejections are swallowed deliberately: callers treat an
 * unreachable region as "no store here", not as a failure of the whole search.
 */
function firstNonNull<T>(promises: Array<Promise<T | null>>): Promise<T | null> {
  if (promises.length === 0) return Promise.resolve(null);
  return new Promise<T | null>((resolve) => {
    let outstanding = promises.length;
    let done = false;
    for (const promise of promises) {
      void promise
        .then((value) => {
          if (value != null && !done) {
            done = true;
            resolve(value);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          outstanding -= 1;
          if (outstanding === 0 && !done) {
            done = true;
            resolve(null);
          }
        });
    }
  });
}

function rememberStoreRetention(
  cacheKey: string,
  store: { storeId: string; defaultTtlSeconds?: number | null }
): void {
  const seconds = store.defaultTtlSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return;
  storeRetentionCache.set(cacheKey, {
    retentionMs: seconds * 1000,
    cachedAt: Date.now(),
  });
  debugLog(
    `[ObjectStore] Store ${store.storeId} retention: ${seconds}s (${(seconds / 86400).toFixed(1)} days)`
  );
}

/**
 * Effective key retention for a deployment's Object Store, as reported by the
 * platform during store discovery. Returns `undefined` until a store has been
 * found, so callers must not treat "unknown" as "expired".
 */
export function getKnownObjectStoreRetentionMs(
  orgId: string,
  envId: string,
  deploymentId: string
): number | undefined {
  const cached = storeRetentionCache.get(deploymentStoreKey(orgId, envId, deploymentId));
  if (cached == null) return undefined;
  if (Date.now() - cached.cachedAt > STORE_RETENTION_CACHE_TTL_MS) return undefined;
  return cached.retentionMs;
}

interface ObjectStorePartitionsResponse {
  values: string[]; // Partition names are returned as strings, not objects
}

interface ObjectStoreKeysResponse {
  values: Array<{
    keyId: string;
  }>;
}

/**
 * Extract readable strings from Java-serialized binary data
 * Uses a simple approach: decode base64 and extract strings
 */
function extractStringsFromBinary(base64Data: string): string[] {
  try {
    const binary = Buffer.from(base64Data, "base64");
    const strings: string[] = [];
    let currentString = "";

    // Simple string extraction: look for sequences of printable ASCII characters
    for (let i = 0; i < binary.length; i++) {
      const byte = binary[i];
      // Printable ASCII range (32-126) plus newline/tab
      if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
        currentString += String.fromCharCode(byte);
      } else {
        if (currentString.length >= 10) {
          // Only keep strings of reasonable length
          strings.push(currentString);
        }
        currentString = "";
      }
    }

    // Add last string if any
    if (currentString.length >= 10) {
      strings.push(currentString);
    }

    return strings;
  } catch (error) {
    debugError("[ObjectStore] Error extracting strings:", error);
    return [];
  }
}

/** Step header pattern: "STEP 1:", "ISTEP 1:", or "Step 1:" (broker may use title case) */
const STEP_HEADER_REGEX = /^((?:I)?STEP\s+\d+):\s*(.+)$/i;

/** Exclude Java/serialization noise and short tokens from reasoning display */
function isLikelyNoise(s: string): boolean {
  if (s.length < 10) return true;
  if (/^com\.mulesoft|^java\.|^[a-z]+\.[a-z]+\.[a-z]+/.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^call_[A-Za-z0-9_-]+$/.test(s)) return true;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && !s.includes(" ") && !s.includes('"')) return true; // long token with no spaces/quotes
  if (/^container\/app\//.test(s) && s.length < 80) return true; // plugin path
  return false;
}

/** Include strings that look like agent/tool reasoning (workflow, status, artifacts, prompts, summaries) */
function isReasoningLike(s: string): boolean {
  if (isLikelyNoise(s)) return false;
  if (s.length >= 80) return true; // long readable content
  if (s.length >= 30 && (/workflow|Followed|retrieved|must now|confirm|Personal Information|Financial Goals|movements|Investment Plan/i.test(s) || /"message"|"status"|"text"|messageParts|artifacts/i.test(s))) return true;
  if (s.length >= 20 && (/Contacting|Retrieving|status":|updateStatus|_:agentforce|_:gcpbanking/i.test(s) || (s.startsWith('"') && s.includes(" ")))) return true;
  return false;
}

/**
 * Split a single string that contains multiple "Step N:" blocks into step parts.
 * Example: "Step 2: Analysis... Step 3: Decision..." -> [{ label: "Step 2:", text: "Analysis..." }, ...]
 */
function splitSingleStringIntoSteps(s: string): Array<{ label: string; text: string }> {
  const re = /((?:I)?STEP\s+\d+):\s*/gi;
  const matches: Array<{ index: number; label: string; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    matches.push({
      index: m.index,
      label: m[1] + ":",
      end: m.index + m[0].length,
    });
  }
  if (matches.length === 0) return [];
  return matches.map((match, i) => {
    const textStart = match.end;
    const textEnd = i + 1 < matches.length ? matches[i + 1].index : s.length;
    const text = s.slice(textStart, textEnd).trim();
    return { label: match.label, text };
  });
}

/**
 * Parse LLM reasoning from extracted strings
 * Looks for STEP/Step patterns and groups content
 */
function parseLLMReasoning(strings: string[]): {
  steps: Array<{ step: string; content: string[] }>;
  rawReasoning: string[];
} {
  const steps: Array<{ step: string; content: string[] }> = [];
  const rawReasoning: string[] = [];
  let currentStep: { step: string; content: string[] } | null = null;

  for (const str of strings) {
    // Check if this is a step header (e.g., "STEP 1:", "ISTEP 1:", "Step 2: ANALYSIS")
    const stepMatch = str.match(STEP_HEADER_REGEX);
    if (stepMatch) {
      if (currentStep) steps.push(currentStep);
      const stepTitle = stepMatch[2]?.trim() || stepMatch[1].trim();
      currentStep = {
        step: `${stepMatch[1].trim()}: ${stepTitle}`,
        content: [],
      };
      rawReasoning.push(str);
    } else if (currentStep) {
      if (str.length >= 10 && !str.match(/^com\.mulesoft|^java\.|^[a-z]+\.[a-z]+\./)) {
        // If this single string contains multiple "Step N:" blocks, split and push as separate steps
        const splitSteps = splitSingleStringIntoSteps(str);
        if (splitSteps.length > 1) {
          for (const { label, text } of splitSteps) {
            if (currentStep) steps.push(currentStep);
            currentStep = {
              step: label,
              content: text ? [text] : [],
            };
          }
          rawReasoning.push(str);
          continue;
        }
        currentStep.content.push(str);
        rawReasoning.push(str);
      }
    } else {
      const isReasoningContent =
        str.length > 50 &&
        (
          /(?:^|[\s:])(STEP|ISTEP|Step)\s+\d+/i.test(str) ||
          str.includes("Analysis") ||
          str.includes("Decision") ||
          str.includes("Per rules") ||
          str.includes("Per instructions") ||
          str.includes("NoDispute") ||
          str.includes("DisputeFound") ||
          str.includes("determined") ||
          str.includes("decided") ||
          str.includes("reasoning") ||
          (str.includes("tool") && str.length > 100) ||
          (str.includes("agent") && str.length > 100)
        ) &&
        !str.match(/^com\.mulesoft|^java\.|^[a-z]+\.[a-z]+\.[a-z]+/) &&
        !str.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      if (isReasoningContent) {
        rawReasoning.push(str);
        const splitSteps = splitSingleStringIntoSteps(str);
        if (splitSteps.length > 1) {
          for (const { label, text } of splitSteps) {
            if (currentStep) steps.push(currentStep);
            currentStep = {
              step: label,
              content: text ? [text] : [],
            };
          }
        } else {
          const inferredStepMatch = str.match(/((?:I)?STEP\s+\d+):\s*(.+)/i);
          if (inferredStepMatch) {
            currentStep = {
              step: `${inferredStepMatch[1].trim()}: ${inferredStepMatch[2]?.trim() || "Reasoning"}`,
              content: [str],
            };
          }
        }
      }
    }
  }

  if (currentStep) steps.push(currentStep);

  // Include all reasoning-like strings from the full list so the Reasoning tab shows workflow summaries,
  // agent responses, status updates, and tool prompts—not just the first two that passed the strict filter.
  const reasoningLike = strings.filter((s) => isReasoningLike(s));
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of rawReasoning) {
    if (!seen.has(s)) {
      seen.add(s);
      merged.push(s);
    }
  }
  for (const s of reasoningLike) {
    if (!seen.has(s)) {
      seen.add(s);
      merged.push(s);
    }
  }

  return {
    steps,
    rawReasoning: merged.length > 0 ? merged : rawReasoning.length > 0 ? rawReasoning : [],
  };
}

/**
 * Extract tool call IDs from strings
 */
function extractToolCallIds(strings: string[]): string[] {
  const toolCallIds = new Set<string>();
  for (const str of strings) {
    const matches = str.match(/call_[A-Za-z0-9_-]+/g);
    if (matches) {
      matches.forEach((id: string) => toolCallIds.add(id));
    }
  }
  return Array.from(toolCallIds);
}

/**
 * Extract downstream agent contexts from strings
 */
function extractDownstreamContexts(strings: string[]): Array<{ agent: string; contextId: string; taskId: string }> {
  const contexts: Array<{ agent: string; contextId: string; taskId: string }> = [];
  const seen = new Set<string>();

  // Look for patterns like agent names, context IDs, and task IDs
  for (const str of strings) {
    // Extract agent names (pattern: [agentName]_[type])
    const agentMatch = str.match(/([A-Za-z0-9_-]+_(?:AWS|Azure|Finance|Operations|Work|Agent))/);
    // Extract UUIDs (context IDs and task IDs)
    const uuidMatch = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);

    if (agentMatch && uuidMatch && uuidMatch.length >= 2) {
      const key = `${agentMatch[1]}-${uuidMatch[0]}-${uuidMatch[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        contexts.push({
          agent: agentMatch[1],
          contextId: uuidMatch[0],
          taskId: uuidMatch[1],
        });
      }
    }
  }

  return contexts;
}

function isObjectStoreRegion(s: string): s is ObjectStoreRegion {
  return (
    s.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+){2,4}$/.test(s)
  );
}

interface ObjectStoreRegionDescriptor {
  id?: unknown;
}

/**
 * Discover all Object Store regions available to an organization using the
 * documented Object Store v2 regions operation. Region IDs are validated and
 * used only to construct hosts under the fixed anypoint.mulesoft.com suffix.
 */
async function discoverObjectStoreRegions(
  orgId: string,
  accessToken: string
): Promise<ObjectStoreRegion[]> {
  const cached = objectStoreRegionCache.get(orgId);
  if (
    cached &&
    Date.now() - cached.cachedAt < OBJECT_STORE_REGION_CACHE_TTL_MS
  ) {
    return cached.regions;
  }

  const url =
    "https://object-store-us-east-1.anypoint.mulesoft.com" +
    `/api/v1/organizations/${encodeURIComponent(orgId)}/regions`;

  try {
    const response = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      debugLog(
        `[ObjectStore] Region discovery returned HTTP ${response.status}; using static fallback`
      );
      return [];
    }

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      debugLog(
        "[ObjectStore] Region discovery returned an unexpected response; using static fallback"
      );
      return [];
    }

    const regions = Array.from(
      new Set(
        body
          .map((item: ObjectStoreRegionDescriptor) => item?.id)
          .filter(
            (id: unknown): id is ObjectStoreRegion =>
              typeof id === "string" && isObjectStoreRegion(id)
          )
      )
    );

    if (regions.length > 0) {
      objectStoreRegionCache.set(orgId, {
        regions,
        cachedAt: Date.now(),
      });
      debugLog(
        `[ObjectStore] Discovered regions for organization: ${regions.join(", ")}`
      );
    }
    return regions;
  } catch (error) {
    debugLog(
      "[ObjectStore] Region discovery failed; using static fallback:",
      error
    );
    return [];
  }
}

/**
 * CloudHub hostname region codes (e.g. usa-e2 from *.usa-e2.cloudhub.io) to object store region.
 * Anypoint UI uses deployment's internalUrl hostname to pick object-store-{region}.anypoint.mulesoft.com.
 */
const CLOUDHUB_REGION_TO_OBJECT_STORE: Record<string, ObjectStoreRegion> = {
  // North America
  "usa-e1": "us-east-1",      // US East (N. Virginia)
  "usa-e2": "us-east-2",      // US East (Ohio)
  "usa-w1": "us-west-1",      // US West (N. California)
  "usa-w2": "us-west-2",      // US West (Oregon)
  "can-c1": "ca-central-1",   // Canada (Central)
  "usg-w1": "us-gov-west-1",  // US GovCloud (West)
  
  // South America
  "bra-s1": "sa-east-1",      // Brazil (São Paulo)
  
  // Europe
  "irl-e1": "eu-west-1",      // Ireland
  "deu-c1": "eu-central-1",   // Germany (Frankfurt)
  "gbr-e1": "eu-west-2",      // UK (London)
  
  // Asia Pacific
  "sgp-s1": "ap-southeast-1", // Singapore
  "aus-s1": "ap-southeast-2", // Australia (Sydney)
  "jpn-e1": "ap-northeast-1", // Japan (Tokyo)
  
  // Legacy/backward compatibility codes (older CloudHub region naming)
  "use-c1": "us-east-1",      // Legacy: US East (N. Virginia)
  "usw-c1": "us-west-2",      // Legacy: US West (Oregon)
  "euw-c1": "eu-west-1",      // Legacy: Ireland
  "aps-c1": "ap-southeast-1", // Legacy: Singapore
  "aps2-c1": "ap-southeast-2", // Legacy: Australia (Sydney)
};

/** Categories we suggest for Runtime Manager → Monitoring (log forwarding) for full task visibility. */
const MONITORING_CATEGORY_INSECURE_LOGGING = "INSECURE-LOGGING";

/**
 * Detect if deployment detail (from AMC GET deployment) includes the recommended log categories.
 * Uses the same deployment JSON we already fetch for region; no extra API call.
 * Returns true for each category if it appears anywhere in the deployment config (e.g. monitoring log levels).
 */
export function getMonitoringLogCategoriesFromDeployment(deployment: Record<string, unknown>): {
  insecureLogging: boolean;
} {
  debugLog("[getMonitoringLogCategoriesFromDeployment] ========== START ==========");
  debugLog(`[getMonitoringLogCategoriesFromDeployment] Searching for categories:`);
  debugLog(`[getMonitoringLogCategoriesFromDeployment]   - insecureLogging: "${MONITORING_CATEGORY_INSECURE_LOGGING}"`);
  
  try {
    // Log deployment structure overview
    debugLog(`[getMonitoringLogCategoriesFromDeployment] Deployment object keys: ${Object.keys(deployment).join(", ")}`);
    
    // Check for monitoring-related fields
    const deploymentAny = deployment as { monitoring?: unknown; target?: { deploymentSettings?: { monitoring?: unknown } } };
    if (deploymentAny.monitoring) {
      debugLog(`[getMonitoringLogCategoriesFromDeployment] Found top-level 'monitoring' field: ${JSON.stringify(deploymentAny.monitoring).substring(0, 500)}`);
    }
    if (deploymentAny.target?.deploymentSettings?.monitoring) {
      debugLog(`[getMonitoringLogCategoriesFromDeployment] Found 'target.deploymentSettings.monitoring' field: ${JSON.stringify(deploymentAny.target.deploymentSettings.monitoring).substring(0, 500)}`);
    }
    
    const s = JSON.stringify(deployment);
    debugLog(`[getMonitoringLogCategoriesFromDeployment] Deployment JSON string length: ${s.length} characters`);
    
    // Search for insecureLogging
    const insecureLoggingFound = s.includes(MONITORING_CATEGORY_INSECURE_LOGGING);
    debugLog(`[getMonitoringLogCategoriesFromDeployment] Searching for "${MONITORING_CATEGORY_INSECURE_LOGGING}": ${insecureLoggingFound ? "✓ FOUND" : "✗ NOT FOUND"}`);
    if (!insecureLoggingFound) {
      // Try to find similar patterns
      const insecurePatterns = [
        /INSECURE/i,
        /INSECURE.*LOG/i,
        /insecure.*log/i,
      ];
      for (const pattern of insecurePatterns) {
        if (pattern.test(s)) {
          const match = s.match(pattern);
          debugLog(`[getMonitoringLogCategoriesFromDeployment]   Found similar pattern: "${match?.[0]}"`);
        }
      }
    } else {
      // Find where it appears
      const index = s.indexOf(MONITORING_CATEGORY_INSECURE_LOGGING);
      const context = s.substring(Math.max(0, index - 100), Math.min(s.length, index + MONITORING_CATEGORY_INSECURE_LOGGING.length + 100));
      debugLog(`[getMonitoringLogCategoriesFromDeployment]   Found at position ${index}, context: "${context}"`);
    }
    
    // Sample relevant parts of deployment JSON for debugging
    const sampleSize = 2000;
    const sample = s.length > sampleSize ? s.substring(0, sampleSize) + "..." : s;
    debugLog(`[getMonitoringLogCategoriesFromDeployment] Deployment JSON sample (first ${Math.min(sampleSize, s.length)} chars):`);
    debugLog(`[getMonitoringLogCategoriesFromDeployment] ${sample}`);
    
    const result = { insecureLogging: insecureLoggingFound };
    debugLog(`[getMonitoringLogCategoriesFromDeployment] Result: insecureLogging=${result.insecureLogging}`);
    debugLog("[getMonitoringLogCategoriesFromDeployment] ========== END ==========");
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[getMonitoringLogCategoriesFromDeployment] Error during detection: ${errorMessage}`);
    debugLog("[getMonitoringLogCategoriesFromDeployment] ========== END (ERROR) ==========");
    return { insecureLogging: false };
  }
}

/**
 * Infer monitoring categories from task log entries. When the deployment API does not include
 * monitoring config in its response, we can still detect "Set" if the task's own logs show
 * these loggers (logger name or class contains the category). Used to merge with deployment-based
 * result so we do not show "Not set" when logs prove the categories are enabled.
 */
export function getMonitoringFromLogEntries(entries: unknown[]): {
  insecureLogging: boolean;
} {
  let insecureLogging = false;
  try {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const s =
        [e.logger, e.raw, (e.raw as Record<string, unknown>)?.logger, (e.raw as Record<string, unknown>)?.class, (e.raw as Record<string, unknown>)?.message]
          .filter(Boolean)
          .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
          .join(" ");
      if (s.includes(MONITORING_CATEGORY_INSECURE_LOGGING)) insecureLogging = true;
      if (insecureLogging) break;
    }
  } catch {
    // ignore
  }
  return { insecureLogging };
}

/**
 * Object Store server URL env vars, in the precedence the broker runtime itself
 * uses (`_SERVER_URL_ENVVARS`): the self-managed RTF name wins over the managed
 * RTFc one. The runtime resolves its store endpoint from these, so whatever
 * region they name is authoritative — the deployment's own hostname is only a
 * correlation.
 */
const OBJECT_STORE_SERVER_URL_ENVVARS = [
  "PERSISTENT_OBJECTSTORE_URL",
  "OBJECTSTORE_CLIENT_SERVER_URL",
] as const;

/**
 * Pull the region out of the broker's configured Object Store endpoint, e.g.
 * `https://object-store-eu-west-1.anypoint.mulesoft.com/api/v1` → `eu-west-1`.
 */
function regionFromObjectStoreUrl(rawUrl: string): ObjectStoreRegion | null {
  const match = /object-store-([a-z0-9-]+)\.anypoint\.mulesoft\.com/i.exec(rawUrl);
  const region = match?.[1]?.toLowerCase();
  return region != null && isObjectStoreRegion(region) ? region : null;
}

/**
 * Extract object store region from deployment detail JSON.
 *
 * Sources in order of authority:
 *  1. The broker's own Object Store endpoint env var, which names the store
 *     region outright (self-managed RTF; on managed CloudHub the platform
 *     injects these at deploy time so the spec reports them empty).
 *  2. `target.targetId`, which for CloudHub 2.0 shared spaces is literally
 *     `cloudhub-{region}`. Private spaces and RTF use a UUID here, so those
 *     fall through.
 *  3. Hostname inference from deployment URLs (*.XX-XX.cloudhub.io, e.g.
 *     deu-c1 → eu-central-1). Last resort: `http.inbound` is frequently `{}`,
 *     which is why region detection previously failed outright and fell back to
 *     scanning every region.
 */
export function getObjectStoreRegionFromDeployment(deployment: {
  target?: {
    targetId?: string;
    deploymentSettings?: {
      environmentVariables?: Record<string, string>;
      http?: {
        inbound?: { internalUrl?: string; endpoints?: Array<{ url?: string }> };
      };
    };
  };
}): ObjectStoreRegion | null {
  debugLog(`[ObjectStore] Starting region detection from deployment detail`);

  const envVars = deployment.target?.deploymentSettings?.environmentVariables;
  for (const name of OBJECT_STORE_SERVER_URL_ENVVARS) {
    const value = envVars?.[name];
    if (value == null || value.trim().length === 0) continue;
    const region = regionFromObjectStoreUrl(value);
    if (region != null) {
      debugLog(`[ObjectStore] SUCCESS: region ${region} from broker env var ${name}`);
      return region;
    }
    debugLog(`[ObjectStore] ${name} present but no region parsed from it`);
  }
  debugLog("[ObjectStore] No Object Store server URL env var on deployment; trying target.targetId");

  const targetId = deployment.target?.targetId?.trim().toLowerCase();
  if (targetId != null && targetId.length > 0) {
    // Only the `cloudhub-{region}` form encodes a region. A bare targetId is a
    // private-space or RTF UUID, whose shape would slip past isObjectStoreRegion.
    const candidate = targetId.startsWith("cloudhub-")
      ? targetId.slice("cloudhub-".length)
      : null;
    if (candidate != null && isObjectStoreRegion(candidate)) {
      debugLog(`[ObjectStore] SUCCESS: region ${candidate} from target.targetId "${targetId}"`);
      return candidate;
    }
    debugLog(`[ObjectStore] target.targetId "${targetId}" does not encode a region (private space or RTF)`);
  }
  debugLog("[ObjectStore] Falling back to hostname inference");
  
  const urls: string[] = [];
  const inbound = deployment.target?.deploymentSettings?.http?.inbound;
  
  // Check if deployment detail API returned internalUrl
  if (inbound?.internalUrl) {
    urls.push(inbound.internalUrl);
    debugLog(`[ObjectStore] Found internalUrl in deployment: ${inbound.internalUrl}`);
  } else {
    debugLog(`[ObjectStore] WARNING: Deployment detail API does not contain internalUrl. Path checked: target.deploymentSettings.http.inbound.internalUrl`);
  }
  
  // Check endpoints array
  if (inbound?.endpoints && inbound.endpoints.length > 0) {
    inbound.endpoints.forEach((e, idx) => {
      if (e.url) {
        urls.push(e.url);
        debugLog(`[ObjectStore] Found endpoint[${idx}].url: ${e.url}`);
      }
    });
  } else {
    debugLog(`[ObjectStore] No endpoints array found or endpoints array is empty`);
  }
  
  if (urls.length === 0) {
    debugLog(`[ObjectStore] ERROR: No URLs found in deployment detail. Cannot detect region.`);
    debugLog(`[ObjectStore] Deployment structure: ${JSON.stringify({
      hasTarget: !!deployment.target,
      hasDeploymentSettings: !!deployment.target?.deploymentSettings,
      hasHttp: !!deployment.target?.deploymentSettings?.http,
      hasInbound: !!deployment.target?.deploymentSettings?.http?.inbound,
      hasInternalUrl: !!deployment.target?.deploymentSettings?.http?.inbound?.internalUrl,
      hasEndpoints: !!deployment.target?.deploymentSettings?.http?.inbound?.endpoints,
      endpointsLength: deployment.target?.deploymentSettings?.http?.inbound?.endpoints?.length ?? 0,
    })}`);
    return null;
  }
  
  debugLog(`[ObjectStore] Analyzing ${urls.length} URL(s) for region detection`);
  
  for (const u of urls) {
    debugLog(`[ObjectStore] Analyzing URL: ${u}`);
    
    // Check if URL matches expected pattern
    const match = u.match(/\.([a-z]{3}-[a-z0-9]{2})\.cloudhub\.io/i);
    if (!match) {
      debugLog(`[ObjectStore] URL does not match expected pattern: *.XX-XX.cloudhub.io`);
      debugLog(`[ObjectStore] URL format check: ${u.includes('.cloudhub.io') ? 'contains .cloudhub.io' : 'does NOT contain .cloudhub.io'}`);
      // Try to find any cloudhub.io pattern
      const cloudhubMatch = u.match(/\.([a-z0-9-]+)\.cloudhub\.io/i);
      if (cloudhubMatch) {
        debugLog(`[ObjectStore] Found different cloudhub.io pattern: ${cloudhubMatch[1]} (expected format: XXX-XX)`);
      }
      continue;
    }
    
    const code = match[1].toLowerCase();
    debugLog(`[ObjectStore] Extracted CloudHub region code: ${code}`);
    
    // Check if code exists in mapping table
    const region = CLOUDHUB_REGION_TO_OBJECT_STORE[code];
    if (region) {
      debugLog(`[ObjectStore] SUCCESS: Mapped CloudHub code "${code}" → Object Store region "${region}"`);
      return region;
    } else {
      debugLog(`[ObjectStore] WARNING: CloudHub region code "${code}" not found in mapping table`);
      debugLog(`[ObjectStore] Available mappings: ${Object.keys(CLOUDHUB_REGION_TO_OBJECT_STORE).join(", ")}`);
    }
    
    // Check if code is already a valid Object Store region
    if (isObjectStoreRegion(code)) {
      debugLog(`[ObjectStore] SUCCESS: CloudHub code "${code}" is already a valid Object Store region`);
      return code;
    } else {
      debugLog(`[ObjectStore] CloudHub code "${code}" is not a valid Object Store region`);
    }
  }
  
  debugLog(`[ObjectStore] ERROR: Region detection failed after analyzing all ${urls.length} URL(s)`);
  debugLog(`[ObjectStore] Summary: Checked URLs: ${urls.join(", ")}`);
  return null;
}

/**
 * Find Object Store for a deployment by trying different regions.
 * If preferredRegion (or env OBJECT_STORE_REGION) is set and valid, that region is tried first.
 * When falling back to broker-partition matching, we resolve by task key presence: the definitive
 * store is the one that actually contains the taskId (not the first store with matching partition names).
 */
async function findObjectStore(
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  brokerName: string,
  deploymentType?: string,
  preferredRegion?: string,
  taskId?: string
): Promise<{ storeId: string; region: ObjectStoreRegion } | null> {
  // A deployment's store never moves, but resolving it costs a regions-discovery
  // call plus a fan-out across every region — measured at ~2.2s, roughly 35x the
  // cost of then reading the task value. Opening several tasks for the same
  // broker paid that toll every time.
  const cacheKey = deploymentStoreKey(orgId, envId, deploymentId);
  const cached = storeLocationCache.get(cacheKey);
  if (cached != null && Date.now() - cached.cachedAt <= STORE_LOCATION_CACHE_TTL_MS) {
    debugLog(`[ObjectStore] Store location cache hit: ${cached.storeId} in ${cached.region}`);
    return { storeId: cached.storeId, region: cached.region };
  }

  const resolved = await findObjectStoreUncached(
    orgId,
    envId,
    deploymentId,
    accessToken,
    brokerName,
    deploymentType,
    preferredRegion,
    taskId
  );
  if (resolved != null) {
    storeLocationCache.set(cacheKey, { ...resolved, cachedAt: Date.now() });
  }
  return resolved;
}

async function findObjectStoreUncached(
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  brokerName: string,
  deploymentType?: string,
  preferredRegion?: string,
  taskId?: string
): Promise<{ storeId: string; region: ObjectStoreRegion } | null> {
  // Try two prefix patterns (Anypoint UI uses shorter prefix: APP_{deploymentId}_)
  // v1 Mule broker: APP_{deploymentId}__defaultPersistentObjectStore
  // v2 graph broker: {deploymentId}-Object-Store (ANYPOINT_APP_ID-Object-Store)
  const storeIdPrefixFull = `APP_${deploymentId}__defaultPersistentObjectStore`;
  const storeIdPrefixShort = `APP_${deploymentId}_`;
  const storeIdV2 = `${deploymentId}-Object-Store`;
  const retentionCacheKey = deploymentStoreKey(orgId, envId, deploymentId);
  const has403Errors = new Set<string>(); // Track 403 errors per region for parallel execution

  // Use the deployment-derived or explicitly configured region as the fast
  // path. If neither is available, ask Object Store for the organization's
  // current regions instead of guessing from a hardcoded list.
  const preferred =
    preferredRegion && isObjectStoreRegion(preferredRegion)
      ? preferredRegion
      : process.env.OBJECT_STORE_REGION && isObjectStoreRegion(process.env.OBJECT_STORE_REGION)
        ? process.env.OBJECT_STORE_REGION
        : null;
  
  if (preferred) {
    debugLog(`[ObjectStore] Using preferred region from translation table: ${preferred}`);
  } else {
    debugLog(`[ObjectStore] WARNING: No preferred region determined. preferredRegion=${preferredRegion ?? "undefined"}, OBJECT_STORE_REGION=${process.env.OBJECT_STORE_REGION ?? "undefined"}`);
  }
  
  const discoveredRegions = preferred
    ? []
    : await discoverObjectStoreRegions(orgId, accessToken);
  const regionsToTry: ObjectStoreRegion[] = preferred
    ? [preferred]
    : discoveredRegions.length > 0
      ? discoveredRegions
      : DEFAULT_OBJECT_STORE_FALLBACK_REGIONS;
  
  if (!preferred) {
    debugLog(
      `[ObjectStore] Using ${
        discoveredRegions.length > 0 ? "discovered" : "static fallback"
      } regions: ${regionsToTry.join(", ")}`
    );
  }

  // Regions are searched in parallel and the first hit wins. Note that
  // `beginsWith=APP_{id}_` already returns `APP_{id}__defaultPersistentObjectStore`,
  // so probing the longer v1 name was a second full pass over every region for
  // results the first pass already had — only the v1 and v2 shapes are distinct.
  const searchRegionsForPrefix = async (
    prefix: string
  ): Promise<{ storeId: string; region: ObjectStoreRegion } | null> => {
    const regionPromises = regionsToTry.map(async (region): Promise<{ storeId: string; region: ObjectStoreRegion } | null> => {
      try {
        const baseUrl = `https://object-store-${region}.anypoint.mulesoft.com`;
        const url = `${baseUrl}/api/v1/organizations/${orgId}/environments/${envId}/stores?beginsWith=${encodeURIComponent(prefix)}`;

        const res = await loggedFetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

        if (res.status === 403) {
          debugError(`[ObjectStore] 403 Forbidden accessing Object Store in region ${region} - check permissions`);
          debugLog(`[ObjectStore] 403 response details - orgId: ${orgId}, envId: ${envId}, deploymentId: ${deploymentId}, region: ${region}`);
          has403Errors.add(region);
          return null;
        }

        if (res.ok) {
          const data = (await res.json()) as ObjectStoreStoresResponse;
          // v2: exact store name match
          if (prefix === storeIdV2) {
            const v2Store = data.values?.find((s: { storeId: string }) => s.storeId === storeIdV2);
            if (v2Store) {
              debugLog(`[ObjectStore] Found v2 store in region ${region}: ${v2Store.storeId}`);
              rememberStoreRetention(retentionCacheKey, v2Store);
              return { storeId: v2Store.storeId, region };
            }
          }
          // v1: look for defaultPersistentObjectStore
          const store = data.values?.find((s: { storeId: string }) =>
            s.storeId === storeIdPrefixFull || s.storeId.includes("__defaultPersistentObjectStore")
          );
          if (store) {
            debugLog(`[ObjectStore] Found store in region ${region} using prefix ${prefix}: ${store.storeId}`);
            rememberStoreRetention(retentionCacheKey, store);
            return { storeId: store.storeId, region };
          } else {
            // Log available stores for debugging
            if (data.values && data.values.length > 0) {
              debugLog(`[ObjectStore] Region ${region} has ${data.values.length} stores with prefix ${prefix}, but none match defaultPersistentObjectStore. Available stores: ${data.values.map((s: { storeId: string }) => s.storeId).join(", ")}`);
            } else {
              debugLog(`[ObjectStore] Region ${region} returned no stores with prefix ${prefix}`);
            }
          }
        } else {
          debugLog(`[ObjectStore] Region ${region} returned status ${res.status} for prefix ${prefix}`);
        }
      } catch (error) {
        debugLog(`[ObjectStore] Region ${region} failed for prefix ${prefix}:`, error);
      }
      return null;
    });

    // Resolve on the first region that actually *matches*, not the first that
    // merely responds. `Promise.race` returned whichever region answered first,
    // which is normally a fast empty one, and the fallthrough then waited on
    // `allSettled` — so every lookup paid the slowest region's latency even
    // though a nearby region already had the store.
    return firstNonNull(regionPromises);
  };

  // Both shapes are probed together rather than in sequence. v1 keeps the
  // priority the sequential version gave it, for the odd case where a
  // deployment has stores of both shapes.
  const [v1Store, v2Store] = await Promise.all([
    searchRegionsForPrefix(storeIdPrefixShort),
    searchRegionsForPrefix(storeIdV2),
  ]);
  const resolvedStore = v1Store ?? v2Store;
  if (resolvedStore) {
    return resolvedStore;
  }

  // If we got 403 errors in all regions, throw a specific error
  if (has403Errors.size > 0 && has403Errors.size === regionsToTry.length) {
    debugError(`[ObjectStore] All regions returned 403 Forbidden - insufficient permissions to access Object Store`);
    debugLog(`[ObjectStore] 403 error summary - orgId: ${orgId}, envId: ${envId}, deploymentId: ${deploymentId}, tried regions: ${regionsToTry.join(", ")}`);
    throw new Error("403 Forbidden: Insufficient permissions to access Object Store");
  }

  // If no store found by deploymentId, list ALL stores and match by broker partition.
  // Definitive resolution: when taskId is provided, return the store that actually contains the task key
  // (multiple apps can have the same broker partition names; only one has this task).
  if (brokerName && brokerName.trim().length > 0) {
    const fallbackPromises = regionsToTry.map(async (region): Promise<{ storeId: string; region: ObjectStoreRegion } | null> => {
      try {
        const baseUrl = `https://object-store-${region}.anypoint.mulesoft.com`;
        const url = `${baseUrl}/api/v1/organizations/${orgId}/environments/${envId}/stores`;
        const res = await loggedFetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as ObjectStoreStoresResponse;
        const matchingStores = (data.values || []).filter((s: { storeId: string }) =>
          s.storeId.includes("__defaultPersistentObjectStore") || s.storeId.endsWith("-Object-Store")
        );
        if (matchingStores.length === 0) return null;
        debugLog(`[ObjectStore] No store for deploymentId ${deploymentId}; trying ${matchingStores.length} stores in ${region} by broker partition "${brokerName}" (resolve by task key: ${taskId ? "yes" : "no"})...`);
        for (const store of matchingStores) {
          try {
            const partitions = await findPartitionsForBroker(orgId, envId, store.storeId, brokerName, accessToken, region);
            const partitionCandidates = partitions.taskPartitionCandidates;
            if (partitionCandidates.length === 0) continue;
            for (const partitionToCheck of partitionCandidates) {
              if (taskId) {
                const keyWithTaskId = await findTaskKey(orgId, envId, store.storeId, partitionToCheck, taskId, accessToken, region);
                if (!keyWithTaskId) {
                  debugLog(`[ObjectStore] Store ${store.storeId} partition ${partitionToCheck} has no key for taskId ${taskId}, trying next`);
                  continue;
                }
                debugLog(`[ObjectStore] Found definitive store by task key in region ${region}: ${store.storeId} (${partitionToCheck})`);
                return { storeId: store.storeId, region };
              }
              debugLog(`[ObjectStore] Found store by broker partition in region ${region}: ${store.storeId} (${partitionToCheck})`);
              return { storeId: store.storeId, region };
            }
          } catch (error) {
            debugLog(`[ObjectStore] Partition lookup failed for store ${store.storeId}:`, error);
          }
        }
      } catch (error) {
        debugLog(`[ObjectStore] Error in list-all fallback for region ${region}:`, error);
      }
      return null;
    });

    const fallbackResults = await Promise.allSettled(fallbackPromises);
    for (const result of fallbackResults) {
      if (result.status === "fulfilled" && result.value) {
        return result.value;
      }
    }
    debugLog(`[ObjectStore] No store found with deploymentId ${deploymentId} and no store found by broker partition "${brokerName}"${taskId ? ` (with taskId ${taskId})` : ""}`);
  } else {
    debugLog(`[ObjectStore] No store found with deploymentId ${deploymentId}; brokerName missing, cannot try partition matching`);
  }

  return null;
}

/** Partition candidates for one broker (v1 _tasks and/or v2 *-task-store). */
interface BrokerPartitions {
  /** @deprecated Prefer taskPartitionCandidates */
  tasksPartition: string | null;
  taskPartitionCandidates: string[];
  graphStatePartitionCandidates: string[];
  brokerFormat: ObjectStoreBrokerFormat | "unknown";
  /** Every partition returned by the store (unranked) — for diagnostics. */
  allPartitions: string[];
}

/** Return the raw v2 StorageEntry JSON string from an Object Store value. */
function rawV2StorageString(value: ObjectStoreValue): string | null {
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.binaryValue === "string") {
    try {
      return Buffer.from(value.binaryValue, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Safe debug mode only: when a v2 STRING value decodes to zero strings, log its
 * *shape* (key names only — no customer content) so an unexpected envelope can be
 * diagnosed from the log instead of guessing.
 */
function logEmptyV2ShapeIfNeeded(raw: string, strings: string[], where: string): void {
  if (strings.length > 0) return;
  const shape = describeV2StorageShape(raw);
  debugLog(`[ObjectStore][EMPTY-VALUE-SHAPE] (${where})`, JSON.stringify(shape, null, 2));
}

/**
 * Extract readable strings from a STRING value, trying JSON first and then the
 * v2 Python broker's base64 pickle encoding (its A2A Task is a pickled pydantic
 * object, not JSON).
 */
function decodeV2StringValue(stringValue: string, where: string): string[] {
  const strings = extractStringsFromV2StorageEntry(stringValue);
  if (strings.length > 0) return strings;
  if (looksLikePickle(stringValue)) {
    const fromPickle = extractStringsFromPickledTask(stringValue);
    if (fromPickle.length > 0) {
      debugLog(`[ObjectStore] Decoded ${fromPickle.length} strings from pickled A2A task (${where})`);
      return fromPickle;
    }
  }
  logEmptyV2ShapeIfNeeded(stringValue, strings, where);
  return strings;
}

function decodeObjectStoreStrings(value: ObjectStoreValue, brokerFormat: ObjectStoreBrokerFormat): string[] {
  if (value.valueType === "STRING" && typeof value.stringValue === "string") {
    return decodeV2StringValue(value.stringValue, "STRING");
  }
  if (value.valueType === "BINARY" && typeof value.binaryValue === "string") {
    return extractStringsFromBinary(value.binaryValue);
  }
  // Some stores omit valueType; infer from available fields
  if (typeof value.stringValue === "string") {
    return decodeV2StringValue(value.stringValue, "STRING/inferred");
  }
  if (typeof value.binaryValue === "string") {
    if (brokerFormat === "v2") {
      const decoded = Buffer.from(value.binaryValue, "base64").toString("utf8");
      const strings = extractStringsFromV2StorageEntry(decoded);
      logEmptyV2ShapeIfNeeded(decoded, strings, "BINARY/v2");
      return strings;
    }
    return extractStringsFromBinary(value.binaryValue);
  }
  return [];
}

function partitionBrokerFormat(partition: string): ObjectStoreBrokerFormat | "unknown" {
  if (isV2TaskStorePartition(partition) || isV2GraphStatePartition(partition)) return "v2";
  if (isV1TasksPartition(partition)) return "v1";
  return "unknown";
}

/**
 * Find task partition candidates for a broker.
 * Supports v1 (`_agentBrokerModule_*_tasks`) and v2 (`{agent_id}-task-store`).
 */
async function findPartitionsForBroker(
  orgId: string,
  envId: string,
  storeId: string,
  brokerName: string,
  accessToken: string,
  region: ObjectStoreRegion
): Promise<BrokerPartitions> {
  const baseUrl = `https://object-store-${region}.anypoint.mulesoft.com`;
  const encodedStoreId = encodeURIComponent(storeId);
  const url = `${baseUrl}/api/v1/organizations/${orgId}/environments/${envId}/stores/${encodedStoreId}/partitions`;

  const empty: BrokerPartitions = {
    tasksPartition: null,
    taskPartitionCandidates: [],
    graphStatePartitionCandidates: [],
    brokerFormat: "unknown",
    allPartitions: [],
  };

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (res.status === 403) {
      const errorText = await res.text().catch(() => "");
      let errorJson: { message?: string; error?: string; statusMessage?: string } = {};
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // Not JSON
      }
      const apiErrorMessage = errorJson.message || errorJson.error || errorJson.statusMessage || errorText || "No error details provided";
      const { getOAuthConfig } = await import("@/lib/auth/config");
      const currentScopes = getOAuthConfig().scopes;
      const errorMsg = `Object Store API returned 403 Forbidden when accessing partitions.

API Error: ${apiErrorMessage}

The OAuth token may be missing a required scope for Object Store partition access.

To test different scopes:
1. Set ANYPOINT_SCOPES environment variable with the scope you want to test, e.g.:
   export ANYPOINT_SCOPES="profile read:exchange view:monitoring read:api_configuration read:api_policies manage:store_data read:applications"
2. Update your Connected App in Anypoint Platform to include that scope
3. Sign out and sign back in

Common Object Store scopes to try: manage:store_data, manage:store, read:store
Current scopes being requested: ${currentScopes}`;
      debugError(`[ObjectStore] ${errorMsg}`);
      debugLog(`[ObjectStore] 403 response details - orgId: ${orgId}, envId: ${envId}, storeId: ${storeId}, brokerName: ${brokerName}, region: ${region}`);
      throw new Error(errorMsg);
    }

    if (!res.ok) return empty;

    const data = (await res.json()) as ObjectStorePartitionsResponse;
    const allPartitions = data.values ?? [];

    const v1Tasks = allPartitions.filter(isV1TasksPartition);
    const v2Tasks = rankV2TaskPartitions(allPartitions, brokerName);
    const v2Graph = rankV2GraphStatePartitions(allPartitions, brokerName);

    const taskPartitionCandidates = [...v2Tasks, ...v1Tasks];
    const primary = taskPartitionCandidates[0] ?? null;
    const brokerFormat: ObjectStoreBrokerFormat | "unknown" =
      v2Tasks.length > 0 ? "v2" : v1Tasks.length > 0 ? "v1" : "unknown";

    if (primary) {
      debugLog(`[ObjectStore] Found task partition candidates (${brokerFormat}): ${taskPartitionCandidates.join(", ")}`);
    } else {
      debugLog(`[ObjectStore] No v1 _tasks or v2 *-task-store partitions found`);
      debugLog(`[ObjectStore] Available partitions: ${allPartitions.join(", ")}`);
    }

    return {
      tasksPartition: primary,
      taskPartitionCandidates,
      graphStatePartitionCandidates: v2Graph,
      brokerFormat,
      allPartitions,
    };
  } catch (error) {
    debugError("[ObjectStore] Error finding partitions:", error);
    throw error;
  }
}

/**
 * Get value from Object Store by partition and key
 */
async function getPartitionValue(
  orgId: string,
  envId: string,
  storeId: string,
  partitionId: string,
  key: string,
  accessToken: string,
  region: ObjectStoreRegion
): Promise<ObjectStoreValue | null> {
  const baseUrl = `https://object-store-${region}.anypoint.mulesoft.com`;
  const encodedStoreId = encodeURIComponent(storeId);
  const encodedPartition = encodeURIComponent(partitionId);
  const encodedKey = encodeURIComponent(key);
  const url = `${baseUrl}/api/v1/organizations/${orgId}/environments/${envId}/stores/${encodedStoreId}/partitions/${encodedPartition}/keys/${encodedKey}`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (res.status === 403) {
      debugError(`[ObjectStore] 403 Forbidden accessing key ${key} - check permissions`);
      throw new Error("403 Forbidden: Insufficient permissions to access Object Store task value");
    }

    if (res.ok) return (await res.json()) as ObjectStoreValue;
    if (res.status === 404) {
      debugLog(`[ObjectStore] Key not found: ${key}`);
      return null;
    }
    debugLog(`[ObjectStore] Error fetching value: ${res.status}`);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("403")) throw error;
    debugError("[ObjectStore] Error fetching partition value:", error);
    return null;
  }
}

/**
 * Resolve the Object Store key for a task.
 * v2 uses bare taskId; v1 keys often embed taskId as `[broker]-{taskId}`.
 */
async function findTaskKey(
  orgId: string,
  envId: string,
  storeId: string,
  partitionId: string,
  taskId: string,
  accessToken: string,
  region: ObjectStoreRegion
): Promise<{ keyId: string; value: ObjectStoreValue | null } | null> {
  // v2: exact key match first (cheaper than listing all keys). The value is
  // returned alongside the key because it is already in hand — callers used to
  // re-request it, doubling a round trip on the largest payload in the request.
  const exact = await getPartitionValue(orgId, envId, storeId, partitionId, taskId, accessToken, region);
  if (exact) return { keyId: taskId, value: exact };

  const scanned = await findKeyContainingTaskId(orgId, envId, storeId, partitionId, taskId, accessToken, region);
  return scanned != null ? { keyId: scanned, value: null } : null;
}

/** List keys in a partition and return the key that contains taskId if any (v1). */
async function findKeyContainingTaskId(
  orgId: string,
  envId: string,
  storeId: string,
  partitionId: string,
  taskId: string,
  accessToken: string,
  region: ObjectStoreRegion
): Promise<string | null> {
  const baseUrl = `https://object-store-${region}.anypoint.mulesoft.com`;
  const encodedStoreId = encodeURIComponent(storeId);
  const encodedPartition = encodeURIComponent(partitionId);
  const keysUrl = `${baseUrl}/api/v1/organizations/${orgId}/environments/${envId}/stores/${encodedStoreId}/partitions/${encodedPartition}/keys`;

  const keysRes = await loggedFetch(keysUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!keysRes.ok) return null;
  const keysData = (await keysRes.json()) as ObjectStoreKeysResponse;
  const match = keysData.values?.find((k: { keyId: string }) => k.keyId.includes(taskId));
  return match ? match.keyId : null;
}

/** Result of fetching from one partition. */
type PartitionFetchResult = {
  value: ObjectStoreValue | null;
  keyUsed: string | null;
  partitionId: string;
  brokerFormat: ObjectStoreBrokerFormat | "unknown";
};

/**
 * Fetch value from a task partition.
 * Tries exact taskId key (v2) then scans for embedded taskId (v1).
 */
async function fetchValueFromPartition(
  orgId: string,
  envId: string,
  storeId: string,
  partitionId: string,
  taskId: string,
  brokerName: string,
  accessToken: string,
  region: ObjectStoreRegion,
  brokerFormat: ObjectStoreBrokerFormat | "unknown"
): Promise<PartitionFetchResult> {
  debugLog(`[ObjectStore] Searching for taskId ${taskId} in partition "${partitionId}" (${brokerFormat})`);

  const found = await findTaskKey(orgId, envId, storeId, partitionId, taskId, accessToken, region);
  if (found) {
    const value =
      found.value ??
      (await getPartitionValue(orgId, envId, storeId, partitionId, found.keyId, accessToken, region));
    if (value) {
      debugLog(`[ObjectStore] Found value in partition "${partitionId}" with key: ${found.keyId}`);
      const resolvedFormat = brokerFormat === "unknown" ? partitionBrokerFormat(partitionId) : brokerFormat;
      return { value, keyUsed: found.keyId, partitionId, brokerFormat: resolvedFormat };
    }
  }

  debugLog(`[ObjectStore] No key for taskId ${taskId} in partition "${partitionId}"`);
  return {
    value: null,
    keyUsed: null,
    partitionId,
    brokerFormat: brokerFormat === "unknown" ? partitionBrokerFormat(partitionId) : brokerFormat,
  };
}

/**
 * Fetch Object Store data for a task
 */
export async function fetchObjectStoreData(
  orgId: string,
  envId: string,
  taskId: string,
  brokerName: string,
  deploymentId: string | null,
  accessToken: string,
  deploymentType?: string,
  objectStoreRegion?: string,
  timer?: PhaseTimer
): Promise<{
  available: boolean;
  /** Status for API status table: ok, 403_forbidden, no_store, no_keys */
  objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
  /** Which partitions contributed data (for UI: "Tasks", "Conversations") */
  sourcesUsed?: ("tasks" | "conversations")[];
  /** Parsed reasoning from _tasks partition only (for split UI) */
  fromTasks?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[]; allRawStrings?: string[] };
  /** Parsed reasoning from _conversations partition only (for split UI) */
  fromConversations?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
  /** Merged reasoning from both (backward compat) */
  llmReasoning?: {
    steps?: Array<{ step: string; content: string[] }>;
    rawReasoning?: string[];
    allRawStrings?: string[];
  };
  /** Structured A2A task story (v2): ordered turns, artifacts, terminal state. */
  taskStory?: TaskStory;
  toolCallIds?: string[];
  downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
  errors?: string[];
  /** Debug: partition names and per-partition valueFound + stringCount (for UI “are both empty?”) */
  debug?: {
    tasks: {
      partition: string | null;
      keyFound: boolean;
      keyUsed: string | null;
      valueEmpty: boolean;
      stringCount: number;
      brokerFormat?: ObjectStoreBrokerFormat;
      valueType?: ObjectStoreValue["valueType"] | null;
    };
  };
}> {
  const errors: string[] = [];

  // Safe debug mode only: emit a self-contained, greppable block with every input
  // needed to reproduce this lookup (and a ready-to-run probe URL) plus the bearer
  // token. Gated by ENABLE_API_LOGGING (context) and DEBUG_INCLUDE_TOKENS (token);
  // production never logs. Supports diagnosing cross-org "no keys" from the log alone.
  const probeQuery = new URLSearchParams({
    orgId,
    envId,
    taskId,
    ...(deploymentId ? { deploymentId } : {}),
    ...(brokerName ? { brokerName } : {}),
    ...(deploymentType ? { deploymentType } : {}),
    ...(objectStoreRegion ? { region: objectStoreRegion } : {}),
  }).toString();
  debugLog(
    "[ObjectStore][PROBE-CONTEXT]",
    JSON.stringify(
      {
        orgId,
        envId,
        deploymentId: deploymentId ?? null,
        taskId,
        brokerName: brokerName || null,
        deploymentType: deploymentType ?? null,
        preferredRegion: objectStoreRegion ?? null,
        probeUrl: `/api/auth/debug/object-store-probe?${probeQuery}`,
      },
      null,
      2
    )
  );
  debugToken("[ObjectStore][PROBE-CONTEXT]", accessToken);

  // Note: AMC `persistentObjectStore: false` means non-durable (e.g. no long-lived
  // store attachment), but brokers can still write task state to Object Store — we
  // rely on tenant/deployment resolution rather than skipping on that flag.

  // Retention is deliberately NOT judged here. Key expiry is a store-level setting
  // that varies by deployment (observed: 30 days), so callers skip using the TTL the
  // platform reports during store discovery. A hardcoded 24h test used to live here
  // and silently returned "no_keys" for anything older than a day, hiding task state
  // that was still perfectly readable.

  if (!deploymentId) {
    errors.push("Deployment ID not available");
    return { available: false, errors };
  }

  let storeInfo: { storeId: string; region: ObjectStoreRegion } | null = null;
  try {
    debugLog(`[ObjectStore] Starting Object Store lookup - orgId: ${orgId}, envId: ${envId}, deploymentId: ${deploymentId}, taskId: ${taskId}, brokerName: ${brokerName}, deploymentType: ${deploymentType || "unknown"}, preferredRegion: ${objectStoreRegion ?? "(none)"}`);
    timer?.note("osRegionHint", objectStoreRegion ?? "none");
    storeInfo = await measurePhase(timer, "os-find-store", () =>
      findObjectStore(orgId, envId, deploymentId, accessToken, brokerName, deploymentType, objectStoreRegion, taskId)
    );
    timer?.note("osRegionFound", storeInfo?.region ?? "none");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[ObjectStore] Error finding Object Store: ${errorMessage}`);
    errors.push(errorMessage);
    if (errorMessage.includes("403")) {
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
  }

  if (!storeInfo) {
    let errorMessage = `Object Store not found for deployment ${deploymentId}. Tried v1 (APP_${deploymentId}__defaultPersistentObjectStore) and v2 (${deploymentId}-Object-Store).`;
    if (deploymentType === "HY") {
      errorMessage += ` Note: Hybrid (HY) deployments may not have Object Store provisioned.`;
    }
    errors.push(errorMessage);
    return { available: false, objectStoreStatus: "no_store", errors };
  }

  let partitions: BrokerPartitions;
  try {
    debugLog(`[ObjectStore] Looking for task partitions - storeId: ${storeInfo.storeId}, brokerName: ${brokerName}, region: ${storeInfo.region}`);
    partitions = await measurePhase(timer, "os-partitions", () =>
      findPartitionsForBroker(orgId, envId, storeInfo!.storeId, brokerName, accessToken, storeInfo!.region)
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[ObjectStore] Error finding partitions: ${errorMessage}`);
    errors.push(errorMessage);
    if (errorMessage.includes("403")) {
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  if (partitions.taskPartitionCandidates.length === 0) {
    errors.push("No task partition found for this broker (expected v1 *_tasks or v2 *-task-store)");
    debugLog(`[ObjectStore] No task partitions found`);
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  debugLog(`[ObjectStore] Fetching task data — candidates: ${partitions.taskPartitionCandidates.join(", ")}`);

  type ReasoningPart = { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[]; allRawStrings: string[] };
  const toReasoningPart = (strings: string[]): ReasoningPart => {
    const { steps, rawReasoning } = parseLLMReasoning(strings);
    return {
      steps,
      rawReasoning: rawReasoning.length > 0 ? rawReasoning : strings,
      allRawStrings: strings,
    };
  };

  let tasksResult: PartitionFetchResult = {
    value: null,
    keyUsed: null,
    partitionId: partitions.taskPartitionCandidates[0] ?? "",
    brokerFormat: partitions.brokerFormat,
  };

  try {
    await measurePhase(timer, "os-task-value", async () => {
      for (const candidate of partitions.taskPartitionCandidates) {
        const attempt = await fetchValueFromPartition(
          orgId,
          envId,
          storeInfo!.storeId,
          candidate,
          taskId,
          brokerName,
          accessToken,
          storeInfo!.region,
          partitions.brokerFormat
        );
        if (attempt.value) {
          tasksResult = attempt;
          break;
        }
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("403")) {
      errors.push(errorMessage);
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
  }

  const tasksValue = tasksResult.value;
  const resolvedFormat: ObjectStoreBrokerFormat =
    tasksResult.brokerFormat === "v1" || tasksResult.brokerFormat === "v2"
      ? tasksResult.brokerFormat
      : partitions.brokerFormat === "v1" || partitions.brokerFormat === "v2"
        ? partitions.brokerFormat
        : "v1";

  let tasksStrings = tasksValue ? decodeObjectStoreStrings(tasksValue, resolvedFormat) : [];

  // Parse the structured A2A story first (v2): we need its contextId to locate the
  // graph-state entry. The graph-state-store is keyed by `session:<contextId>`
  // (NOT by taskId), so a taskId-only lookup silently misses all per-node
  // reasoning/state — the primary cause of "lost" LLM reasoning in the UI.
  let parsedStory: TaskStory | null = null;
  if (tasksValue && resolvedFormat === "v2") {
    const taskRaw = rawV2StorageString(tasksValue);
    parsedStory = taskRaw ? buildTaskStoryFromStorageEntry(taskRaw).story : null;
    if (!parsedStory && typeof tasksValue.stringValue === "string" && looksLikePickle(tasksValue.stringValue)) {
      parsedStory = parsePickledA2ATask(tasksValue.stringValue);
      if (parsedStory) debugLog(`[ObjectStore] Reconstructed task story from pickled A2A task`);
    }
  }

  // v2: read the graph-state-store for structured per-node reasoning/output. It is
  // keyed by `session:<contextId>`; fall back to taskId for brokers that key by
  // task. Values may be JSON or a base64 Python pickle (StateContainer).
  const graphStateEntries: TaskStoryStateEntry[] = [];
  if (tasksValue && resolvedFormat === "v2" && partitions.graphStatePartitionCandidates.length > 0) {
    // The graph-state entry is keyed `session:<contextId>`, so probing the bare
    // contextId guaranteed an exact-key miss and forced a full key listing to
    // recover. Trying the documented shape first turns that into a direct hit.
    const graphContextId = parsedStory?.contextId;
    const graphLookupIds = [
      ...new Set(
        [
          graphContextId != null && graphContextId.length > 0 ? `session:${graphContextId}` : undefined,
          graphContextId,
          taskId,
        ].filter((v): v is string => typeof v === "string" && v.length > 0)
      ),
    ];
    const graphDone = timer?.start("os-graph-state");
    outer: for (const graphPartition of partitions.graphStatePartitionCandidates) {
      for (const lookupId of graphLookupIds) {
        try {
          const graphAttempt = await fetchValueFromPartition(
            orgId,
            envId,
            storeInfo.storeId,
            graphPartition,
            lookupId,
            brokerName,
            accessToken,
            storeInfo.region,
            "v2"
          );
          if (!graphAttempt.value) continue;

          const graphRaw = rawV2StorageString(graphAttempt.value);
          if (graphRaw) {
            const { stateEntries } = buildTaskStoryFromStorageEntry(graphRaw);
            if (stateEntries.length > 0) timer?.note("graphStateFormat", "json");
            for (const entry of stateEntries) graphStateEntries.push(entry);
          }

          // Graph state is often a pickled StateContainer, not JSON.
          if (graphStateEntries.length === 0 && typeof graphAttempt.value.stringValue === "string" && looksLikePickle(graphAttempt.value.stringValue)) {
            const pickledState = parsePickledGraphState(graphAttempt.value.stringValue);
            if (pickledState.length > 0) {
              timer?.note("graphStateFormat", "pickle");
              debugLog(`[ObjectStore] Reconstructed ${pickledState.length} state entries from pickled graph state (${lookupId})`);
              for (const entry of pickledState) graphStateEntries.push(entry);
            }
          }

          const graphStrings = decodeObjectStoreStrings(graphAttempt.value, "v2");
          if (graphStrings.length > 0 && tasksStrings.length < 3) {
            debugLog(`[ObjectStore] Supplemented with ${graphStrings.length} strings from graph partition ${graphPartition}`);
            tasksStrings = [...new Set([...tasksStrings, ...graphStrings])];
          }
          if (graphStateEntries.length > 0 || graphStrings.length > 0) break outer;
        } catch {
          // optional enrichment — ignore failures
        }
      }
    }
    graphDone?.();
  }

  const partitionDebug = {
    tasks: {
      partition: tasksResult.partitionId || partitions.tasksPartition,
      keyFound: tasksValue !== null,
      keyUsed: tasksResult.keyUsed ?? null,
      valueEmpty: tasksValue !== null && tasksStrings.length === 0,
      stringCount: tasksStrings.length,
      brokerFormat: resolvedFormat,
      valueType: tasksValue?.valueType ?? null,
    },
  };
  const tasksStatus = partitionDebug.tasks.keyFound
    ? (partitionDebug.tasks.valueEmpty ? "key found, value empty" : `${partitionDebug.tasks.stringCount} strings`)
    : "key not found";
  debugLog(`[ObjectStore] Task partition result (${resolvedFormat}): ${partitionDebug.tasks.partition ?? "none"} → ${tasksStatus}`);

  if (!tasksValue) {
    errors.push(`Task value not found in Object Store. No key for taskId "${taskId}" in task partition(s): ${partitions.taskPartitionCandidates.join(", ")}.`);
    return { available: false, objectStoreStatus: "no_keys", errors, debug: partitionDebug };
  }

  // Reconstruct the structured A2A story (v2 only). The task-store envelope
  // carries the ordered history/artifacts/status; graph-state fills per-node state.
  // Built before the empty-string guard so a story can surface even when the flat
  // string extraction is sparse (e.g. an unexpected envelope shape).
  let taskStory: TaskStory | undefined;
  if (resolvedFormat === "v2") {
    if (parsedStory) {
      parsedStory.stateEntries = graphStateEntries;
      taskStory = parsedStory;
    } else if (graphStateEntries.length > 0) {
      taskStory = { history: [], artifacts: [], stateEntries: graphStateEntries };
    }
  }
  const taskStoryHasContent = Boolean(
    taskStory &&
      (taskStory.history.length > 0 ||
        taskStory.artifacts.length > 0 ||
        taskStory.stateEntries.length > 0 ||
        taskStory.statusState ||
        taskStory.statusText)
  );

  if (tasksStrings.length === 0 && !taskStoryHasContent) {
    errors.push("No readable content found in Object Store data");
    return { available: false, objectStoreStatus: "no_keys", errors, debug: partitionDebug };
  }

  const mergedReasoningStrings = [
    ...new Set([
      ...tasksStrings,
      ...graphStateEntries
        .map((entry) => entry.text?.trim())
        .filter((text): text is string => Boolean(text && text.length > 0)),
    ]),
  ];

  const fromTasks = mergedReasoningStrings.length > 0 ? toReasoningPart(mergedReasoningStrings) : undefined;

  const { steps, rawReasoning } = parseLLMReasoning(mergedReasoningStrings);
  const toolCallIds = [...new Set(extractToolCallIds(tasksStrings))];
  const downstreamContextIds = mergeDownstreamContexts(
    extractDownstreamContexts(tasksStrings)
  );

  const hasAnyReasoning = steps.length > 0 || rawReasoning.length > 0 || mergedReasoningStrings.length > 0;

  return {
    available: true,
    objectStoreStatus: "ok",
    sourcesUsed: ["tasks"],
    fromTasks: fromTasks ? { ...fromTasks, allRawStrings: mergedReasoningStrings } : undefined,
    llmReasoning: hasAnyReasoning ? {
      steps: steps.length > 0 ? steps : undefined,
      rawReasoning: rawReasoning.length > 0 ? rawReasoning : mergedReasoningStrings,
      allRawStrings: mergedReasoningStrings,
    } : undefined,
    taskStory,
    toolCallIds: toolCallIds.length > 0 ? toolCallIds : undefined,
    downstreamContextIds: downstreamContextIds.length > 0 ? downstreamContextIds : undefined,
    errors: errors.length > 0 ? errors : undefined,
    debug: partitionDebug,
  };
}

function mergeDownstreamContexts(
  items: Array<{ agent: string; contextId: string; taskId: string }>
): Array<{ agent: string; contextId: string; taskId: string }> {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.agent}:${item.contextId}:${item.taskId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Per-partition key lookup result for the Object Store probe. */
export interface ObjectStoreProbePartition {
  partition: string;
  role: "task" | "graph";
  keyFound: boolean;
  keyUsed: string | null;
  valueType: ObjectStoreValue["valueType"] | null;
  stringCount: number;
  storyReconstructed: boolean;
}

/** Structured diagnostic for why an Object Store lookup did or didn't find keys. */
export interface ObjectStoreProbeResult {
  input: {
    orgId: string;
    envId: string;
    deploymentId: string | null;
    brokerName: string;
    taskId: string;
    deploymentType?: string;
    preferredRegion?: string;
  };
  store: { found: boolean; storeId?: string; region?: ObjectStoreRegion };
  partitions: {
    all: string[];
    taskCandidates: string[];
    graphCandidates: string[];
    brokerFormat: ObjectStoreBrokerFormat | "unknown";
  };
  keyLookups: ObjectStoreProbePartition[];
  status: "ok" | "403_forbidden" | "no_store" | "no_keys" | "error";
  conclusion: string;
  errors: string[];
}

/**
 * **Diagnostic only.** Runs the full Object Store discovery pipeline (store →
 * partitions → key lookup) for a task and returns every intermediate result so
 * we can see exactly where a "found but no keys" outcome originates — especially
 * across organizations, where the session token may resolve a store but not the
 * task's keys. Does not parse reasoning; use `fetchObjectStoreData` for content.
 */
export async function probeObjectStore(params: {
  orgId: string;
  envId: string;
  deploymentId: string | null;
  brokerName: string;
  taskId: string;
  accessToken: string;
  deploymentType?: string;
  objectStoreRegion?: string;
}): Promise<ObjectStoreProbeResult> {
  const { orgId, envId, deploymentId, brokerName, taskId, accessToken, deploymentType, objectStoreRegion } = params;
  const errors: string[] = [];
  const result: ObjectStoreProbeResult = {
    input: { orgId, envId, deploymentId, brokerName, taskId, deploymentType, preferredRegion: objectStoreRegion },
    store: { found: false },
    partitions: { all: [], taskCandidates: [], graphCandidates: [], brokerFormat: "unknown" },
    keyLookups: [],
    status: "error",
    conclusion: "",
    errors,
  };

  if (!deploymentId) {
    result.status = "no_store";
    result.conclusion = "No deploymentId supplied — cannot resolve a store. Provide deploymentId (resolvable from apiInstanceId/envId).";
    errors.push("Deployment ID not available");
    return result;
  }

  let storeInfo: { storeId: string; region: ObjectStoreRegion } | null = null;
  try {
    storeInfo = await findObjectStore(orgId, envId, deploymentId, accessToken, brokerName, deploymentType, objectStoreRegion, taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push(message);
    if (message.includes("403")) {
      result.status = "403_forbidden";
      result.conclusion = "403 from Object Store — the session token lacks store access for this org (check manage:store_data / cross-org access).";
      return result;
    }
  }

  if (!storeInfo) {
    result.status = "no_store";
    result.conclusion = `No Object Store found for deployment ${deploymentId} in org ${orgId}. If this is a different org, confirm the deployment/env belong to it and the token can read that org's stores.`;
    return result;
  }
  result.store = { found: true, storeId: storeInfo.storeId, region: storeInfo.region };

  let partitions: BrokerPartitions;
  try {
    partitions = await findPartitionsForBroker(orgId, envId, storeInfo.storeId, brokerName, accessToken, storeInfo.region);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push(message);
    result.status = message.includes("403") ? "403_forbidden" : "no_keys";
    result.conclusion = message.includes("403")
      ? "403 listing partitions — token lacks partition access for this org."
      : "Failed to list partitions for the store.";
    return result;
  }

  result.partitions = {
    all: partitions.allPartitions,
    taskCandidates: partitions.taskPartitionCandidates,
    graphCandidates: partitions.graphStatePartitionCandidates,
    brokerFormat: partitions.brokerFormat,
  };

  const probePartition = async (partition: string, role: "task" | "graph"): Promise<void> => {
    try {
      const fetched = await fetchValueFromPartition(
        orgId,
        envId,
        storeInfo!.storeId,
        partition,
        taskId,
        brokerName,
        accessToken,
        storeInfo!.region,
        role === "graph" ? "v2" : partitions.brokerFormat
      );
      const raw = fetched.value ? rawV2StorageString(fetched.value) : null;
      const strings = fetched.value ? decodeObjectStoreStrings(fetched.value, fetched.brokerFormat === "v1" ? "v1" : "v2") : [];
      const story = raw ? buildTaskStoryFromStorageEntry(raw) : { story: null, stateEntries: [] };
      result.keyLookups.push({
        partition,
        role,
        keyFound: fetched.value !== null,
        keyUsed: fetched.keyUsed,
        valueType: fetched.value?.valueType ?? null,
        stringCount: strings.length,
        storyReconstructed: Boolean(story.story) || story.stateEntries.length > 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`${partition}: ${message}`);
    }
  };

  for (const partition of partitions.taskPartitionCandidates) await probePartition(partition, "task");
  for (const partition of partitions.graphStatePartitionCandidates) await probePartition(partition, "graph");

  const anyKey = result.keyLookups.some((lookup) => lookup.keyFound);
  if (partitions.taskPartitionCandidates.length === 0) {
    result.status = "no_keys";
    result.conclusion =
      partitions.allPartitions.length === 0
        ? "Store found but it has NO partitions. The broker likely never wrote task state (or wrong store/env)."
        : `Store found with ${partitions.allPartitions.length} partition(s), but none match broker "${brokerName}" (expected v1 *_tasks or v2 *-task-store). Broker name/agent-graph-id mismatch is the likely cause.`;
  } else if (!anyKey) {
    result.status = "no_keys";
    result.conclusion = `Task/graph partitions exist for this broker, but no key matches taskId "${taskId}". Likely the task predates this store's retention window, belongs to a different broker/env, or the taskId is not the Object Store key.`;
  } else {
    result.status = "ok";
    result.conclusion = "Key found — Object Store content is available for this task.";
  }
  return result;
}
