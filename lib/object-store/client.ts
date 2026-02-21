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
 */
async function findObjectStore(
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  brokerName: string,
  deploymentType?: string,
  preferredRegion?: string
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

  // If no store found by deploymentId, try listing ALL stores and match by broker partition.
  // Deployment ID from Runtime Manager/AMC can differ from the store's APP_* id (e.g. Runtime Fabric vs CloudHub),
  // so we match by broker partition to find the correct store and then report "no keys" when appropriate.
  // OPTIMIZATION: Search all regions in parallel instead of sequentially
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
        debugLog(`[ObjectStore] No store for deploymentId ${deploymentId}; trying ${matchingStores.length} stores in ${region} by broker partition "${brokerName}"...`);
        // Check partitions sequentially within a region (they're specific to the store)
        for (const store of matchingStores) {
          try {
            const partitionId = await findPartition(orgId, envId, store.storeId, brokerName, accessToken, region);
            if (partitionId) {
              debugLog(`[ObjectStore] Found store by broker partition in region ${region}: ${store.storeId}`);
              return { storeId: store.storeId, region };
            }
          } catch (error) {
            // Continue to next store if partition lookup fails
            debugLog(`[ObjectStore] Partition lookup failed for store ${store.storeId}:`, error);
          }
        }
      } catch (error) {
        debugLog(`[ObjectStore] Error in list-all fallback for region ${region}:`, error);
      }
      return null;
    });

    // Wait for all fallback searches to complete, return first match found
    const fallbackResults = await Promise.allSettled(fallbackPromises);
    for (const result of fallbackResults) {
      if (result.status === "fulfilled" && result.value) {
        return result.value;
      }
    }
    debugLog(`[ObjectStore] No store found with deploymentId ${deploymentId} and no store found by broker partition "${brokerName}"`);
  } else {
    debugLog(`[ObjectStore] No store found with deploymentId ${deploymentId}; brokerName missing, cannot try partition matching`);
  }

  return null;
}

/**
 * Find partition for a broker/config name
 */
async function findPartition(
  orgId: string,
  envId: string,
  storeId: string,
  brokerName: string,
  accessToken: string,
  region: ObjectStoreRegion
): Promise<string | null> {
  const baseUrl = `https://object-store-${region}.anypoint.mulesoft.com`;
  const encodedStoreId = encodeURIComponent(storeId);
  const url = `${baseUrl}/api/v1/organizations/${orgId}/environments/${envId}/stores/${encodedStoreId}/partitions`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (res.status === 403) {
      // Capture full error response - API might tell us what scope is needed
      const errorText = await res.text().catch(() => "");
      let errorJson: { message?: string; error?: string; statusMessage?: string } = {};
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // Not JSON, use raw text
      }
      
      const apiErrorMessage = errorJson.message || errorJson.error || errorJson.statusMessage || errorText || "No error details provided";
      const { getOAuthConfig } = await import("@/lib/auth/config");
      const currentScopes = getOAuthConfig().scopes;
      
      const errorMsg = `Object Store API returned 403 Forbidden when accessing partitions.

API Error: ${apiErrorMessage}

The OAuth token may be missing a required scope for Object Store partition access. We're currently requesting 'manage:store_data', but if this error persists, the API might require a different scope or additional permissions.

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

    if (res.ok) {
      const data = (await res.json()) as ObjectStorePartitionsResponse;
      // Partition format: _agentBrokerModule_{configName}_tasks
      // Broker name might have underscores replaced, so try multiple variations
      const normalizedBrokerName = brokerName.replace(/[^a-zA-Z0-9_]/g, "_");
      const expectedPartition = `_agentBrokerModule_${normalizedBrokerName}_tasks`;
      
      // Try exact match first
      let partition = data.values?.find(
        (p: string) => p === expectedPartition
      );
      
      // Try partial match (broker name might be embedded)
      if (!partition) {
        partition = data.values?.find(
          (p: string) => 
            p.includes(normalizedBrokerName) || 
            p.includes(brokerName.replace(/[^a-zA-Z0-9]/g, ""))
        );
      }
      
      if (partition) {
        debugLog(`[ObjectStore] Found partition: ${partition}`);
        return partition;
      }
      
      // If exact match not found, return first partition that looks like a task partition (fallback)
      const taskPartition = data.values?.find(
        (p: string) => p.includes("_tasks")
      );
      if (taskPartition) {
        debugLog(`[ObjectStore] Using fallback partition: ${taskPartition}`);
        return taskPartition;
      }
      
      // Last resort: return first partition
      if (data.values && data.values.length > 0) {
        debugLog(`[ObjectStore] Using first available partition: ${data.values[0]}`);
        return data.values[0];
      }
    }
  } catch (error) {
    debugError("[ObjectStore] Error finding partition:", error);
  }

  return null;
}

/**
 * Get task value from Object Store
 */
async function getTaskValue(
  orgId: string,
  envId: string,
  storeId: string,
  partitionId: string,
  taskKey: string,
  accessToken: string,
  region: ObjectStoreRegion
): Promise<ObjectStoreValue | null> {
  const baseUrl = `https://object-store-${region}.anypoint.mulesoft.com`;
  const encodedStoreId = encodeURIComponent(storeId);
  const encodedPartition = encodeURIComponent(partitionId);
  const encodedKey = encodeURIComponent(taskKey);
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
      debugError(`[ObjectStore] 403 Forbidden accessing task key ${taskKey} - check permissions`);
      debugLog(`[ObjectStore] 403 response details - orgId: ${orgId}, envId: ${envId}, storeId: ${storeId}, partitionId: ${partitionId}, taskKey: ${taskKey}, region: ${region}`);
      throw new Error("403 Forbidden: Insufficient permissions to access Object Store task value");
    }

    if (res.ok) {
      return (await res.json()) as ObjectStoreValue;
    } else if (res.status === 404) {
      debugLog(`[ObjectStore] Task key not found: ${taskKey}`);
      return null;
    } else {
      debugLog(`[ObjectStore] Error fetching task value: ${res.status}`);
      return null;
    }
  } catch (error) {
    // Re-throw 403 errors
    if (error instanceof Error && error.message.includes("403")) {
      throw error;
    }
    debugError("[ObjectStore] Error fetching task value:", error);
    return null;
  }
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
  objectStoreRegion?: string
): Promise<{
  available: boolean;
  /** Status for API status table: ok, 403_forbidden, no_store, no_keys */
  objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
  llmReasoning?: {
    steps?: Array<{ step: string; content: string[] }>;
    rawReasoning?: string[];
  };
  toolCallIds?: string[];
  downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
  errors?: string[];
}> {
  const errors: string[] = [];

  // Need deployment ID to find store
  if (!deploymentId) {
    errors.push("Deployment ID not available");
    return { available: false, errors };
  }

  // Find Object Store
  let storeInfo: { storeId: string; region: ObjectStoreRegion } | null = null;
  try {
    debugLog(`[ObjectStore] Starting Object Store lookup - orgId: ${orgId}, envId: ${envId}, deploymentId: ${deploymentId}, taskId: ${taskId}, brokerName: ${brokerName}, deploymentType: ${deploymentType || "unknown"}, preferredRegion: ${objectStoreRegion ?? "(none)"}`);
    storeInfo = await findObjectStore(orgId, envId, deploymentId, accessToken, brokerName, deploymentType, objectStoreRegion);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[ObjectStore] Error finding Object Store: ${errorMessage}`);
    errors.push(errorMessage);
    if (errorMessage.includes("403")) {
      debugError(`[ObjectStore] 403 error detected during store lookup - returning early`);
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
  }
  
  if (!storeInfo) {
    let errorMessage = `Object Store not found for deployment ${deploymentId}. Searched regions: ${OBJECT_STORE_REGIONS.join(", ")}. Store pattern: APP_${deploymentId}__defaultPersistentObjectStore`;
    if (deploymentType === "HY") {
      errorMessage += `. Note: Hybrid (HY) deployments may not have Object Store provisioned. Object Store is typically available for CloudHub deployments.`;
    }
    errors.push(errorMessage);
    debugError(`[ObjectStore] Could not find Object Store - deploymentId: ${deploymentId}, deploymentType: ${deploymentType || "unknown"}, searched regions: ${OBJECT_STORE_REGIONS.join(", ")}`);
    return { available: false, objectStoreStatus: "no_store", errors };
  }

  // Find partition
  let partitionId: string | null = null;
  try {
    debugLog(`[ObjectStore] Looking for partition - storeId: ${storeInfo.storeId}, brokerName: ${brokerName}, region: ${storeInfo.region}`);
    partitionId = await findPartition(orgId, envId, storeInfo.storeId, brokerName, accessToken, storeInfo.region);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[ObjectStore] Error finding partition: ${errorMessage}`);
    errors.push(errorMessage);
    if (errorMessage.includes("403")) {
      debugError(`[ObjectStore] 403 error detected during partition lookup - returning early`);
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
  }
  
  if (!partitionId) {
    errors.push("Partition not found");
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  // Construct task key: [configName]-{taskId}
  // Try multiple variations since broker name might have special characters preserved
  // The config name in the key should match what's in the partition
  const normalizedBrokerName = brokerName.replace(/[^a-zA-Z0-9_]/g, "_");
  const taskKeyVariations = [
    `[${brokerName}]-${taskId}`, // Try original broker name first (preserves emojis/special chars)
    `[${normalizedBrokerName}]-${taskId}`, // Try normalized version
  ];
  
  debugLog(`[ObjectStore] Looking for task key - trying variations: ${taskKeyVariations.join(", ")}`);

  // Get task value - try each variation
  let taskValue: ObjectStoreValue | null = null;
  let foundTaskKey: string | null = null;
  
  for (const taskKey of taskKeyVariations) {
    try {
      debugLog(`[ObjectStore] Trying task key: ${taskKey}`);
      taskValue = await getTaskValue(
        orgId,
        envId,
        storeInfo.storeId,
        partitionId,
        taskKey,
        accessToken,
        storeInfo.region
      );
      if (taskValue) {
        foundTaskKey = taskKey;
        debugLog(`[ObjectStore] Found task value with key: ${taskKey}`);
        break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      if (errorMessage.includes("403")) {
        debugError(`[ObjectStore] 403 error detected during task value fetch - returning early`);
        errors.push(errorMessage);
        return { available: false, objectStoreStatus: "403_forbidden", errors };
      }
      // Continue to next variation
      debugLog(`[ObjectStore] Task key ${taskKey} not found, trying next variation...`);
    }
  }
  
  // If still not found, try listing all keys and finding the one containing taskId
  if (!taskValue) {
    try {
      debugLog(`[ObjectStore] Task key not found with variations, listing all keys to find taskId: ${taskId}`);
      const baseUrl = `https://object-store-${storeInfo.region}.anypoint.mulesoft.com`;
      const encodedStoreId = encodeURIComponent(storeInfo.storeId);
      const encodedPartition = encodeURIComponent(partitionId);
      const keysUrl = `${baseUrl}/api/v1/organizations/${orgId}/environments/${envId}/stores/${encodedStoreId}/partitions/${encodedPartition}/keys`;
      
      const keysRes = await loggedFetch(keysUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      
      if (keysRes.ok) {
        const keysData = (await keysRes.json()) as ObjectStoreKeysResponse;
        const matchingKey = keysData.values?.find(
          (k: { keyId: string }) => k.keyId.includes(taskId)
        );
        
        if (matchingKey) {
          foundTaskKey = matchingKey.keyId;
          debugLog(`[ObjectStore] Found matching key by listing: ${foundTaskKey}`);
          taskValue = await getTaskValue(
            orgId,
            envId,
            storeInfo.storeId,
            partitionId,
            foundTaskKey,
            accessToken,
            storeInfo.region
          );
        } else {
          debugLog(`[ObjectStore] No key found containing taskId: ${taskId}`);
        }
      }
    } catch (error) {
      debugLog(`[ObjectStore] Error listing keys:`, error);
    }
  }

  if (!taskValue) {
    errors.push(`Task value not found in Object Store. Tried keys: ${taskKeyVariations.join(", ")}`);
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  // Extract strings from binary data
  const strings = extractStringsFromBinary(taskValue.binaryValue);
  if (strings.length === 0) {
    errors.push("No readable strings found in Object Store data");
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  // Parse LLM reasoning
  const { steps, rawReasoning } = parseLLMReasoning(strings);

  // Extract additional data
  const toolCallIds = extractToolCallIds(strings);
  const downstreamContextIds = extractDownstreamContexts(strings);

  // Only include llmReasoning if we actually found reasoning content
  // Reasoning is considered valid if:
  // 1. We have structured steps, OR
  // 2. We have rawReasoning that contains actual reasoning patterns (not just random strings)
  const hasStructuredSteps = steps.length > 0;
  const hasValidRawReasoning = rawReasoning.length > 0 && 
    rawReasoning.some((str: string) => 
      /(STEP\s+\d+|ISTEP\s+\d+)/i.test(str) ||
      (str.length > 100 && (
        str.includes("Analysis") ||
        str.includes("Decision") ||
        str.includes("Per rules") ||
        str.includes("NoDispute") ||
        str.includes("DisputeFound") ||
        str.includes("reasoning") ||
        str.includes("determined") ||
        str.includes("decided")
      ))
    );

  return {
    available: true,
    objectStoreStatus: "ok",
    llmReasoning: (hasStructuredSteps || hasValidRawReasoning) ? {
      steps: steps.length > 0 ? steps : undefined,
      rawReasoning: hasValidRawReasoning ? rawReasoning : undefined,
    } : undefined,
    toolCallIds: toolCallIds.length > 0 ? toolCallIds : undefined,
    downstreamContextIds: downstreamContextIds.length > 0 ? downstreamContextIds : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}
