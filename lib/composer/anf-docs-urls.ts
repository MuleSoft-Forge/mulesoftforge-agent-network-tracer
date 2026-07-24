/** MuleSoft Agent Network YAML reference (2.0). */
export const ANF_YAML_REFERENCE_URL =
  "https://docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference";

export const A2A_INTERFACE_DOCS_URL = `${ANF_YAML_REFERENCE_URL}#interfaces-a2a`;

/** MuleSoft AgentFabric Agent Script reference (2.0). */
export const AF_AGENT_SCRIPT_REFERENCE_URL =
  "https://docs.mulesoft.com/agent-network/latest/af-agent-script-reference";

/** Deep links into the Agent Script reference, keyed by graph node kind. */
export const NODE_DOCS_URL: Record<string, string> = {
  trigger: `${AF_AGENT_SCRIPT_REFERENCE_URL}#a2a-trigger`,
  generator: `${AF_AGENT_SCRIPT_REFERENCE_URL}#generator-node`,
  orchestrator: `${AF_AGENT_SCRIPT_REFERENCE_URL}#orchestrator-node`,
  subagent: `${AF_AGENT_SCRIPT_REFERENCE_URL}#subagent-node`,
  executor: `${AF_AGENT_SCRIPT_REFERENCE_URL}#executor-node`,
  router: `${AF_AGENT_SCRIPT_REFERENCE_URL}#router-node`,
  echo: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
};
