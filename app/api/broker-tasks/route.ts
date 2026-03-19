import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { BrokerTasksRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { msearch } from "@/lib/api/msearch";
import { validationError } from "@/lib/api/error-responses";
import { resolveBrokerContext } from "@/lib/broker-context";

export const dynamic = "force-dynamic";

/** Log entry from AMC GET /logs API (JSON array). */
interface AmcLogEntry {
  docId?: string;
  timestamp?: number;
  message?: string;
  replicaId?: string;
  logLevel?: string;
  context?: unknown;
}

/**
 * Fetch logs using GET .../logs?length=&descending= (same as Anypoint UI). Returns text lines for parseLogsForTasks.
 */
/** AMC /logs API allows max length 1000 per request. */
const AMC_LOGS_MAX_LENGTH = 1000;

async function fetchLogsFromAmc(
  baseUrl: string,
  orgId: string,
  envId: string,
  deploymentId: string,
  specId: string,
  accessToken: string,
  length: number = AMC_LOGS_MAX_LENGTH
): Promise<string> {
  const safeLength = Math.min(Math.max(1, length), AMC_LOGS_MAX_LENGTH);
  const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs/${specId}/logs?length=${safeLength}&descending=true`;
  const res = await loggedFetch(logsUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    debugLog("[NO-ENTITLEMENT] GET /logs failed:", res.status);
    return "";
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const entries = (await res.json()) as AmcLogEntry[];
    if (!Array.isArray(entries)) return "";
    debugLog("[NO-ENTITLEMENT] GET /logs returned", entries.length, "JSON log entries");
    return entries
      .map((e) => {
        const ts = e.timestamp != null ? new Date(e.timestamp).toISOString() : "";
        return `${ts} ${e.message ?? ""}`.trim();
      })
      .filter((line) => line.length > 0)
      .join("\n");
  }
  return res.text();
}

/**
 * No-entitlement mode: get broker tasks via Runtime Manager + Application Manager GET /logs (JSON).
 * Used when the org does not have Monitoring Center Premium (_msearch not available).
 * When brokerAppName is provided (e.g. from resolveBrokerContext), we list AMC deployments by
 * ?name=brokerAppName to use the CloudHub/AMC deployment that has logs, instead of the RM applicationId.
 */
async function getBrokerTasksFromRuntimeLogs(
  orgId: string,
  apiInstanceId: string,
  accessToken: string,
  baseUrl: string,
  timeRangeMs: number,
  options?: { envId?: string; brokerAppName?: string }
): Promise<{ tasks: unknown[] }> {
  const { envId: requestEnvId, brokerAppName } = options ?? {};
  debugLog("[NO-ENTITLEMENT] Getting broker tasks from runtime logs for apiInstanceId:", apiInstanceId);

  try {
    // Step 1: Get list of environments for this org
    const environmentsUrl = `${baseUrl}/accounts/api/organizations/${orgId}/environments`;
    const envsRes = await loggedFetch(environmentsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!envsRes.ok) {
      debugLog("[NO-ENTITLEMENT] Failed to fetch environments:", envsRes.status);
      return { tasks: [] };
    }

    const envsData = (await envsRes.json()) as { data?: Array<{ id: string; name: string; type?: string }> };
    const allEnvs = envsData.data || [];
    // Skip Design (deprecated design-time env); only use runtime environments for RM/AMC calls
    const environments = allEnvs.filter((e) => (e.type || "").toLowerCase() !== "design");
    debugLog("[NO-ENTITLEMENT] Found", environments.length, "runtime environments (excluded Design)");

    // Step 1.2: If we have the AMC app name (e.g. from resolveBrokerContext), list deployment by name
    // so we use the CloudHub deployment that has logs (e.g. c7096613...) instead of RM applicationId (b57...).
    if (brokerAppName && requestEnvId && environments.some((e) => e.id === requestEnvId)) {
      try {
        const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${requestEnvId}/deployments?name=${encodeURIComponent(brokerAppName)}`;
        const listRes = await loggedFetch(listUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (listRes.ok) {
          const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }>; total?: number };
          const items = listData.items ?? [];
          if (items.length === 1) {
            const amcDeploymentId = items[0].id;
            debugLog("[NO-ENTITLEMENT] Matched AMC deployment by name (request env):", items[0].name, "->", amcDeploymentId);
            // Resolve specId: try /specs first, then deployment detail
            let specId: string | null = null;
            const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${requestEnvId}/deployments/${amcDeploymentId}/specs`;
            const specsRes = await loggedFetch(specsUrl, {
              method: "GET",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (specsRes.ok) {
              const specs = (await specsRes.json()) as Array<{ version?: string; id?: string }>;
              specId = specs?.length ? (specs[0].version ?? specs[0].id ?? null) : null;
            }
            if (!specId) {
              const depUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${requestEnvId}/deployments/${amcDeploymentId}`;
              const depRes = await loggedFetch(depUrl, {
                method: "GET",
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (depRes.ok) {
                const dep = (await depRes.json()) as { desiredVersion?: string; replicas?: Array<{ id: string }> };
                specId = dep.desiredVersion ?? dep.replicas?.[0]?.id ?? null;
              }
            }
            if (specId) {
              const logsText = await fetchLogsFromAmc(
                baseUrl,
                orgId,
                requestEnvId,
                amcDeploymentId,
                specId,
                accessToken
              );
              if (logsText.length > 0) {
                const parsedTasks = parseLogsForTasks(logsText, apiInstanceId);
                debugLog("[NO-ENTITLEMENT] Found", parsedTasks.length, "tasks using AMC deployment by name (request env)");
                if (parsedTasks.length > 0) {
                  parsedTasks.sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));
                  return { tasks: parsedTasks };
                }
              }
            }
          }
        }
      } catch (e) {
        debugLog("[NO-ENTITLEMENT] AMC list by name (request env) failed:", e);
      }
    }

    // Step 1.5: Get API instance details from Runtime Manager (deploymentId or deployment.applicationId for Flex)
    let apiInstanceInfo: { deploymentId?: string; targetEnvId?: string } | null = null;
    for (const env of environments) {
      try {
        const runtimeManagerUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${env.id}/apis/${apiInstanceId}`;
        const rmRes = await loggedFetch(runtimeManagerUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (rmRes.ok) {
          const rmBody = (await rmRes.json()) as {
            deploymentId?: string;
            deployment?: { deploymentId?: string | null; applicationId?: string };
          };
          const deploymentId =
            rmBody.deploymentId ??
            rmBody.deployment?.deploymentId ??
            rmBody.deployment?.applicationId;
          if (deploymentId) {
            apiInstanceInfo = { deploymentId, targetEnvId: env.id };
            debugLog("[NO-ENTITLEMENT] Got deployment id from Runtime Manager:", deploymentId, "env:", env.id);
            break;
          }
        }
      } catch (error) {
        debugLog("[NO-ENTITLEMENT] Error fetching Runtime Manager API for env", env.id, ":", error);
        continue;
      }
    }

    const now = Date.now();
    const startTime = now - timeRangeMs;
    const endTime = now;

    // Step 2: Try each environment to find deployments and parse logs
    const allTasks: Record<string, {
      taskId: string;
      contextId: string;
      broker: string;
      firstTool: string;
      startTime: string;
      endTime: string | null;
      maxIteration: number;
      toolsUsed: Set<string>;
      appId: string;
      apiInstanceId: string;
      logCount: number;
    }> = {};

    // If we got deploymentId (or applicationId) from Runtime Manager, use that env and get specId + logs
    if (apiInstanceInfo?.deploymentId && apiInstanceInfo?.targetEnvId) {
      const targetEnv = environments.find((e: { id: string }) => e.id === apiInstanceInfo!.targetEnvId);
      if (targetEnv) {
        // Try to get deployment details to get specId
        try {
          const deploymentUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${targetEnv.id}/deployments/${apiInstanceInfo.deploymentId}`;
          const deploymentRes = await loggedFetch(deploymentUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (deploymentRes.ok) {
            const deployment = (await deploymentRes.json()) as { desiredVersion?: string; replicas?: Array<{ id: string }> };
            const specId = deployment.desiredVersion || (deployment.replicas && deployment.replicas[0]?.id);
            
            if (specId) {
              debugLog("[NO-ENTITLEMENT] Got specId:", specId, "for deployment:", apiInstanceInfo.deploymentId);
              const logsText = await fetchLogsFromAmc(
                baseUrl,
                orgId,
                targetEnv.id,
                apiInstanceInfo.deploymentId,
                specId,
                accessToken
              );
              if (logsText.length > 0) {
                debugLog("[NO-ENTITLEMENT] Successfully fetched logs, length:", logsText.length, "chars");
                const parsedTasks = parseLogsForTasks(logsText, apiInstanceId);
                for (const task of parsedTasks) {
                  allTasks[task.taskId] = task;
                }
                if (parsedTasks.length > 0) {
                  debugLog("[NO-ENTITLEMENT] Found", parsedTasks.length, "tasks using deploymentId from Runtime Manager");
                }
              } else {
                debugLog("[NO-ENTITLEMENT] No log content for deployment/spec");
              }
            }
          } else if (deploymentRes.status === 404) {
            // Flex Gateway: deployment detail may not exist; try applicationId as both deploymentId and specId
            const specIdToTry = apiInstanceInfo.deploymentId;
            const logsText = await fetchLogsFromAmc(
              baseUrl,
              orgId,
              targetEnv.id,
              apiInstanceInfo.deploymentId,
              specIdToTry,
              accessToken
            );
            if (logsText.length > 0) {
              const parsedTasks = parseLogsForTasks(logsText, apiInstanceId);
              for (const task of parsedTasks) {
                allTasks[task.taskId] = task;
              }
            }
          }
        } catch (error) {
          debugLog("[NO-ENTITLEMENT] Error fetching deployment details:", error);
        }
      }
    }

    // Step 2b: Also try Runtime Manager API approach - get API instance details and try to access logs
    // The Runtime Manager API might give us appId or other info we can use
    for (const env of environments) {
      try {
        const runtimeManagerUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${env.id}/apis/${apiInstanceId}`;
        const rmRes = await loggedFetch(runtimeManagerUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (rmRes.ok) {
          const apiInfo = (await rmRes.json()) as { 
            id?: string; 
            appId?: string; 
            deploymentId?: string; 
            targetId?: string;
            assetId?: string;
            assetVersion?: string;
            instanceLabel?: string;
            deployment?: {
              applicationId?: string;
              deploymentId?: string | null;
              targetId?: string;
            };
          };
          
          // Extract deployment info from nested deployment object if present
          const deploymentInfo = apiInfo.deployment || {};
          const applicationId = deploymentInfo.applicationId;
          const deploymentIdFromDeployment = deploymentInfo.deploymentId;
          const targetId = deploymentInfo.targetId || apiInfo.targetId;
          const brokerName = (apiInfo.instanceLabel || apiInfo.assetId || "").toLowerCase();

          debugLog("[NO-ENTITLEMENT] Runtime Manager API response for apiInstanceId", apiInstanceId, ":", {
            id: apiInfo.id,
            appId: apiInfo.appId,
            deploymentId: apiInfo.deploymentId,
            deploymentApplicationId: applicationId,
            deploymentDeploymentId: deploymentIdFromDeployment,
            targetId: targetId,
            assetId: apiInfo.assetId,
            instanceLabel: apiInfo.instanceLabel,
            assetVersion: apiInfo.assetVersion,
          });

          // Try applicationId first (for Flex Gateway/Hybrid), then deploymentId, then targetId
          // For Flex Gateway, applicationId might be the actual deployment ID
          const deploymentIdToTry = deploymentIdFromDeployment || applicationId || apiInfo.deploymentId || targetId;
          if (deploymentIdToTry) {
            debugLog("[NO-ENTITLEMENT] Trying to fetch logs using:", {
              deploymentId: deploymentIdToTry,
              source: deploymentIdFromDeployment ? "deployment.deploymentId" : 
                      applicationId ? "deployment.applicationId" :
                      apiInfo.deploymentId ? "apiInfo.deploymentId" :
                      "targetId"
            });
            
            // Try multiple approaches to get logs
            const approaches: Array<{ name: string; deploymentId: string; specId?: string; getSpecs: boolean }> = [];

            // Approach 0a: If we have the AMC app name, list deployments with ?name= (exact match, has logs)
            if (brokerAppName) {
              try {
                const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments?name=${encodeURIComponent(brokerAppName)}`;
                const listRes = await loggedFetch(listUrl, {
                  method: "GET",
                  headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (listRes.ok) {
                  const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
                  const items = listData.items || [];
                  if (items.length === 1) {
                    approaches.push({
                      name: "amc-deployment-by-app-name",
                      deploymentId: items[0].id,
                      getSpecs: true,
                    });
                    debugLog("[NO-ENTITLEMENT] Matched AMC deployment by app name:", items[0].name, "->", items[0].id);
                  }
                }
              } catch (_) {
                // ignore
              }
            }

            // Approach 0b: Resolve AMC deployment by broker name (list all and match normalized name)
            if (brokerName && !brokerAppName) {
              try {
                const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`;
                const listRes = await loggedFetch(listUrl, {
                  method: "GET",
                  headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (listRes.ok) {
                  const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
                  const items = listData.items || [];
                  const normalizedBroker = brokerName.replace(/-/g, "");
                  for (const item of items) {
                    const nameNorm = (item.name || "").toLowerCase().replace(/-and-/gi, "-").replace(/-/g, "");
                    const nameNormWithAnd = (item.name || "").toLowerCase().replace(/-/g, "");
                    if (
                      nameNorm === normalizedBroker ||
                      nameNormWithAnd.includes(normalizedBroker) ||
                      normalizedBroker.includes(nameNorm) ||
                      (item.name || "").toLowerCase().replace(/-and-/gi, "-") === brokerName
                    ) {
                      approaches.push({
                        name: "amc-deployment-by-name",
                        deploymentId: item.id,
                        getSpecs: true,
                      });
                      debugLog("[NO-ENTITLEMENT] Matched AMC deployment by name:", item.name, "->", item.id);
                      break;
                    }
                  }
                }
              } catch (_) {
                // ignore
              }
            }

            // Approach 1: Try to get specs first, then logs (using RM deployment id)
            if (applicationId || deploymentIdToTry) {
              approaches.push({
                name: "specs-then-logs",
                deploymentId: deploymentIdToTry,
                getSpecs: true,
              });
            }
            
            // Approach 2: Try applicationId as both deploymentId and specId
            if (applicationId && deploymentIdToTry === applicationId) {
              approaches.push({
                name: "applicationId-as-both",
                deploymentId: applicationId,
                specId: applicationId,
                getSpecs: false,
              });
            }
            
            for (const approach of approaches) {
              try {
                let specId: string | null = null;
                
                if (approach.getSpecs) {
                  // Try to get deployment specs to get specId
                  const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${approach.deploymentId}/specs`;
                  const specsRes = await loggedFetch(specsUrl, {
                    method: "GET",
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  });

                  if (specsRes.ok) {
                    const specs = (await specsRes.json()) as Array<{ version?: string; id?: string }>;
                    specId = specs && specs.length > 0 ? (specs[0].version ?? specs[0].id ?? null) : null;
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Got specId:`, specId, "for deployment:", approach.deploymentId);
                  } else {
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Failed to fetch specs, status:`, specsRes.status);
                    if (approach.specId) {
                      specId = approach.specId;
                      debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Using provided specId:`, specId);
                    } else {
                      // Fallback: get specId from deployment detail (desiredVersion or replicas[0].id) - matches Anypoint UI
                      try {
                        const depUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${approach.deploymentId}`;
                        const depRes = await loggedFetch(depUrl, {
                          method: "GET",
                          headers: { Authorization: `Bearer ${accessToken}` },
                        });
                        if (depRes.ok) {
                          const dep = (await depRes.json()) as { desiredVersion?: string; replicas?: Array<{ id: string }> };
                          specId = dep.desiredVersion ?? dep.replicas?.[0]?.id ?? null;
                          if (specId) {
                            debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Got specId from deployment detail:`, specId);
                          }
                        }
                      } catch (_) {
                        // ignore
                      }
                      if (!specId) continue;
                    }
                  }
                } else if (approach.specId) {
                  specId = approach.specId;
                  debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Using provided specId:`, specId);
                }
                
                if (specId) {
                  debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Fetching GET /logs for deployment=${approach.deploymentId} specId=${specId}`);
                  const logsText = await fetchLogsFromAmc(
                    baseUrl,
                    orgId,
                    env.id,
                    approach.deploymentId,
                    specId,
                    accessToken
                  );

                  if (logsText.length > 0) {
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Successfully fetched logs, length:`, logsText.length, "chars");
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": First 500 chars:`, logsText.substring(0, 500));

                    const parsedTasks = parseLogsForTasks(logsText, apiInstanceId);
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Parsed`, parsedTasks.length, "tasks");
                    
                    for (const task of parsedTasks) {
                      if (!allTasks[task.taskId]) {
                        allTasks[task.taskId] = task;
                      } else {
                        // Merge task data
                        const existing = allTasks[task.taskId];
                        existing.logCount += task.logCount;
                        if (task.maxIteration > existing.maxIteration) {
                          existing.maxIteration = task.maxIteration;
                        }
                        task.toolsUsed.forEach((tool: string) => existing.toolsUsed.add(tool));
                        if (!existing.firstTool && task.firstTool) {
                          existing.firstTool = task.firstTool;
                        }
                      }
                    }
                    
                    if (parsedTasks.length > 0) {
                      debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Successfully found`, parsedTasks.length, "tasks");
                      break; // Success! No need to try other approaches
                    } else {
                      debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": No tasks found in logs (might be wrong deployment)`);
                    }
                  } else {
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": No log content returned (wrong deployment/spec or empty logs)`);
                  }
                } else {
                  debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": No specId available`);
                }
              } catch (error) {
                debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Error:`, error);
                continue; // Try next approach
              }
            }
          } else {
            debugLog("[NO-ENTITLEMENT] No deploymentId, applicationId, or targetId found in Runtime Manager API response");
          }
        }
      } catch (error) {
        debugLog("[NO-ENTITLEMENT] Error fetching Runtime Manager API for env", env.id, ":", error);
        continue;
      }
    }

    // Helper function to parse logs and extract tasks
    function parseLogsForTasks(logsText: string, targetApiInstanceId: string): Array<{
      taskId: string;
      contextId: string;
      broker: string;
      firstTool: string;
      startTime: string;
      endTime: string | null;
      maxIteration: number;
      toolsUsed: Set<string>;
      appId: string;
      apiInstanceId: string;
      logCount: number;
    }> {
      const tasks: Record<string, {
        taskId: string;
        contextId: string;
        broker: string;
        firstTool: string;
        startTime: string;
        endTime: string | null;
        maxIteration: number;
        toolsUsed: Set<string>;
        appId: string;
        apiInstanceId: string;
        logCount: number;
      }> = {};

      const logLines = logsText.split("\n").filter((line: string) => line.trim().length > 0);
      debugLog("[NO-ENTITLEMENT] Parsing", logLines.length, "log lines");
      
      // Debug: Show sample log lines to understand format
      if (logLines.length > 0) {
        debugLog("[NO-ENTITLEMENT] Sample log lines (first 5):");
        for (let i = 0; i < Math.min(5, logLines.length); i++) {
          debugLog(`[NO-ENTITLEMENT]   Line ${i + 1}:`, logLines[i]?.substring(0, 200));
        }
        
        // Also check if any line contains apiInstanceId
        const linesWithApiInstanceId = logLines.filter((line: string) => 
          line.includes(targetApiInstanceId) || line.toLowerCase().includes("apiinstanceid")
        );
        debugLog("[NO-ENTITLEMENT] Lines containing apiInstanceId:", linesWithApiInstanceId.length);
        if (linesWithApiInstanceId.length > 0) {
          debugLog("[NO-ENTITLEMENT] Sample line with apiInstanceId:", linesWithApiInstanceId[0]?.substring(0, 300));
        }
      }
      
      // More flexible regex patterns to match different log formats
      // taskId can appear as: taskId=xxx, "taskId":"xxx", taskId:xxx, etc.
      const taskIdRegex = /(?:taskId|task_id|task-id)[=:]"?([a-f0-9-]+)"?/gi;
      // apiInstanceId can appear in various formats
      const apiInstanceRegex = new RegExp(`(?:apiInstanceId|api_instance_id|api-instance-id)[=:]"?${targetApiInstanceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, "gi");
      const contextIdRegex = /(?:contextId|context_id|context-id)[=:]"?([a-f0-9-]+)"?/gi;
      const agentRegex = /(?:agent|broker)[=:]"??(\S+)"?/gi;
      // Tool patterns: various formats
      const toolRegex = /(?:LLM selected tool|Executed tool|tool selected|tool executed|using tool)[=:]"??(\S+)"?/gi;
      const iterationRegex = /(?:iteration|iter)[=:]"??(\d+)"?/gi;
      
      // Also try to match JSON log formats
      const jsonTaskIdRegex = /"taskId"\s*:\s*"([a-f0-9-]+)"/gi;
      const jsonApiInstanceRegex = new RegExp(`"apiInstanceId"\\s*:\\s*"${targetApiInstanceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, "gi");

      let linesWithApiInstance = 0;
      let linesWithTaskId = 0;
      let matchedLines = 0;

      for (const line of logLines) {
        // Check if line contains our apiInstanceId (try both regex patterns)
        let apiInstanceMatch = apiInstanceRegex.test(line);
        if (!apiInstanceMatch) {
          // Try JSON format
          apiInstanceMatch = jsonApiInstanceRegex.test(line);
          if (!apiInstanceMatch) {
            continue;
          }
          jsonApiInstanceRegex.lastIndex = 0;
        }
        linesWithApiInstance++;
        // Reset regex for next check
        apiInstanceRegex.lastIndex = 0;

        // Extract taskId (try both regex patterns)
        let taskIdMatch = line.match(taskIdRegex);
        if (!taskIdMatch) {
          // Try JSON format
          taskIdMatch = line.match(jsonTaskIdRegex);
          if (!taskIdMatch) {
            continue;
          }
        }
        linesWithTaskId++;
        // Extract taskId value (handle different formats)
        let taskId = "";
        if (taskIdMatch && taskIdMatch[1]) {
          taskId = taskIdMatch[1];
        } else if (taskIdMatch && taskIdMatch[0]) {
          // Fallback: extract from full match
          taskId = taskIdMatch[0].replace(/(?:taskId|task_id|task-id)[=:]"?/i, "").replace(/"$/, "");
        }
        if (!taskId || taskId.length < 8) {
          continue; // Invalid taskId
        }
        matchedLines++;

        // Initialize task if not seen before
        if (!tasks[taskId]) {
          const contextMatch = line.match(contextIdRegex);
          const agentMatch = line.match(agentRegex);
          const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
          
          tasks[taskId] = {
            taskId,
            contextId: contextMatch ? contextMatch[0].replace("contextId=", "") : "",
            broker: agentMatch ? agentMatch[0].replace("agent=", "") : "",
            firstTool: "",
            startTime: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
            endTime: null,
            maxIteration: 0,
            toolsUsed: new Set(),
            appId: "",
            apiInstanceId: targetApiInstanceId,
            logCount: 0,
          };
        }

        const task = tasks[taskId];
        task.logCount++;

        // Extract contextId if not already set
        const ctxMatch = line.match(contextIdRegex);
        if (ctxMatch && !task.contextId) {
          task.contextId = ctxMatch[0].replace("contextId=", "");
        }

        // Extract broker/agent if not already set
        const agtMatch = line.match(agentRegex);
        if (agtMatch && !task.broker) {
          task.broker = agtMatch[0].replace("agent=", "");
        }

        // Track iterations
        const iterMatch = line.match(iterationRegex);
        if (iterMatch) {
          const it = parseInt(iterMatch[0].replace("iteration=", ""), 10);
          if (it > task.maxIteration) {
            task.maxIteration = it;
          }
        }

        // Track tools used
        const toolMatch = line.match(toolRegex);
        if (toolMatch) {
          const tool = toolMatch[0].replace(/(?:LLM selected tool|Executed tool) /, "");
          task.toolsUsed.add(tool);
          if (!task.firstTool) {
            task.firstTool = tool;
          }
        }

        // Track timestamps
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
        if (tsMatch) {
          const timestamp = tsMatch[1];
          if (!task.startTime || timestamp < task.startTime) {
            task.startTime = timestamp;
          }
          // Consider as end time if completion indicator
          if (line.includes("Executed tool") || line.includes("HTTP/1.1 2")) {
            if (!task.endTime || timestamp > task.endTime) {
              task.endTime = timestamp;
            }
          }
        }
      }

      debugLog("[NO-ENTITLEMENT] Parsing stats:", {
        totalLines: logLines.length,
        linesWithApiInstance,
        linesWithTaskId,
        matchedLines,
        tasksFound: Object.keys(tasks).length,
      });

      return Object.values(tasks);
    }

    if (Object.keys(allTasks).length === 0) {
      debugLog("[NO-ENTITLEMENT] No tasks found in runtime logs");
      return { tasks: [] }; // Return empty array instead of null to indicate fallback succeeded
    }

    // Convert to array format
    const tasksList = Object.values(allTasks).map((t) => {
      let duration: string | null = null;
      if (t.startTime && t.endTime) {
        try {
          const s = new Date(t.startTime).getTime();
          const e = new Date(t.endTime).getTime();
          duration = ((e - s) / 1000).toFixed(1);
        } catch {
          // ignore
        }
      }
      return {
        taskId: t.taskId,
        contextId: t.contextId,
        broker: t.broker,
        firstTool: t.firstTool,
        startTime: t.startTime,
        endTime: t.endTime,
        duration,
        maxIteration: t.maxIteration,
        toolsUsed: Array.from(t.toolsUsed),
        appId: t.appId,
        apiInstanceId: t.apiInstanceId,
        logCount: t.logCount,
      };
    });

    tasksList.sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

    debugLog("[NO-ENTITLEMENT] Successfully parsed", tasksList.length, "tasks from runtime logs");
    return { tasks: tasksList };
  } catch (error) {
    debugError("[NO-ENTITLEMENT] Error in runtime logs:", error);
    // Return empty tasks array instead of null to indicate fallback was attempted
    // This allows the API to return 200 instead of 403
    return { tasks: [] };
  }
}

export async function POST(request: NextRequest) {
  debugLog("=".repeat(80));
  debugLog("[BROKER-TASKS] ========== START POST REQUEST ==========");
  debugLog(`[BROKER-TASKS] Request URL: ${request.url}`);
  
  // Authentication check
  debugLog("[BROKER-TASKS] Step 1: Authenticating...");
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) {
    debugLog(`[BROKER-TASKS] ✗ Authentication failed: ${authResult.status}`);
    return authResult;
  }
  debugLog("[BROKER-TASKS] ✓ Authentication successful");
  
  const { baseUrl, accessToken } = authResult;
  debugLog(`[BROKER-TASKS] baseUrl: ${baseUrl}`);
  
  // Parse and validate request body with Zod
  debugLog("[BROKER-TASKS] Step 2: Parsing request body...");
  const body = await request.json();
  debugLog(`[BROKER-TASKS] Request body: ${JSON.stringify(body)}`);
  const parseResult = BrokerTasksRequestSchema.safeParse(body);
  
  if (!parseResult.success) {
    debugLog(`[BROKER-TASKS] ✗ Validation failed: ${JSON.stringify(parseResult.error.format())}`);
    return validationError(parseResult.error);
  }
  debugLog("[BROKER-TASKS] ✓ Validation successful");
  
  const { orgId, apiInstanceId, envId, timeRangeMs = 24 * 3600 * 1000 } = parseResult.data;
  debugLog(`[BROKER-TASKS] Validated parameters: orgId=${orgId}, apiInstanceId=${apiInstanceId}, envId=${envId ?? "none"}, timeRangeMs=${timeRangeMs}`);

  let brokerAppName: string | undefined;
  if (envId) {
    try {
      const brokerContext = await resolveBrokerContext(orgId, envId, apiInstanceId, accessToken, baseUrl, loggedFetch);
      brokerAppName = brokerContext?.appName;
      if (brokerAppName) {
        debugLog(`[BROKER-TASKS] Resolved broker app name for post-filter: ${brokerAppName}`);
      }
    } catch (e) {
      debugLog(`[BROKER-TASKS] Resolve broker context failed (continuing without app filter):`, e);
    }
  }

  // Enforce 7-day maximum to match Visualizer API limit
  const maxTimeRangeMs = 7 * 24 * 3600 * 1000; // 7 days
  const timeRange = Math.min(timeRangeMs, maxTimeRangeMs);
  debugLog(`[BROKER-TASKS] Time range: ${timeRange}ms (max: ${maxTimeRangeMs}ms)`);

  try {
    // Build Lucene query - filter by orgId first, then apiInstanceId and taskId
    // Since we're searching all indices, we need to filter by orgId in the query
    // IMPORTANT: apiInstanceId must be quoted if it contains special characters, but for numeric IDs we can use it directly
    debugLog("[BROKER-TASKS] Step 3: Building Lucene query...");
    const luceneQuery = `orgId=${orgId} AND taskId= AND apiInstanceId=${apiInstanceId}`;
    debugLog(`[BROKER-TASKS] Query: ${luceneQuery}`);

    // Search for logs containing taskId= pattern filtered by apiInstanceId.
    // Page through results when total > page size so we count all unique tasks.
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 20; // cap at 20k hits to avoid runaway
    debugLog("[BROKER-TASKS] Step 4: Searching logs with msearch (paging when needed)...");
    const allHits: unknown[] = [];
    let totalFromApi = 0;
    let pageError: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const pageResult = await msearch(
        orgId,
        luceneQuery,
        { size: PAGE_SIZE, from, sortOrder: "desc", timeRangeMs: timeRange },
        accessToken,
        baseUrl
      );
      if (pageResult.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
        pageError = pageResult.error;
        break;
      }
      totalFromApi = pageResult.total;
      const hits = pageResult.hits ?? [];
      allHits.push(...hits);
      if (page === 0) {
        debugLog(`[BROKER-TASKS] Search result: ${hits.length} hits, total=${totalFromApi}, error: ${pageResult.error || "none"}`);
      }
      if (hits.length < PAGE_SIZE || allHits.length >= totalFromApi) {
        break;
      }
      debugLog(`[BROKER-TASKS] Fetched page ${page + 1}, total hits so far: ${allHits.length}/${totalFromApi}`);
    }
    const allLogsResult = {
      total: totalFromApi,
      hits: allHits,
      error: pageError,
    };
    if (allHits.length > 0 && allHits.length < totalFromApi) {
      debugLog(`[BROKER-TASKS] Paging complete: ${allHits.length} hits fetched (total=${totalFromApi})`);
    }

    // No entitlement: use Runtime Manager + Application Manager logs (standard APIs)
    if (allLogsResult.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
      debugLog("[BROKER-TASKS] Decision: Premium required, entering no-entitlement mode");
      debugLog("[NO-ENTITLEMENT] Getting broker tasks via runtime logs (no _msearch)");
      try {
        const noEntitlementResult = await getBrokerTasksFromRuntimeLogs(
          orgId,
          apiInstanceId,
          accessToken,
          baseUrl,
          timeRange,
          { envId: envId ?? undefined, brokerAppName: brokerAppName ?? undefined }
        );
        const tasksList = (noEntitlementResult?.tasks || []) as Array<{
          taskId: string;
          contextId: string;
          broker: string;
          firstTool: string;
          startTime: string;
          endTime: string | null;
          duration?: string | null;
          maxIteration: number;
          toolsUsed: string[];
          appId: string;
          apiInstanceId: string;
          logCount: number;
        }>;
        debugLog("[NO-ENTITLEMENT] Returning", tasksList.length, "tasks");
        return NextResponse.json({
          tasks: tasksList,
          source: "runtime-logs",
          query: luceneQuery,
          totalTasks: tasksList.length,
          totalLogs: 0,
          filters: { apiInstanceId },
          mode: "no-entitlement",
        });
      } catch (noEntitlementError) {
        debugError("[NO-ENTITLEMENT] Error getting tasks from runtime logs:", noEntitlementError);
        return NextResponse.json({
          tasks: [],
          source: "runtime-logs",
          query: luceneQuery,
          totalTasks: 0,
          totalLogs: 0,
          filters: { apiInstanceId },
          mode: "no-entitlement",
        });
      }
    }

    const hitsToUse =
      brokerAppName !== undefined
        ? allLogsResult.hits.filter((h: unknown) => {
            const src = (h as { _source?: { appId?: string } })._source;
            const hitAppId = (src?.appId as string) || "";
            return hitAppId === brokerAppName;
          })
        : allLogsResult.hits;
    if (brokerAppName && hitsToUse.length !== allLogsResult.hits.length) {
      debugLog(`[BROKER-TASKS] Post-filtered by appId=${brokerAppName}: ${allLogsResult.hits.length} -> ${hitsToUse.length} hits`);
    }

    debugLog("Broker tasks result:", {
      totalLogs: allLogsResult.total,
      hitsCount: allLogsResult.hits.length,
      hitsAfterFilter: hitsToUse.length,
      sampleApiInstanceIds: hitsToUse.slice(0, 5).map((h: unknown) => {
        const hit = h as { _source?: { message?: string } };
        const msg = (hit._source?.message as string) || "";
        const match = msg.match(/apiInstanceId=(\d+)/);
        return match ? match[1] : null;
      }),
    });

    // Extract unique taskIds from matching logs
    const tasks: Record<
      string,
      {
        taskId: string;
        contextId: string;
        broker: string;
        firstTool: string;
        startTime: string;
        endTime: string | null;
        maxIteration: number;
        toolsUsed: Set<string>;
        appId: string;
        apiInstanceId: string;
        logCount: number;
      }
    > = {};

    const re = {
      task: /taskId=([a-f0-9-]+)/,
      ctx: /contextId=([a-f0-9-]+)/,
      agent: /agent=(\S+)/,
      tool: /(?:LLM selected tool|Executed tool) (\S+)/,
      iter: /iteration=(\d+)/,
      apiInstance: /apiInstanceId=(\d+)/,
    };

    // Process logs to extract unique taskIds and build task metadata
    for (const h of hitsToUse) {
      const hit = h as { _source?: { message?: string; timestamp?: string; appId?: string } };
      const msg = (hit._source?.message as string) || "";
      const tid = (msg.match(re.task) || [])[1];
      if (!tid) continue;

      // Initialize task if not seen before
      if (!tasks[tid]) {
        tasks[tid] = {
          taskId: tid,
          contextId: (msg.match(re.ctx) || [])[1] || "",
          broker: (msg.match(re.agent) || [])[1] || "",
          firstTool: "",
          startTime: (hit._source?.timestamp as string) || "",
          endTime: null,
          maxIteration: 0,
          toolsUsed: new Set(),
          appId: (hit._source?.appId as string) || "",
          apiInstanceId: (msg.match(re.apiInstance) || [])[1] || "",
          logCount: 0,
        };
      }

      // Update task metadata from this log entry
      const task = tasks[tid];
      task.logCount++;

      // Extract contextId if not already set
      const ctx = (msg.match(re.ctx) || [])[1];
      if (ctx && !task.contextId) {
        task.contextId = ctx;
      }

      // Extract broker/agent if not already set
      const agt = (msg.match(re.agent) || [])[1];
      if (agt && !task.broker) {
        task.broker = agt;
      }

      // Extract apiInstanceId if not already set
      const apiInst = (msg.match(re.apiInstance) || [])[1];
      if (apiInst && !task.apiInstanceId) {
        task.apiInstanceId = apiInst;
      }

      // Track iterations
      const it = parseInt((msg.match(re.iter) || [])[1] || "0", 10);
      if (it > task.maxIteration) {
        task.maxIteration = it;
      }

      // Track tools used
      const tool = (msg.match(re.tool) || [])[1];
      if (tool) {
        task.toolsUsed.add(tool);
        // Set firstTool if this is iteration=1 or if we don't have one yet
        if (!task.firstTool || (it === 1 && msg.includes("LLM selected tool"))) {
          task.firstTool = tool;
        }
      }

      // Track timestamps (earliest start, latest end)
      const timestamp = (hit._source?.timestamp as string) || "";
      if (timestamp) {
        if (!task.startTime || timestamp < task.startTime) {
          task.startTime = timestamp;
        }
        // Consider this as potential end time if it's a completion indicator
        if (msg.includes("Executed tool") || msg.includes("FINAL_RESPONSE") || msg.includes("HTTP/1.1 2")) {
          if (!task.endTime || timestamp > task.endTime) {
            task.endTime = timestamp;
          }
        }
      }

      // Update appId if not already set
      const appId = (hit._source?.appId as string) || "";
      if (appId && !task.appId) {
        task.appId = appId;
      }
    }

    // Convert to array, compute duration, serialize toolsUsed
    // IMPORTANT: Filter to only include tasks that match the requested apiInstanceId
    const list = Object.values(tasks)
      .filter((t) => {
        // Only include tasks where apiInstanceId matches the requested one
        return t.apiInstanceId === apiInstanceId;
      })
      .map((t) => {
        let duration: string | null = null;
        if (t.startTime && t.endTime) {
          try {
            const s = new Date(t.startTime).getTime();
            const e = new Date(t.endTime).getTime();
            duration = ((e - s) / 1000).toFixed(1);
          } catch {
            // ignore
          }
        }
        return {
          taskId: t.taskId,
          contextId: t.contextId,
          broker: t.broker,
          firstTool: t.firstTool,
          startTime: t.startTime,
          endTime: t.endTime,
          duration,
          maxIteration: t.maxIteration,
          toolsUsed: Array.from(t.toolsUsed),
          appId: t.appId,
          apiInstanceId: t.apiInstanceId,
          logCount: t.logCount,
        };
      });

    list.sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

    debugLog("Broker tasks filtered result:", {
      requestedApiInstanceId: apiInstanceId,
      totalTasksBeforeFilter: Object.keys(tasks).length,
      totalTasksAfterFilter: list.length,
      sampleTaskApiInstanceIds: list.slice(0, 5).map((t) => t.apiInstanceId),
    });

    debugLog(`[BROKER-TASKS] Step 5: Building response with ${list.length} tasks`);
    debugLog(`[BROKER-TASKS] Task breakdown: ${JSON.stringify(
      list.reduce((acc: Record<string, number>, task: { broker?: string }) => {
        const broker = task.broker || "unknown";
        acc[broker] = (acc[broker] || 0) + 1;
        return acc;
      }, {})
    )}`);
    debugLog("[BROKER-TASKS] ========== END POST REQUEST (SUCCESS) ==========");
    debugLog("=".repeat(80));
    return NextResponse.json({ 
      tasks: list, 
      source: "_msearch", 
      query: luceneQuery,
      totalTasks: list.length,
      totalLogs: allLogsResult.total,
      filters: { apiInstanceId },
    });
  } catch (error) {
    debugLog("[BROKER-TASKS] ========== END POST REQUEST (ERROR) ==========");
    debugLog("=".repeat(80));
    debugError("Broker tasks API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch broker tasks" },
      { status: 500 }
    );
  }
}
