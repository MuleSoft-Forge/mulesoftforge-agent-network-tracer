/**
 * Bundled copy of MuleSoft's IT Help Investigation example.
 * Source: https://github.com/MuleSoft-AI-Chain-Project/example-mule-apps/tree/master/agent-network-2.0-examples/it-investigation-broker-example
 *
 * Regenerate: npm run sync:composer-examples
 */

export const EXCHANGE_JSON = `{
  "main": "agent-network.yaml",
  "name": "it-investigation-network",
  "classifier": "agentic-network",
  "organizationId": "{ENTER YOUR ORG ID HERE}",
  "descriptorVersion": "1.0.0",
  "apiVersion": "v1",
  "tags": [],
  "metadata": {
    "variables": {
      "openai": {
        "apiKey": {
          "description": "OpenAI API key",
          "default": "",
          "secret": true
        }
      }
    }
  },
  "dependencies": [],
  "groupId": "{ENTER YOUR ORG ID HERE}",
  "assetId": "it-investigation-network",
  "version": "0.0.0"
}
`;

export const AGENT_YAML = `agentNetwork: 2.0.0
info:
  label: "IT Help Investigation Agent Network"
  version: v1
registry:
  agents:
    help_center_agent:
      info:
        label: Help Center Agent
      metadata:
        platform: Other
        interfaces:
          a2a_v03:
            card:
              name: Help Center Agent
              description: Searches the IT knowledge base for answers to common issues. Returns relevant articles with step-by-step instructions.
              url: http://localhost:8080/helpCenterAgent
              protocolVersion: 0.3.0
              version: 1.0.0
              capabilities:
                pushNotifications: false
              defaultInputModes:
                - application/json
                - text/plain
              defaultOutputModes:
                - application/json
                - text/plain
              skills:
                - id: knowledge-search
                  name: Knowledge Base Search
                  description: Search for IT help articles and known solutions.
                  tags:
                    - knowledge-base
                    - it-support
                  examples:
                    - How do I reset my VPN password?
                    - My email is not syncing
                    - How do I set up two-factor authentication?
                  inputModes:
                    - application/json
                    - text/plain
                  outputModes:
                    - application/json
                    - text/plain
    license_procurement_agent:
      info:
        label: License Procurement Agent
      metadata:
        platform: Other
        interfaces:
          a2a_v03:
            card:
              name: License Procurement Agent
              description: Checks software license availability and provisions licenses for employees.
              url: http://localhost:8080/licenseProcurementAgent
              protocolVersion: 0.3.0
              version: 1.0.0
              capabilities:
                pushNotifications: false
              defaultInputModes:
                - application/json
                - text/plain
              defaultOutputModes:
                - application/json
                - text/plain
              skills:
                - id: license-check
                  name: License Check and Provision
                  description: Check license availability and provision for a user.
                  tags:
                    - licensing
                    - provisioning
                  examples:
                    - Provision a Figma license for jane.doe@company.com
                    - Check if we have available GitHub Enterprise seats
                    - I need access to Jira
                  inputModes:
                    - application/json
                    - text/plain
                  outputModes:
                    - application/json
                    - text/plain
  mcps:
    escalation_mcp:
      info:
        label: Escalation MCP Server
      metadata:
        transport:
          kind: streamableHttp
          path: /mcp
    jira_mcp:
      info:
        label: Jira MCP Server
      metadata:
        transport:
          kind: streamableHttp
          path: /mcp
  llms:
    openai_mini:
      info:
        label: GPT-5.4 Mini
      metadata:
        platform: OpenAI
    bedrock_openai:
      info:
        label: Bedrock OpenAI
      metadata:
        platform: OpenAI
context:
  connections:
    help_center_agent_connection:
      kind: a2a
      ref:
        name: help_center_agent
      url: https://www.a2d-ai.com/api/platform/a626be9a-c2e8-4c66-b927-08b364d7814d/a2a
    license_procurement_agent_connection:
      kind: a2a
      ref:
        name: license_procurement_agent
      url: https://www.a2d-ai.com/api/platform/de8ab8b5-a2c7-470b-91ba-99ccf191734c/a2a
    escalation_mcp_connection:
      kind: mcp
      ref:
        name: escalation_mcp
      url: https://www.a2d-ai.com/api/platform/7d7ed142-32b5-4589-a285-0da266b85e25/
    jira_mcp_connection:
      kind: mcp
      ref:
        name: jira_mcp
      url: https://www.a2d-ai.com/api/platform/b57202bb-baa0-4b96-aa82-eeb178303da8/
    openai_mini_connection:
      kind: llm
      ref:
        name: openai_mini
      url: https://api.openai.com/v1
      authentication:
        kind: apiKey
        apiKey: \${openai.apiKey}
    # bedrock_openai_connection:
    #   kind: llm
    #   ref:
    #     name: bedrock_openai
    #   url: https://bedrock-mantle.us-east-2.api.aws/openai/v1
    #   authentication:
    #     kind: apiKey
    #     apiKey: \${openai.apiKey}
brokers:
  it_help_investigation:
    kind: AgentScript
    implementation: ./brokers/it-help-investigation.agent
    interfaces:
      a2a:
        card:
          name: IT Help Desk Broker
          description: Triages IT support tickets, escalates critical issues, and resolves common problems through cross-platform investigation.
          version: 1.0.0
          capabilities:
            streaming: false
            pushNotifications: true
          defaultInputModes:
            - text/plain
          defaultOutputModes:
            - text/plain
          skills:
            - id: ticket-triage
              name: IT Ticket Triage
              description: Classifies and resolves IT support tickets.
              tags:
                - it-support
                - help-desk
`;

export const BROKER_AGENT = `# @dialect: AGENTFABRIC=1.0

system:
  instructions: "You are an IT Help Desk agent. You triage incoming support tickets, classify their severity, and either escalate, investigate, or request more information."

config:
  agent_name: "it_help_investigation"
  default_llm: @llm.openai_mini

llm:
  openai_mini:
    target: "llm://openai_mini_connection"
    kind: "OpenAI"
    model: "gpt-5.4-mini"

  # bedrock_openai:
  #   target: "llm://bedrock_openai_connection"
  #   kind: "OpenAI"
  #   model: "openai.gpt-5.5"

# -- ACTION DEFINITIONS -------------------------------------------------------
actions:
  help_center_agent:
    target: "a2a://help_center_agent_connection"
    kind: "a2a:send_message"

  license_procurement_agent:
    target: "a2a://license_procurement_agent_connection"
    kind: "a2a:send_message"

  escalate:
    target: "mcp://escalation_mcp_connection"
    kind: "mcp:tool"
    tool_name: "escalate"

  update_issue:
    target: "mcp://jira_mcp_connection"
    kind: "mcp:tool"
    tool_name: "updateIssue"



# -- TRIGGER -------------------------------------------------------------------
trigger ticketTrigger:
  kind: "a2a"
  target: "brokers://it_help_investigation/a2a"
  on_message: ->
    transition to @generator.classifySeverity


# -- SEVERITY CLASSIFICATION ---------------------------------------------------
generator classifySeverity:
  description: "Classifies the severity of the support ticket."
  label: "Classify Severity"
  # llm: llm.openai_mini
  system:
    instructions: |
      Classify the severity of the incoming IT support ticket and extract the Jira ticket ID.

      Classify as HIGH:
      - System outages affecting multiple users (e.g. "VPN is down for the entire office", "Nobody in Building 3 can connect")
      - Security incidents involving unauthorized access or suspicious activity (e.g. "unauthorized login attempts from an IP in another country")
      - Any blocking issue impacting a team, building, or department

      Classify as LOW:
      - Password resets or connectivity help (e.g. "I forgot my VPN password")
      - Software license or access requests (e.g. "rate limited on my Figma MCP server", "I need access to Tableau")
      - Single-user issues with a clear description

      The ticket_id must always be a string value.
      If no Jira ticket ID is provided in the input, default ticket_id to "JIRA001".
  prompt: ->
    | {!@request.payload.message.parts[0].text}
  outputs:
    properties:
      ticket_id:
        type: "string"
        description: "The Jira ticket ID extracted from the input (e.g. '001' from 'Jira ticket ID 001')"
      severity:
        type: "string"
        description: "The severity level"
        enum:
          - "high"
          - "low"
      reason:
        type: "string"
        description: "Brief explanation of the classification"
  on_exit: ->
    transition to @router.severityRouter


# -- SEVERITY ROUTING ----------------------------------------------------------
router severityRouter:
  description: "Routes based on the classified severity."
  routes:
    - target: @executor.escalateTicket
      when: @generator.classifySeverity.output.severity == "high"
      label: "High"
  otherwise:
    target: @orchestrator.crossPlatformTriage


# -- HIGH: ESCALATION ---------------------------------------------------------
executor escalateTicket:
  description: "Escalates the ticket using the Escalation MCP tool."
  do: ->
    run @actions.escalate
  on_exit: ->
    transition to @echo.escalationResponse

echo escalationResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("Ticket " + @generator.classifySeverity.output.ticket_id + " has been escalated to the on-call team due to high severity: " + @generator.classifySeverity.output.reason)]})


# -- LOW: CROSS-PLATFORM TRIAGE -----------------------------------------------
orchestrator crossPlatformTriage:
  description: "Investigates the ticket using Help Center and License Procurement agents."
  label: "Cross-Platform Triage"
  system:
    instructions: |
      Investigate this low-severity IT support ticket.
      Step 1: Search the Help Center agent for relevant articles or known solutions.
      Step 2: If the issue involves software licensing, check with the License Procurement agent.
      Step 3: Update the Jira ticket with your findings and resolution.
      If you found an answer from the Help Center, set resolution to "help_given".
      If you resolved a licensing issue, set resolution to "license_given".
      If you could not find a solution or the issue requires human intervention, set resolution to "unresolved".
      Always update the Jira ticket with resolution notes.
  reasoning:
    instructions: ->
      | {!@request.payload.message.parts[0].text}
    actions:
      search_help: @actions.help_center_agent
      check_license: @actions.license_procurement_agent
      update_ticket: @actions.update_issue
    outputs:
      properties:
        resolution:
          type: "string"
          description: "The resolution type"
          enum:
            - "help_given"
            - "license_given"
            - "unresolved"
        summary:
          type: "string"
          description: "Summary of the resolution and actions taken"
  on_exit: ->
    transition to @router.resolutionRouter


# -- RESOLUTION ROUTING --------------------------------------------------------
router resolutionRouter:
  description: "Routes based on the resolution type from triage."
  routes:
    - target: @generator.licenseSummary
      when: @orchestrator.crossPlatformTriage.output.resolution == "license_given"
      label: "License Given"
    - target: @executor.escalateUnresolved
      when: @orchestrator.crossPlatformTriage.output.resolution == "unresolved"
      label: "Unresolved"
  otherwise:
    target: @generator.helpSummary


# -- HELP GIVEN PATH ----------------------------------------------------------
generator helpSummary:
  description: "Generates a summary of the help resolution."
  system:
    instructions: "You generate clear, friendly summaries of IT help desk resolutions."
  prompt: ->
    | Generate a resolution summary for the user. Original request: {!@request.payload.message.parts[0].text}. Resolution and actions taken: {!@orchestrator.crossPlatformTriage.output.summary}
  on_exit: ->
    transition to @echo.helpResponse

echo helpResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart(@generator.helpSummary.output)]})


# -- LICENSE GIVEN PATH --------------------------------------------------------
generator licenseSummary:
  description: "Generates a summary of the license provisioning."
  system:
    instructions: "You generate clear, friendly summaries of license provisioning actions."
  prompt: ->
    | Generate a license provisioning summary for the user. Original request: {!@request.payload.message.parts[0].text}. Resolution and actions taken: {!@orchestrator.crossPlatformTriage.output.summary}
  on_exit: ->
    transition to @echo.licenseResponse

echo licenseResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart(@generator.licenseSummary.output)]})


# -- UNRESOLVED PATH -----------------------------------------------------------
executor escalateUnresolved:
  description: "Escalates an unresolved low-severity ticket to a human agent."
  do: ->
    run @actions.escalate
  on_exit: ->
    transition to @echo.unresolvedResponse

echo unresolvedResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("Ticket " + @generator.classifySeverity.output.ticket_id + " could not be resolved automatically and has been escalated to a human agent. Summary: " + @orchestrator.crossPlatformTriage.output.summary)]})
`;
