import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { BrokerTasksRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

async function msearch(
  orgId: string,
  luceneQuery: string,
  opts: { size?: number; sortOrder?: "asc" | "desc"; timeRangeMs?: number } = {},
  accessToken: string,
  baseUrl: string
): Promise<{ total: number; hits: unknown[]; raw: unknown; error?: "MONITORING_CENTER_PREMIUM_REQUIRED" }> {
  const { size = 500, sortOrder = "asc", timeRangeMs = 30 * 24 * 3600 * 1000 } = opts;
  const now = Date.now();
  // Anypoint's API doesn't support wildcard patterns in _msearch index field
  // Use empty array to search all indices, then filter by orgId in the query
  const ndjson = [
    JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
    JSON.stringify({
      version: true,
      size,
      sort: [{ timestamp: { order: sortOrder, unmapped_type: "boolean" } }],
      _source: { excludes: [] },
      stored_fields: ["*"],
      docvalue_fields: ["timestamp"],
    }),
    JSON.stringify({
      filter: [
        {
          range: {
            timestamp: {
              gte: now - timeRangeMs,
              lte: now,
              format: "epoch_millis",
            },
          },
        },
      ],
      query: [{ query: luceneQuery, language: "lucene" }],
    }),
  ].join("\n") + "\n";

  const url = `${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`;
  const res = await loggedFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson,
  });

  if (!res.ok) {
    const text = await res.text();
    // Check for Monitoring Center Premium entitlement error first
    if (res.status === 403 && text.includes("Monitoring Center Premium")) {
      // Don't log this as an error - it's an expected entitlement issue
      return { total: 0, hits: [], raw: {}, error: "MONITORING_CENTER_PREMIUM_REQUIRED" };
    }
    // Log other errors
    debugError("Elasticsearch _msearch error response:", text);
    debugError("Query used:", luceneQuery);
    debugError("First line of ndjson:", ndjson.split("\n")[0]);
    throw new Error(`_msearch ${res.status}: ${text.slice(0, 500)}`);
  }

  const raw = await res.json();
  const r = (raw.responses || [])[0] || {};
  const hits = (r.hits && r.hits.hits) || [];
    return { total: r.hits ? r.hits.total : 0, hits, raw };
}

/**
 * No-entitlement mode: get broker tasks via Runtime Manager + Application Manager logs/file.
 * Used when the org does not have Monitoring Center Premium (_msearch not available).
 */
async function getBrokerTasksFromRuntimeLogs(
  orgId: string,
  apiInstanceId: string,
  accessToken: string,
  baseUrl: string,
  timeRangeMs: number
): Promise<{ tasks: unknown[] }> {
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
              // Try to fetch logs directly
              const searchParams = {
                startTime,
                endTime,
                length: 10000,
                descending: true,
              };
              const searchEncoded = encodeURIComponent(JSON.stringify(searchParams));
              const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${targetEnv.id}/deployments/${apiInstanceInfo.deploymentId}/specs/${specId}/logs/file?search=${searchEncoded}`;

              const logsRes = await loggedFetch(logsUrl, {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              });

              if (logsRes.ok) {
                const logsText = await logsRes.text();
                debugLog("[NO-ENTITLEMENT] Successfully fetched logs, length:", logsText.length, "chars");
                
                // Parse logs (see parsing logic below)
                const parsedTasks = parseLogsForTasks(logsText, apiInstanceId);
                for (const task of parsedTasks) {
                  allTasks[task.taskId] = task;
                }
                
                if (parsedTasks.length > 0) {
                  debugLog("[NO-ENTITLEMENT] Found", parsedTasks.length, "tasks using deploymentId from Runtime Manager");
                }
              } else {
                debugLog("[NO-ENTITLEMENT] Failed to fetch logs for deployment:", logsRes.status);
              }
            }
          } else if (deploymentRes.status === 404) {
            // Flex Gateway: deployment detail may not exist; try applicationId as both deploymentId and specId
            const specIdToTry = apiInstanceInfo.deploymentId;
            const searchParams = { startTime, endTime, length: 10000, descending: true };
            const searchEncoded = encodeURIComponent(JSON.stringify(searchParams));
            const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${targetEnv.id}/deployments/${apiInstanceInfo.deploymentId}/specs/${specIdToTry}/logs/file?search=${searchEncoded}`;
            const logsRes = await loggedFetch(logsUrl, {
              method: "GET",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (logsRes.ok) {
              const logsText = await logsRes.text();
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

            // Approach 0: Resolve AMC deployment by name (list deployments and match broker name)
            if (brokerName) {
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
                      // Use provided specId
                      specId = approach.specId;
                      debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Using provided specId:`, specId);
                    } else {
                      continue; // Try next approach
                    }
                  }
                } else if (approach.specId) {
                  specId = approach.specId;
                  debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Using provided specId:`, specId);
                }
                
                if (specId) {
                  const searchParams = {
                    startTime,
                    endTime,
                    length: 10000,
                    descending: true,
                  };
                  const searchEncoded = encodeURIComponent(JSON.stringify(searchParams));
                  const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${approach.deploymentId}/specs/${specId}/logs/file?search=${searchEncoded}`;

                  debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Fetching logs from:`, logsUrl.replace(/Bearer\s+\S+/, "Bearer [REDACTED]"));
                  const logsRes = await loggedFetch(logsUrl, {
                    method: "GET",
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  });

                  if (logsRes.ok) {
                    const logsText = await logsRes.text();
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Successfully fetched logs, length:`, logsText.length, "chars");
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": First 500 chars:`, logsText.substring(0, 500));
                    
                    // Parse logs
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
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Failed to fetch logs, status:`, logsRes.status);
                    const errorText = await logsRes.text().catch(() => "");
                    debugLog(`[NO-ENTITLEMENT] Approach "${approach.name}": Error response:`, errorText.substring(0, 200));
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
  // Authentication check using unified session functions
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt) {
    return NextResponse.json({ error: "Session invalidated" }, { status: 401 });
  }

  if (!session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  
  // Parse and validate request body with Zod
  const body = await request.json();
  const parseResult = BrokerTasksRequestSchema.safeParse(body);
  
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parseResult.error.format(),
      },
      { status: 400 }
    );
  }
  
  const { orgId, apiInstanceId, timeRangeMs = 24 * 3600 * 1000 } = parseResult.data;
  
  // Enforce 7-day maximum to match Visualizer API limit
  const maxTimeRangeMs = 7 * 24 * 3600 * 1000; // 7 days
  const timeRange = Math.min(timeRangeMs, maxTimeRangeMs);

  try {
    // Build Lucene query - filter by orgId first, then apiInstanceId and taskId
    // Since we're searching all indices, we need to filter by orgId in the query
    // IMPORTANT: apiInstanceId must be quoted if it contains special characters, but for numeric IDs we can use it directly
    const luceneQuery = `orgId=${orgId} AND taskId= AND apiInstanceId=${apiInstanceId}`;

    debugLog("Broker tasks query:", { orgId, apiInstanceId, luceneQuery, timeRange });

    // Search for logs containing taskId= pattern filtered by apiInstanceId
    const allLogsResult = await msearch(
      orgId,
      luceneQuery,
      { size: 1000, sortOrder: "desc", timeRangeMs: timeRange },
      session.accessToken,
      baseUrl
    );

    // No entitlement: use Runtime Manager + Application Manager logs (standard APIs)
    if (allLogsResult.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
      debugLog("[NO-ENTITLEMENT] Getting broker tasks via runtime logs (no _msearch)");
      try {
        const noEntitlementResult = await getBrokerTasksFromRuntimeLogs(
          orgId,
          apiInstanceId,
          session.accessToken,
          baseUrl,
          timeRange
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

    debugLog("Broker tasks result:", { 
      totalLogs: allLogsResult.total, 
      hitsCount: allLogsResult.hits.length,
      sampleApiInstanceIds: allLogsResult.hits.slice(0, 5).map((h: unknown) => {
        const hit = h as { _source?: { message?: string } };
        const msg = (hit._source?.message as string) || "";
        const match = msg.match(/apiInstanceId=(\d+)/);
        return match ? match[1] : null;
      })
    });

    // Extract unique taskIds from all matching logs
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

    // Process all logs to extract unique taskIds and build task metadata
    for (const h of allLogsResult.hits) {
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

    return NextResponse.json({ 
      tasks: list, 
      source: "_msearch", 
      query: luceneQuery,
      totalTasks: list.length,
      totalLogs: allLogsResult.total,
      filters: { apiInstanceId },
    });
  } catch (error) {
    debugError("Broker tasks API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch broker tasks" },
      { status: 500 }
    );
  }
}
