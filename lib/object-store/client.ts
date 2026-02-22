import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";

const OBJECT_STORE_REGIONS = [
  "us-east-1",
  "us-west-2",
  "eu-central-1",
  "eu-west-1",
  "ap-southeast-1",
  "ap-southeast-2",
] as const;

type ObjectStoreRegion = (typeof OBJECT_STORE_REGIONS)[number];

interface ObjectStoreValue {
  binaryValue: string; // Base64-encoded
  keyId: string;
  valueType: "BINARY";
}

interface ObjectStoreStoresResponse {
  values: Array<{
    storeId: string;
    name?: string;
  }>;
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

/**
 * Parse LLM reasoning from extracted strings
 * Looks for STEP patterns and groups content
 */
function parseLLMReasoning(strings: string[]): {
  steps: Array<{ step: string; content: string[] }>;
  rawReasoning: string[];
} {
  const steps: Array<{ step: string; content: string[] }> = [];
  const rawReasoning: string[] = [];
  let currentStep: { step: string; content: string[] } | null = null;

  for (const str of strings) {
    // Check if this is a step header (e.g., "STEP 1:", "ISTEP 1:", "STEP 3: ANALYSIS")
    // Match patterns like:
    // - "STEP 1: TITLE"
    // - "ISTEP 1: TITLE"
    // - "STEP 2: FACTS ORCHESTRATION (PARALLEL EXECUTION)"
    const stepMatch = str.match(/^((?:I)?STEP\s+\d+):\s*(.+)$/i);
    if (stepMatch) {
      // Save previous step if exists
      if (currentStep) {
        steps.push(currentStep);
      }
      // Start new step
      const stepTitle = stepMatch[2]?.trim() || stepMatch[1].trim();
      currentStep = {
        step: `${stepMatch[1].trim()}: ${stepTitle}`,
        content: [],
      };
      rawReasoning.push(str);
    } else if (currentStep) {
      // Add content to current step (unless it's clearly not reasoning content)
      // Skip very short strings or Java class names
      if (str.length >= 10 && !str.match(/^com\.mulesoft|^java\.|^[a-z]+\.[a-z]+\./)) {
        currentStep.content.push(str);
        rawReasoning.push(str);
      }
    } else {
      // Check if this looks like reasoning content (long strings with reasoning keywords)
      // More strict: must be reasonably long and contain reasoning indicators
      const isReasoningContent = 
        str.length > 50 &&
        (
          /(?:^|[\s:])(STEP|ISTEP)\s+\d+/i.test(str) ||
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
        // Exclude Java serialization artifacts
        !str.match(/^com\.mulesoft|^java\.|^[a-z]+\.[a-z]+\.[a-z]+/) &&
        // Exclude UUIDs and short identifiers
        !str.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      
      if (isReasoningContent) {
        rawReasoning.push(str);
        // Try to create a step from this if it contains a step header
        if (!currentStep) {
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

  // Add last step
  if (currentStep) {
    steps.push(currentStep);
  }

  // Only return rawReasoning if we found actual reasoning, not all strings
  return { 
    steps, 
    rawReasoning: rawReasoning.length > 0 ? rawReasoning : [] 
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
  return (OBJECT_STORE_REGIONS as readonly string[]).includes(s);
}

/**
 * CloudHub hostname region codes (e.g. deu-c1 from *.deu-c1.cloudhub.io) to object store region.
 * Anypoint UI uses deployment's internalUrl hostname to pick object-store-{region}.anypoint.mulesoft.com.
 */
const CLOUDHUB_REGION_TO_OBJECT_STORE: Record<string, ObjectStoreRegion> = {
  "deu-c1": "eu-central-1",
  "use-c1": "us-east-1",
  "usw-c1": "us-west-2",
  "euw-c1": "eu-west-1",
  "aps-c1": "ap-southeast-1",
  "aps2-c1": "ap-southeast-2",
};

/** Categories we suggest for Runtime Manager → Monitoring (log forwarding) for full task visibility. */
const MONITORING_CATEGORY_BROKER = "com.mulesoft.modules.agent.broker";
const MONITORING_CATEGORY_INSECURE_LOGGING = "INSECURE-LOGGING";

/**
 * Detect if deployment detail (from AMC GET deployment) includes the recommended log categories.
 * Uses the same deployment JSON we already fetch for region; no extra API call.
 * Returns true for each category if it appears anywhere in the deployment config (e.g. monitoring log levels).
 */
export function getMonitoringLogCategoriesFromDeployment(deployment: Record<string, unknown>): {
  brokerLogger: boolean;
  insecureLogging: boolean;
} {
  try {
    const s = JSON.stringify(deployment);
    return {
      brokerLogger: s.includes(MONITORING_CATEGORY_BROKER),
      insecureLogging: s.includes(MONITORING_CATEGORY_INSECURE_LOGGING),
    };
  } catch {
    return { brokerLogger: false, insecureLogging: false };
  }
}

/**
 * Infer monitoring categories from task log entries. When the deployment API does not include
 * monitoring config in its response, we can still detect "Set" if the task's own logs show
 * these loggers (logger name or class contains the category). Used to merge with deployment-based
 * result so we do not show "Not set" when logs prove the categories are enabled.
 */
export function getMonitoringFromLogEntries(entries: unknown[]): {
  brokerLogger: boolean;
  insecureLogging: boolean;
} {
  let brokerLogger = false;
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
      if (s.includes(MONITORING_CATEGORY_BROKER)) brokerLogger = true;
      if (s.includes(MONITORING_CATEGORY_INSECURE_LOGGING)) insecureLogging = true;
      if (brokerLogger && insecureLogging) break;
    }
  } catch {
    // ignore
  }
  return { brokerLogger, insecureLogging };
}

/**
 * Extract object store region from deployment detail JSON.
 * Deployment contains URLs like target.deploymentSettings.http.inbound.internalUrl
 * with hostnames *.XX-XX.cloudhub.io (e.g. deu-c1 → eu-central-1).
 */
export function getObjectStoreRegionFromDeployment(deployment: {
  target?: {
    deploymentSettings?: {
      http?: {
        inbound?: { internalUrl?: string; endpoints?: Array<{ url?: string }> };
      };
    };
  };
}): ObjectStoreRegion | null {
  const urls: string[] = [];
  const inbound = deployment.target?.deploymentSettings?.http?.inbound;
  if (inbound?.internalUrl) urls.push(inbound.internalUrl);
  inbound?.endpoints?.forEach((e) => e.url && urls.push(e.url));
  for (const u of urls) {
    const match = u.match(/\.([a-z]{3}-[a-z0-9]{2})\.cloudhub\.io/i);
    if (match) {
      const code = match[1].toLowerCase();
      const region = CLOUDHUB_REGION_TO_OBJECT_STORE[code];
      if (region) return region;
      if (isObjectStoreRegion(code)) return code;
    }
  }
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
  // Try two prefix patterns (Anypoint UI uses shorter prefix: APP_{deploymentId}_)
  const storeIdPrefixFull = `APP_${deploymentId}__defaultPersistentObjectStore`;
  const storeIdPrefixShort = `APP_${deploymentId}_`;
  const has403Errors = new Set<string>(); // Track 403 errors per region for parallel execution

  const preferred =
    preferredRegion && isObjectStoreRegion(preferredRegion)
      ? preferredRegion
      : process.env.OBJECT_STORE_REGION && isObjectStoreRegion(process.env.OBJECT_STORE_REGION)
        ? process.env.OBJECT_STORE_REGION
        : null;
  const regionsToTry: ObjectStoreRegion[] = preferred
    ? [preferred, ...OBJECT_STORE_REGIONS.filter((r) => r !== preferred)]
    : [...OBJECT_STORE_REGIONS];

  // Try shorter prefix first (matches Anypoint UI behavior)
  // OPTIMIZATION: Search all regions in parallel, return immediately when first store is found
  // Once a store is found, we return immediately without waiting for other region searches to complete
  for (const prefix of [storeIdPrefixShort, storeIdPrefixFull]) {
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
          // Look for store matching full pattern (defaultPersistentObjectStore)
          const store = data.values?.find((s: { storeId: string }) => 
            s.storeId === storeIdPrefixFull || s.storeId.includes("__defaultPersistentObjectStore")
          );
          if (store) {
            debugLog(`[ObjectStore] Found store in region ${region} using prefix ${prefix}: ${store.storeId}`);
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

    // Return as soon as the first region finds a store (don't wait for all to complete)
    // IMPORTANT: Once a store is found, we return immediately - other region searches are ignored
    // This applies even if the store doesn't have keys (key checking happens later in fetchObjectStoreData)
    // Use Promise.race to get the first completed result, check if it's a match
    const firstResult = await Promise.race(regionPromises);
    if (firstResult) {
      // Found a store in the first completed region - return immediately
      // Other region searches may still be in flight, but we don't wait for them or use their results
      debugLog(`[ObjectStore] Returning early with store found in first completed region - other region searches ignored`);
      return firstResult;
    }

    // First result was null, check remaining results as they complete
    // Use allSettled to get all results, but we've already got one from race
    const remainingResults = await Promise.allSettled(regionPromises);
    for (const result of remainingResults) {
      if (result.status === "fulfilled" && result.value) {
        return result.value;
      }
    }
  }

  // If we got 403 errors in all regions, throw a specific error
  if (has403Errors.size > 0 && has403Errors.size === regionsToTry.length) {
    debugError(`[ObjectStore] All regions returned 403 Forbidden - insufficient permissions to access Object Store`);
    debugLog(`[ObjectStore] 403 error summary - orgId: ${orgId}, envId: ${envId}, deploymentId: ${deploymentId}, tried regions: ${OBJECT_STORE_REGIONS.join(", ")}`);
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
          s.storeId.includes("__defaultPersistentObjectStore")
        );
        if (matchingStores.length === 0) return null;
        debugLog(`[ObjectStore] No store for deploymentId ${deploymentId}; trying ${matchingStores.length} stores in ${region} by broker partition "${brokerName}" (resolve by task key: ${taskId ? "yes" : "no"})...`);
        for (const store of matchingStores) {
          try {
            const partitions = await findPartitionsForBroker(orgId, envId, store.storeId, brokerName, accessToken, region);
            const tasksPartition = partitions.tasksPartition;
            if (!tasksPartition && !partitions.conversationsPartition) continue;
            const partitionToCheck = tasksPartition ?? partitions.conversationsPartition!;
            if (taskId) {
              const keyWithTaskId = await findKeyContainingTaskId(orgId, envId, store.storeId, partitionToCheck, taskId, accessToken, region);
              if (!keyWithTaskId) {
                debugLog(`[ObjectStore] Store ${store.storeId} has broker partitions but no key for taskId ${taskId}, trying next store`);
                continue;
              }
              debugLog(`[ObjectStore] Found definitive store by task key in region ${region}: ${store.storeId}`);
              return { storeId: store.storeId, region };
            }
            debugLog(`[ObjectStore] Found store by broker partition in region ${region}: ${store.storeId}`);
            return { storeId: store.storeId, region };
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

/** Partitions for one broker: _tasks and _conversations (both used for full task/reasoning) */
interface BrokerPartitions {
  tasksPartition: string | null;
  conversationsPartition: string | null;
}

/**
 * Find both _tasks and _conversations partitions for a broker.
 * Agent broker creates two partitions per config; we use both for full task and reasoning.
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

  const result: BrokerPartitions = { tasksPartition: null, conversationsPartition: null };

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

    if (!res.ok) return result;

    const data = (await res.json()) as ObjectStorePartitionsResponse;
    const allPartitions = data.values ?? [];
    const normalizedBrokerName = brokerName.replace(/[^a-zA-Z0-9_]/g, "_");
    const brokerNameNoSpecial = brokerName.replace(/[^a-zA-Z0-9]/g, "_");

    const matchesBroker = (p: string) =>
      p.includes(normalizedBrokerName) ||
      p.includes(brokerNameNoSpecial) ||
      (brokerName.length > 0 && p.includes("_Broker_"));

    result.tasksPartition =
      allPartitions.find((p: string) => p.includes("_tasks") && matchesBroker(p)) ??
      allPartitions.find((p: string) => p.includes("_tasks")) ??
      null;
    result.conversationsPartition =
      allPartitions.find((p: string) => p.includes("_conversations") && matchesBroker(p)) ??
      allPartitions.find((p: string) => p.includes("_conversations")) ??
      null;

    if (result.tasksPartition) debugLog(`[ObjectStore] Found tasks partition: ${result.tasksPartition}`);
    if (result.conversationsPartition) debugLog(`[ObjectStore] Found conversations partition: ${result.conversationsPartition}`);
  } catch (error) {
    debugError("[ObjectStore] Error finding partitions:", error);
    throw error;
  }

  return result;
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
 * List keys in a partition and return the key that contains taskId if any
 */
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

/** Result of fetching from one partition: value (if key found) and which key was used. */
type PartitionFetchResult = { value: ObjectStoreValue | null; keyUsed: string | null };

/**
 * Fetch value from a partition using key variations, then list-keys fallback.
 * For conversations partition: tries contextId key first (runtime often keys by contextId), then taskId.
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
  partitionLabel: string,
  contextId?: string | null
): Promise<PartitionFetchResult> {
  const normalizedBrokerName = brokerName.replace(/[^a-zA-Z0-9_]/g, "_");
  const keyVariations: string[] = [];
  if (partitionLabel === "conversations" && contextId) {
    keyVariations.push(`[${brokerName}]-${contextId}`, `[${normalizedBrokerName}]-${contextId}`);
  }
  keyVariations.push(
    `[${brokerName}]-${taskId}`,
    `[${normalizedBrokerName}]-${taskId}`,
  );
  if (partitionLabel === "conversations") {
    keyVariations.push(taskId);
  }

  for (const key of keyVariations) {
    const value = await getPartitionValue(orgId, envId, storeId, partitionId, key, accessToken, region);
    if (value) {
      debugLog(`[ObjectStore] Found value in ${partitionLabel} with key: ${key}`);
      return { value, keyUsed: key };
    }
  }

  const foundKey = await findKeyContainingTaskId(orgId, envId, storeId, partitionId, taskId, accessToken, region);
  if (foundKey) {
    const value = await getPartitionValue(orgId, envId, storeId, partitionId, foundKey, accessToken, region);
    if (value) {
      debugLog(`[ObjectStore] Found value in ${partitionLabel} via list-keys: ${foundKey}`);
      return { value, keyUsed: foundKey };
    }
  }

  return { value: null, keyUsed: null };
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
  contextId?: string | null
): Promise<{
  available: boolean;
  /** Status for API status table: ok, 403_forbidden, no_store, no_keys */
  objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
  /** Which partitions contributed data (for UI: "Tasks", "Conversations") */
  sourcesUsed?: ("tasks" | "conversations")[];
  /** Parsed reasoning from _tasks partition only (for split UI) */
  fromTasks?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
  /** Parsed reasoning from _conversations partition only (for split UI) */
  fromConversations?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
  /** Merged reasoning from both (backward compat) */
  llmReasoning?: {
    steps?: Array<{ step: string; content: string[] }>;
    rawReasoning?: string[];
  };
  toolCallIds?: string[];
  downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
  errors?: string[];
  /** Debug: partition names and per-partition valueFound + stringCount (for UI “are both empty?”) */
  debug?: {
    tasks: { partition: string | null; keyFound: boolean; keyUsed: string | null; valueEmpty: boolean; stringCount: number };
    conversations: { partition: string | null; keyFound: boolean; keyUsed: string | null; valueEmpty: boolean; stringCount: number };
  };
}> {
  const errors: string[] = [];

  if (!deploymentId) {
    errors.push("Deployment ID not available");
    return { available: false, errors };
  }

  let storeInfo: { storeId: string; region: ObjectStoreRegion } | null = null;
  try {
    debugLog(`[ObjectStore] Starting Object Store lookup - orgId: ${orgId}, envId: ${envId}, deploymentId: ${deploymentId}, taskId: ${taskId}, brokerName: ${brokerName}, deploymentType: ${deploymentType || "unknown"}, preferredRegion: ${objectStoreRegion ?? "(none)"}`);
    storeInfo = await findObjectStore(orgId, envId, deploymentId, accessToken, brokerName, deploymentType, objectStoreRegion, taskId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[ObjectStore] Error finding Object Store: ${errorMessage}`);
    errors.push(errorMessage);
    if (errorMessage.includes("403")) {
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
  }

  if (!storeInfo) {
    let errorMessage = `Object Store not found for deployment ${deploymentId}. Searched regions: ${OBJECT_STORE_REGIONS.join(", ")}. Store pattern: APP_${deploymentId}__defaultPersistentObjectStore`;
    if (deploymentType === "HY") {
      errorMessage += `. Note: Hybrid (HY) deployments may not have Object Store provisioned.`;
    }
    errors.push(errorMessage);
    return { available: false, objectStoreStatus: "no_store", errors };
  }

  let partitions: BrokerPartitions;
  try {
    debugLog(`[ObjectStore] Looking for partitions (tasks + conversations) - storeId: ${storeInfo.storeId}, brokerName: ${brokerName}, region: ${storeInfo.region}`);
    partitions = await findPartitionsForBroker(orgId, envId, storeInfo.storeId, brokerName, accessToken, storeInfo.region);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[ObjectStore] Error finding partitions: ${errorMessage}`);
    errors.push(errorMessage);
    if (errorMessage.includes("403")) {
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  if (!partitions.tasksPartition && !partitions.conversationsPartition) {
    errors.push("No _tasks or _conversations partition found for this broker");
    debugLog(`[ObjectStore] Partitions: tasks=${partitions.tasksPartition ?? "none"}, conversations=${partitions.conversationsPartition ?? "none"}`);
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  const keyVariations = [
    `[${brokerName}]-${taskId}`,
    `[${brokerName.replace(/[^a-zA-Z0-9_]/g, "_")}]-${taskId}`,
  ];
  debugLog(`[ObjectStore] Fetching from both partitions - key variations: ${keyVariations.join(", ")}`);

  type ReasoningPart = { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
  const toReasoningPart = (strings: string[]): ReasoningPart => {
    const { steps, rawReasoning } = parseLLMReasoning(strings);
    return {
      steps,
      rawReasoning: rawReasoning.length > 0 ? rawReasoning : strings,
    };
  };

  let tasksResult: PartitionFetchResult = { value: null, keyUsed: null };
  let conversationsResult: PartitionFetchResult = { value: null, keyUsed: null };

  try {
    if (partitions.tasksPartition) {
      tasksResult = await fetchValueFromPartition(
        orgId, envId, storeInfo!.storeId, partitions.tasksPartition, taskId, brokerName, accessToken, storeInfo!.region, "tasks"
      );
    }
    if (partitions.conversationsPartition) {
      conversationsResult = await fetchValueFromPartition(
        orgId, envId, storeInfo!.storeId, partitions.conversationsPartition, taskId, brokerName, accessToken, storeInfo!.region, "conversations",
        contextId ?? undefined
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("403")) {
      errors.push(errorMessage);
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
  }

  const tasksValue = tasksResult.value;
  const conversationsValue = conversationsResult.value;

  const sourcesUsed: ("tasks" | "conversations")[] = [];
  if (tasksValue) sourcesUsed.push("tasks");
  if (conversationsValue) sourcesUsed.push("conversations");

  const tasksStrings = tasksValue ? extractStringsFromBinary(tasksValue.binaryValue) : [];
  const conversationsStrings = conversationsValue ? extractStringsFromBinary(conversationsValue.binaryValue) : [];

  const partitionDebug = {
    tasks: {
      partition: partitions.tasksPartition ?? null,
      keyFound: tasksValue !== null,
      keyUsed: tasksResult.keyUsed ?? null,
      valueEmpty: tasksValue !== null && tasksStrings.length === 0,
      stringCount: tasksStrings.length,
    },
    conversations: {
      partition: partitions.conversationsPartition ?? null,
      keyFound: conversationsValue !== null,
      keyUsed: conversationsResult.keyUsed ?? null,
      valueEmpty: conversationsValue !== null && conversationsStrings.length === 0,
      stringCount: conversationsStrings.length,
    },
  };
  const tasksStatus = partitionDebug.tasks.keyFound
    ? (partitionDebug.tasks.valueEmpty ? "key found, value empty" : `${partitionDebug.tasks.stringCount} strings`)
    : "key not found";
  const convStatus = partitionDebug.conversations.keyFound
    ? (partitionDebug.conversations.valueEmpty ? "key found, value empty" : `${partitionDebug.conversations.stringCount} strings`)
    : "key not found";
  debugLog(`[ObjectStore] Partitions result: tasks ${partitionDebug.tasks.partition ?? "none"} → ${tasksStatus}; conversations ${partitionDebug.conversations.partition ?? "none"} → ${convStatus}`);

  if (sourcesUsed.length === 0) {
    errors.push(`Task value not found in Object Store. Tried keys: ${keyVariations.join(", ")} (and taskId for conversations) in _tasks and _conversations partitions.`);
    return { available: false, objectStoreStatus: "no_keys", errors, debug: partitionDebug };
  }

  const fromTasks = tasksStrings.length > 0 ? toReasoningPart(tasksStrings) : undefined;
  const fromConversations =
    conversationsStrings.length > 0 ? toReasoningPart(conversationsStrings) : undefined;

  const allStrings = [...tasksStrings, ...conversationsStrings];
  if (allStrings.length === 0) {
    errors.push("No readable strings found in Object Store data");
    return { available: false, objectStoreStatus: "no_keys", errors, debug: partitionDebug };
  }

  const { steps, rawReasoning } = parseLLMReasoning(allStrings);
  const toolCallIds = [...new Set(extractToolCallIds(allStrings))];
  const downstreamContextIds = mergeDownstreamContexts(
    extractDownstreamContexts(allStrings)
  );

  const hasAnyReasoning = steps.length > 0 || rawReasoning.length > 0;

  return {
    available: true,
    objectStoreStatus: "ok",
    sourcesUsed: sourcesUsed.length > 0 ? sourcesUsed : undefined,
    fromTasks: fromTasks ?? undefined,
    fromConversations: fromConversations ?? undefined,
    llmReasoning: hasAnyReasoning ? {
      steps: steps.length > 0 ? steps : undefined,
      rawReasoning: rawReasoning.length > 0 ? rawReasoning : undefined,
    } : undefined,
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
