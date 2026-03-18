import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";

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
  return (OBJECT_STORE_REGIONS as readonly string[]).includes(s);
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
  debugLog("[getMonitoringLogCategoriesFromDeployment] ========== START ==========");
  debugLog(`[getMonitoringLogCategoriesFromDeployment] Searching for categories:`);
  debugLog(`[getMonitoringLogCategoriesFromDeployment]   - brokerLogger: "${MONITORING_CATEGORY_BROKER}"`);
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
    
    // Search for brokerLogger
    const brokerLoggerFound = s.includes(MONITORING_CATEGORY_BROKER);
    debugLog(`[getMonitoringLogCategoriesFromDeployment] Searching for "${MONITORING_CATEGORY_BROKER}": ${brokerLoggerFound ? "✓ FOUND" : "✗ NOT FOUND"}`);
    if (!brokerLoggerFound) {
      // Try to find similar patterns
      const brokerPatterns = [
        /com\.mulesoft\.modules\.agent/i,
        /modules\.agent\.broker/i,
        /agent\.broker/i,
        /broker/i,
      ];
      for (const pattern of brokerPatterns) {
        if (pattern.test(s)) {
          const match = s.match(pattern);
          debugLog(`[getMonitoringLogCategoriesFromDeployment]   Found similar pattern: "${match?.[0]}"`);
        }
      }
    } else {
      // Find where it appears
      const index = s.indexOf(MONITORING_CATEGORY_BROKER);
      const context = s.substring(Math.max(0, index - 100), Math.min(s.length, index + MONITORING_CATEGORY_BROKER.length + 100));
      debugLog(`[getMonitoringLogCategoriesFromDeployment]   Found at position ${index}, context: "${context}"`);
    }
    
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
    
    const result = {
      brokerLogger: brokerLoggerFound,
      insecureLogging: insecureLoggingFound,
    };
    debugLog(`[getMonitoringLogCategoriesFromDeployment] Result: brokerLogger=${result.brokerLogger}, insecureLogging=${result.insecureLogging}`);
    debugLog("[getMonitoringLogCategoriesFromDeployment] ========== END ==========");
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    debugError(`[getMonitoringLogCategoriesFromDeployment] Error during detection: ${errorMessage}`);
    debugLog("[getMonitoringLogCategoriesFromDeployment] ========== END (ERROR) ==========");
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
  debugLog(`[ObjectStore] Starting region detection from deployment detail`);
  
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
  // Try two prefix patterns (Anypoint UI uses shorter prefix: APP_{deploymentId}_)
  const storeIdPrefixFull = `APP_${deploymentId}__defaultPersistentObjectStore`;
  const storeIdPrefixShort = `APP_${deploymentId}_`;
  const has403Errors = new Set<string>(); // Track 403 errors per region for parallel execution

  // Use translation table to determine region - only search that specific region
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
  
  // Only search the preferred region (from translation table), not all regions
  // If no preferred region, use a small fallback set of common regions
  const regionsToTry: ObjectStoreRegion[] = preferred
    ? [preferred]
    : ["us-east-1", "us-west-2", "eu-central-1", "ca-central-1"]; // Fallback: search common regions if translation fails
  
  if (!preferred) {
    debugLog(`[ObjectStore] Using fallback regions: ${regionsToTry.join(", ")}`);
  }

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
    const regionsSearched = preferred ? [preferred] : ["us-east-1", "us-west-2", "eu-central-1", "ca-central-1"];
    debugLog(`[ObjectStore] 403 error summary - orgId: ${orgId}, envId: ${envId}, deploymentId: ${deploymentId}, tried regions: ${regionsSearched.join(", ")}`);
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
            if (!tasksPartition) continue;
            const partitionToCheck = tasksPartition;
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

/** Partitions for one broker: only _tasks partition is used */
interface BrokerPartitions {
  tasksPartition: string | null;
}

/**
 * Find _tasks partition - simply searches for any partition containing "_tasks".
 * Ignores broker name pattern matching for now.
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

  const result: BrokerPartitions = { tasksPartition: null };

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

    // Simply find any partition containing "_tasks" - ignore broker name pattern matching
    result.tasksPartition = allPartitions.find((p: string) => p.includes("_tasks")) ?? null;

    if (result.tasksPartition) {
      debugLog(`[ObjectStore] Found tasks partition: ${result.tasksPartition}`);
    } else {
      debugLog(`[ObjectStore] No partition containing "_tasks" found`);
      debugLog(`[ObjectStore] Available partitions: ${allPartitions.join(", ")}`);
    }
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
 * Fetch value from tasks partition by searching for keys containing taskId.
 */
async function fetchValueFromPartition(
  orgId: string,
  envId: string,
  storeId: string,
  partitionId: string,
  taskId: string,
  brokerName: string,
  accessToken: string,
  region: ObjectStoreRegion
): Promise<PartitionFetchResult> {
  debugLog(`[ObjectStore] Searching for key containing taskId: ${taskId} in tasks partition "${partitionId}"`);
  
  const foundKey = await findKeyContainingTaskId(orgId, envId, storeId, partitionId, taskId, accessToken, region);
  if (foundKey) {
    const value = await getPartitionValue(orgId, envId, storeId, partitionId, foundKey, accessToken, region);
    if (value) {
      debugLog(`[ObjectStore] Found value in tasks partition with key containing taskId: ${foundKey}`);
      return { value, keyUsed: foundKey };
    }
  }

  debugLog(`[ObjectStore] No key containing taskId ${taskId} found in tasks partition`);
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
  taskStartTime?: string | number
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
  toolCallIds?: string[];
  downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
  errors?: string[];
  /** Debug: partition names and per-partition valueFound + stringCount (for UI “are both empty?”) */
  debug?: {
    tasks: { partition: string | null; keyFound: boolean; keyUsed: string | null; valueEmpty: boolean; stringCount: number };
  };
}> {
  const errors: string[] = [];

  // Check if task is less than 1 day old (Object Store entries expire after 1 day TTL)
  if (taskStartTime) {
    const startTimeMs = typeof taskStartTime === "number" 
      ? taskStartTime 
      : /^\d+$/.test(String(taskStartTime))
        ? parseInt(String(taskStartTime), 10)
        : new Date(taskStartTime).getTime();
    const taskAgeMs = Date.now() - startTimeMs;
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    if (taskAgeMs > oneDayMs) {
      const ageHours = Math.round(taskAgeMs / (60 * 60 * 1000));
      debugLog(`[ObjectStore] Skipping Object Store fetch - task is ${ageHours} hours old (expires after 24 hours)`);
      return {
        available: false,
        objectStoreStatus: "no_keys",
        errors: [`Task is older than 1 day (${ageHours} hours old). Object Store entries expire after 24 hours.`],
      };
    }
  }

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
    // Determine which regions were actually searched
    const searchedRegions = objectStoreRegion 
      ? [objectStoreRegion] 
      : ["us-east-1", "us-west-2", "eu-central-1", "ca-central-1"]; // Fallback regions
    let errorMessage = `Object Store not found for deployment ${deploymentId}. Searched region(s): ${searchedRegions.join(", ")}. Store pattern: APP_${deploymentId}__defaultPersistentObjectStore`;
    if (deploymentType === "HY") {
      errorMessage += `. Note: Hybrid (HY) deployments may not have Object Store provisioned.`;
    }
    errors.push(errorMessage);
    return { available: false, objectStoreStatus: "no_store", errors };
  }

  let partitions: BrokerPartitions;
  try {
    debugLog(`[ObjectStore] Looking for tasks partition - storeId: ${storeInfo.storeId}, brokerName: ${brokerName}, region: ${storeInfo.region}`);
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

  if (!partitions.tasksPartition) {
    errors.push("No _tasks partition found for this broker");
    debugLog(`[ObjectStore] No tasks partition found`);
    return { available: false, objectStoreStatus: "no_keys", errors };
  }

  debugLog(`[ObjectStore] Fetching from tasks partition - searching for key containing taskId: ${taskId}`);

  type ReasoningPart = { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[]; allRawStrings: string[] };
  const toReasoningPart = (strings: string[]): ReasoningPart => {
    const { steps, rawReasoning } = parseLLMReasoning(strings);
    return {
      steps,
      rawReasoning: rawReasoning.length > 0 ? rawReasoning : strings,
      allRawStrings: strings,
    };
  };

  let tasksResult: PartitionFetchResult = { value: null, keyUsed: null };

  try {
    tasksResult = await fetchValueFromPartition(
      orgId, envId, storeInfo!.storeId, partitions.tasksPartition, taskId, brokerName, accessToken, storeInfo!.region
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("403")) {
      errors.push(errorMessage);
      return { available: false, objectStoreStatus: "403_forbidden", errors };
    }
  }

  const tasksValue = tasksResult.value;

  const tasksStrings = tasksValue ? extractStringsFromBinary(tasksValue.binaryValue) : [];

  const partitionDebug = {
    tasks: {
      partition: partitions.tasksPartition ?? null,
      keyFound: tasksValue !== null,
      keyUsed: tasksResult.keyUsed ?? null,
      valueEmpty: tasksValue !== null && tasksStrings.length === 0,
      stringCount: tasksStrings.length,
    },
  };
  const tasksStatus = partitionDebug.tasks.keyFound
    ? (partitionDebug.tasks.valueEmpty ? "key found, value empty" : `${partitionDebug.tasks.stringCount} strings`)
    : "key not found";
  debugLog(`[ObjectStore] Tasks partition result: ${partitionDebug.tasks.partition ?? "none"} → ${tasksStatus}`);

  if (!tasksValue) {
    errors.push(`Task value not found in Object Store. No key containing taskId "${taskId}" found in _tasks partition.`);
    return { available: false, objectStoreStatus: "no_keys", errors, debug: partitionDebug };
  }

  if (tasksStrings.length === 0) {
    errors.push("No readable strings found in Object Store data");
    return { available: false, objectStoreStatus: "no_keys", errors, debug: partitionDebug };
  }

  const fromTasks = tasksStrings.length > 0 ? toReasoningPart(tasksStrings) : undefined;

  const { steps, rawReasoning } = parseLLMReasoning(tasksStrings);
  const toolCallIds = [...new Set(extractToolCallIds(tasksStrings))];
  const downstreamContextIds = mergeDownstreamContexts(
    extractDownstreamContexts(tasksStrings)
  );

  const hasAnyReasoning = steps.length > 0 || rawReasoning.length > 0;

  return {
    available: true,
    objectStoreStatus: "ok",
    sourcesUsed: ["tasks"],
    fromTasks: fromTasks ? { ...fromTasks, allRawStrings: tasksStrings } : undefined,
    llmReasoning: hasAnyReasoning ? {
      steps: steps.length > 0 ? steps : undefined,
      rawReasoning: rawReasoning.length > 0 ? rawReasoning : undefined,
      allRawStrings: tasksStrings,
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
