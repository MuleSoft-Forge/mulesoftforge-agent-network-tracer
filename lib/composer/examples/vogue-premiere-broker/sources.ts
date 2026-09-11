/**
 * Bundled copy of MuleSoft's Vogue Premiere broker template (Agent Fabric Actionability Workshop).
 * Source: https://actionability.workshops.mulesoft.com/
 *
 * Regenerate: npm run sync:composer-examples
 */

export const EXCHANGE_JSON = `{
  "main": "agent-network.yaml",
  "name": "Vogue Premiere Agent Network",
  "classifier": "agentic-network",
  "organizationId": "{ENTER YOUR ORG ID HERE}",
  "descriptorVersion": "1.0.0",
  "apiVersion": "v1",
  "tags": [
    "agentscript",
    "vogue-premiere"
  ],
  "groupId": "{ENTER YOUR ORG ID HERE}",
  "assetId": "vogue-premiere-broker-v2-template",
  "version": "1.0.0",
  "dependencies": [],
  "metadata": {
    "variables": {
      "stylingAgent": {
        "url": {
          "description": "Styling A2A agent URL (v2 mock — filters on 'Customer: <username>' inlined in message text).",
          "default": "https://www.a2d-ai.com/api/platform/06a61882-fe1f-4b17-8cdd-6cf8e21e5846/a2a",
          "secret": false
        }
      },
      "availabilityAgent": {
        "url": {
          "description": "Availability A2A agent URL (v2 mock — filters on 'Customer: <username>' inlined in message text).",
          "default": "https://www.a2d-ai.com/api/platform/1b1d4d65-7d31-4d39-b7cc-a0d8bf902aec/a2a",
          "secret": false
        }
      },
      "loyaltyAgent": {
        "url": {
          "description": "Loyalty A2A agent URL (v2 mock — filters on 'Customer: <username>' inlined in message text).",
          "default": "https://www.a2d-ai.com/api/platform/e1361d2a-fe3e-4c42-9eb4-f229b05089db/a2a",
          "secret": false
        }
      },
      "commerceMcp": {
        "url": {
          "description": "Commerce MCP server URL (CloudHub-deployed Mule app that validates JWTs and enforces persona ownership via SQL). Exposes get_customer_profile, get_shipping_status, and create_order.",
          "default": "https://commerce-mcp-4sx6ke.rajrd4-2.usa-e1.cloudhub.io",
          "secret": false
        }
      },
      "oboKeycloak": {
        "tokenEndpoint": {
          "description": "Keycloak token endpoint for OBO token exchange (RFC 8693).",
          "default": "https://lemur-12.cloud-iam.com/auth/realms/vogue-premiere-ws/protocol/openid-connect/token",
          "secret": false
        },
        "clientId": {
          "description": "Confidential OBO client id (also the target audience commerce-mcp-obo).",
          "default": "commerce-mcp-obo",
          "secret": false
        },
        "clientSecret": {
          "description": "Confidential OBO client secret.",
          "secret": true
        }
      },
      "openai": {
        "url": {
          "description": "OpenAI (or proxy) base URL.",
          "default": "https://api.openai.com/v1/",
          "secret": false
        },
        "apiKey": {
          "description": "OpenAI API key",
          "secret": true
        }
      }
    }
  }
}
`;

export const AGENT_YAML = `agentNetwork: 2.0.0
info:
  label: "Vogue Premiere Agent Network"
  version: v1
registry:
  agents:
    stylingAgent:
      info:
        label: Styling Agent
      metadata:
        platform: Other
        interfaces:
          a2a_v03:
            card:
              name: Styling Agent
              description: Recommends complete outfits for the customer.
              url: \${stylingAgent.url}
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
                - id: styling-recommend-outfit
                  name: Recommend Outfit
                  description: Recommends a complete outfit for a customer's occasion.
                  tags:
                    - styling
                  inputModes:
                    - application/json
                    - text/plain
                  outputModes:
                    - application/json
                    - text/plain
    availabilityAgent:
      info:
        label: Availability Agent
      metadata:
        platform: Other
        interfaces:
          a2a_v03:
            card:
              name: Availability Agent
              description: Verifies stock and sizes across Product 360 and the OMS.
              url: \${availabilityAgent.url}
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
                - id: availability-check-stock
                  name: Check Availability
                  description: Verifies stock and size availability for products.
                  tags:
                    - availability
                  inputModes:
                    - application/json
                    - text/plain
                  outputModes:
                    - application/json
                    - text/plain
    loyaltyAgent:
      info:
        label: Loyalty Agent
      metadata:
        platform: Other
        interfaces:
          a2a_v03:
            card:
              name: Loyalty Agent
              description: Applies tier-specific loyalty perks.
              url: \${loyaltyAgent.url}
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
                - id: loyalty-apply-perks
                  name: Apply Loyalty Perks
                  description: Applies tier-specific perks to the customer.
                  tags:
                    - loyalty
                  inputModes:
                    - application/json
                    - text/plain
                  outputModes:
                    - application/json
                    - text/plain
  mcps:
    commerceMcp:
      info:
        label: Commerce MCP Server
      metadata:
        transport:
          kind: streamableHttp
          path: /mcp
  llms:
    openai:
      info:
        label: OpenAI
      metadata:
        platform: OpenAI
context:
  connections:
    styling_agent_connection:
      kind: a2a
      ref:
        name: stylingAgent
      url: \${stylingAgent.url}
    availability_agent_connection:
      kind: a2a
      ref:
        name: availabilityAgent
      url: \${availabilityAgent.url}
    loyalty_agent_connection:
      kind: a2a
      ref:
        name: loyaltyAgent
      url: \${loyaltyAgent.url}
    commerce_mcp_connection:
      kind: mcp
      ref:
        name: commerceMcp
      url: \${commerceMcp.url}
      authentication:
        kind: oauth2-obo
        flow: oauth2-token-exchange
        timeout: 50000
        tokenEndpoint: \${oboKeycloak.tokenEndpoint}
        clientId: \${oboKeycloak.clientId}
        clientSecret: \${oboKeycloak.clientSecret}
        targetType: audience
        targetValue: commerce-mcp-obo
        scope: openid
    openai_connection:
      kind: llm
      ref:
        name: openai
      url: \${openai.url}
      authentication:
        kind: apiKey
        apiKey: \${openai.apiKey}
brokers:
  vogue_premiere:
    kind: AgentScript
    implementation: ./brokers/vogue_premiere.agent
    interfaces:
      a2a:
        card:
          name: Vogue Premiere Styling Concierge
          description: A personal luxury fashion assistant that handles styling, availability, loyalty, and orders.
          version: 1.0.0
          capabilities:
            streaming: true
            pushNotifications: false
          defaultInputModes:
            - application/json
            - text/plain
          defaultOutputModes:
            - application/json
            - text/plain
          skills:
            - id: vogue-style-concierge
              name: Vogue Style Concierge
              description: Handles customer-facing styling, availability, loyalty, and order interactions for Vogue Premiere.
              examples:
                - "I have a dinner in Napa next Saturday."
                - "What loyalty perks do I have?"
                - "Are these all in stock in my size?"
                - "Place the order"
              tags:
                - styling
                - loyalty
                - orders
                - vogue
              inputModes:
                - application/json
                - text/plain
              outputModes:
                - application/json
                - text/plain`;

export const BROKER_AGENT = `# @dialect: AGENTFABRIC=1.0

system:
  instructions: "You are Vogue Premiere, a personal luxury fashion AI assistant. You help high-value customers with personalized styling advice, product availability checks, loyalty rewards, and order management. Every response you deliver feels exclusive, warm, and tailored to the individual customer."

config:
  agent_name: "vogue_premiere"
  default_llm: @llm.openai_mini

llm:
  openai_mini:
    target: "llm://openai_connection"
    kind: "OpenAI"
    model: "gpt-5-mini"


# -- ACTION DEFINITIONS -------------------------------------------------------

actions:
  fetch_customer_profile:
    target: "mcp://commerce_mcp_connection"
    kind: "mcp:tool"
    tool_name: "get_customer_profile"

  send_to_styling_agent:
    target: "a2a://styling_agent_connection"
    kind: "a2a:send_message"

  send_to_availability_agent:
    target: "a2a://availability_agent_connection"
    kind: "a2a:send_message"

  send_to_loyalty_agent:
    target: "a2a://loyalty_agent_connection"
    kind: "a2a:send_message"

  get_order_status:
    target: "mcp://commerce_mcp_connection"
    kind: "mcp:tool"
    tool_name: "get_shipping_status"
    inputs:
      order_id: string

  place_order:
    target: "mcp://commerce_mcp_connection"
    kind: "mcp:tool"
    tool_name: "create_order"
    inputs:
      items: string


# -- TRIGGER ------------------------------------------------------------------

trigger customerTrigger:
  kind: "a2a"
  target: "brokers://vogue_premiere/a2a"
  on_message: ->
    transition to @executor.fetchProfile


# -- STEP 1: FETCH CUSTOMER PROFILE ------------------------------------------
# Deterministic executor: calls Commerce MCP to fetch the authenticated
# customer's profile. Identity comes from the JWT — no input args. The
# OBO-exchanged token (injected by commerce_mcp_connection's oauth2-obo config)
# carries sub, which Commerce MCP decodes to return the correct persona's profile.
# Downstream nodes reference @executor.fetchProfile.output.username to inline
# the authenticated identity into A2A mock messages and other actions.

executor fetchProfile:
  description: "Calls Commerce MCP get_customer_profile. Identity travels in the OBO-exchanged token injected by the commerce_mcp_connection oauth2-obo config. Returns the authenticated persona's profile."
  do: ->
    run @actions.fetch_customer_profile
      with http_headers = {"Authorization": @request.headers["Authorization"]}
  on_exit: ->
    transition to @generator.classifyIntent


# -- STEP 2: INTENT CLASSIFICATION -------------------------------------------

generator classifyIntent:
  description: "Classifies the customer's primary intent."
  label: "Classify Intent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are an intent classifier for Vogue Premiere. Your only job is to pick the customer's primary intent and emit it as a structured output.

      Classify as exactly ONE of:
      - "styling" — outfit or styling advice for an occasion
      - "availability" — product stock, availability, or sizing
      - "loyalty" — loyalty points, rewards, or membership tier
      - "order_status" — status of an existing order
      - "order_commit" — placing or confirming an order
      - "multi" — message spans two or more of the above intents clearly

      Rules:
      - Always pick one label. Even if the message is short, vague, or references unnamed items ("those items", "these", "it"), pick your best guess based on the words present. A downstream specialist agent will handle the actual work — it can ask the customer for clarification if needed.
      - Do NOT ask the customer any questions. Do NOT explain your reasoning. Do NOT include any assistant text.
      - The structured output alone is your response. Emit intent and stop.
      - ALWAYS set the completion flags exactly as follows: additionalInputRequired=false, goalComplete=true, goalFailed=false, authRequired=false. NEVER set additionalInputRequired=true — downstream specialists handle any clarification. Your job is classify-and-emit only.
  prompt: ->
    | {!@request.payload.message.parts[0].text}
  outputs:
    properties:
      intent:
        type: "string"
        description: "The classified primary intent"
        enum:
          - "styling"
          - "availability"
          - "loyalty"
          - "order_status"
          - "order_commit"
          - "multi"
  on_exit: ->
    transition to @router.intentRouter


# -- STEP 3: INTENT ROUTING ---------------------------------------------------

router intentRouter:
  description: "Routes the request to the appropriate handler based on the classified intent."
  routes:
    - target: @subagent.stylingSubagent
      when: @generator.classifyIntent.output.intent == "styling"
      label: "Styling"
    - target: @subagent.availabilitySubagent
      when: @generator.classifyIntent.output.intent == "availability"
      label: "Availability"
    - target: @subagent.loyaltySubagent
      when: @generator.classifyIntent.output.intent == "loyalty"
      label: "Loyalty"
    - target: @subagent.orderSubagent
      when: @generator.classifyIntent.output.intent == "order_status"
      label: "Order Status"
    - target: @generator.confirmIntent
      when: @generator.classifyIntent.output.intent == "order_commit"
      label: "Order Commit"
  otherwise:
    target: @orchestrator.multiOrchestrator


# -- STYLING PATH -------------------------------------------------------------

subagent stylingSubagent:
  description: "Delegates to the Styling Agent for outfit recommendations. Inlines the authenticated username so the mock's persona filter can route to the correct scenario."
  label: "Styling Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are a styling coordinator for Vogue Premiere.
      Step 1: Send the customer's full request to style_advisor (the Styling Agent). Keep the "Customer: <username>" prefix intact — the downstream mock filters on it.
      Step 2: Return the Styling Agent's recommendation as the summary output.
  reasoning:
    instructions: ->
      | Customer: {!@executor.fetchProfile.output.username} | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      style_advisor: @actions.send_to_styling_agent
    max_number_of_loops: 3
    task_timeout_secs: 60
    outputs:
      properties:
        summary:
          type: "string"
          description: "The personalized styling recommendation from the Styling Agent"
  on_exit: ->
    transition to @generator.stylingSummary

generator stylingSummary:
  description: "Generates the styling reply."
  system:
    instructions: "You generate warm, exclusive, personalized styling replies for Vogue Premiere customers."
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Styling recommendation: {!@subagent.stylingSubagent.output.summary}
  on_exit: ->
    transition to @echo.stylingResponse

echo stylingResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart(@generator.stylingSummary.output),
      a2a.dataPart({
        data: {
          "intent": "styling",
          "identity": @executor.fetchProfile.output.username,
          "obo_exchanged_token": @executor.fetchProfile.output.obo_exchanged_token,
          "nodes_json": "[\\"fetchProfile\\", \\"classifyIntent\\", \\"stylingSubagent\\", \\"stylingSummary\\"]",
          "agents_called_json": "[\\"commerce_mcp_connection\\", \\"styling_agent_connection\\"]",
          "tools_called_json": "[\\"get_customer_profile\\"]",
          "llm_calls_json": "[\\"classifyIntent\\", \\"stylingSubagent\\", \\"stylingSummary\\"]"
        }
      })
    ]
  })


# -- AVAILABILITY PATH --------------------------------------------------------

subagent availabilitySubagent:
  description: "Delegates to the Availability Agent for stock and sizing checks. Inlines the authenticated username so the mock's persona filter can route to the correct scenario."
  label: "Availability Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are an availability coordinator for Vogue Premiere.
      Step 1: Send the customer's full request to check_availability (the Availability Agent) for a stock, sizing, and inventory check. Keep the "Customer: <username>" prefix intact — the downstream mock filters on it.
      Step 2: Return the Availability Agent's response as the summary output.
  reasoning:
    instructions: ->
      | Customer: {!@executor.fetchProfile.output.username} | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      check_availability: @actions.send_to_availability_agent
    max_number_of_loops: 3
    task_timeout_secs: 60
    outputs:
      properties:
        summary:
          type: "string"
          description: "The availability information from the Availability Agent"
  on_exit: ->
    transition to @generator.availabilitySummary

generator availabilitySummary:
  description: "Generates the availability reply."
  system:
    instructions: "You generate warm, exclusive, personalized availability replies for Vogue Premiere customers."
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Availability check result: {!@subagent.availabilitySubagent.output.summary}
  on_exit: ->
    transition to @echo.availabilityResponse

echo availabilityResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart(@generator.availabilitySummary.output),
      a2a.dataPart({
        data: {
          "intent": "availability",
          "identity": @executor.fetchProfile.output.username,
          "obo_exchanged_token": @executor.fetchProfile.output.obo_exchanged_token,
          "nodes_json": "[\\"fetchProfile\\", \\"classifyIntent\\", \\"availabilitySubagent\\", \\"availabilitySummary\\"]",
          "agents_called_json": "[\\"commerce_mcp_connection\\", \\"availability_agent_connection\\"]",
          "tools_called_json": "[\\"get_customer_profile\\"]",
          "llm_calls_json": "[\\"classifyIntent\\", \\"availabilitySubagent\\", \\"availabilitySummary\\"]"
        }
      })
    ]
  })


# -- LOYALTY PATH -------------------------------------------------------------

subagent loyaltySubagent:
  description: "Handles loyalty program queries by delegating to the Loyalty Agent. Inlines the authenticated username so the mock's persona filter can route to the correct scenario."
  label: "Loyalty Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are a loyalty program assistant for Vogue Premiere.
      Step 1: Send the customer's full request to loyalty_lookup (the Loyalty Agent) to retrieve their points balance, rewards, and membership tier. Keep the "Customer: <username>" prefix intact — the downstream mock filters on it.
      Step 2: Return the Loyalty Agent's response as the summary output.
  reasoning:
    instructions: ->
      | Customer: {!@executor.fetchProfile.output.username} | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      loyalty_lookup: @actions.send_to_loyalty_agent
    max_number_of_loops: 3
    task_timeout_secs: 30
    outputs:
      properties:
        summary:
          type: "string"
          description: "The loyalty program information from the Loyalty Agent"
  on_exit: ->
    transition to @generator.loyaltySummary

generator loyaltySummary:
  description: "Generates the loyalty reply."
  system:
    instructions: "You generate warm, exclusive, personalized loyalty replies for Vogue Premiere customers."
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Loyalty information: {!@subagent.loyaltySubagent.output.summary}
  on_exit: ->
    transition to @echo.loyaltyResponse

echo loyaltyResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart(@generator.loyaltySummary.output),
      a2a.dataPart({
        data: {
          "intent": "loyalty",
          "identity": @executor.fetchProfile.output.username,
          "obo_exchanged_token": @executor.fetchProfile.output.obo_exchanged_token,
          "nodes_json": "[\\"fetchProfile\\", \\"classifyIntent\\", \\"loyaltySubagent\\", \\"loyaltySummary\\"]",
          "agents_called_json": "[\\"commerce_mcp_connection\\", \\"loyalty_agent_connection\\"]",
          "tools_called_json": "[\\"get_customer_profile\\"]",
          "llm_calls_json": "[\\"classifyIntent\\", \\"loyaltySubagent\\", \\"loyaltySummary\\"]"
        }
      })
    ]
  })


# -- ORDER STATUS PATH --------------------------------------------------------

subagent orderSubagent:
  description: "Retrieves the status of an existing order via Commerce MCP. Commerce MCP enforces ownership at the resource layer — cross-user lookups return access_denied."
  label: "Order Status Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are an order status assistant for Vogue Premiere.
      Step 1: Extract the order_id from the customer's message.
      Step 2: Call check_order_status with the extracted order_id. The authenticated customer's identity travels in the OBO-exchanged token injected by commerce_mcp_connection.
      Step 3: Return the order status details as the summary output. If Commerce MCP returns an access_denied error, surface that to the customer as-is. If no order_id is found in the message, set summary to "No order ID provided. Please share your order number and I will look it up for you."
  reasoning:
    instructions: ->
      | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      check_order_status: @actions.get_order_status
        with order_id = ...
        with http_headers = {"Authorization": @request.headers["Authorization"]}
    max_number_of_loops: 3
    outputs:
      properties:
        summary:
          type: "string"
          description: "The order status information retrieved from Commerce MCP"
  on_exit: ->
    transition to @generator.orderStatusSummary

generator orderStatusSummary:
  description: "Generates the order status reply."
  system:
    instructions: "You generate warm, exclusive, personalized order status replies for Vogue Premiere customers."
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Order status result: {!@subagent.orderSubagent.output.summary}
  on_exit: ->
    transition to @echo.orderStatusResponse

echo orderStatusResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart(@generator.orderStatusSummary.output),
      a2a.dataPart({
        data: {
          "intent": "order_status",
          "identity": @executor.fetchProfile.output.username,
          "obo_exchanged_token": @executor.fetchProfile.output.obo_exchanged_token,
          "nodes_json": "[\\"fetchProfile\\", \\"classifyIntent\\", \\"orderSubagent\\", \\"orderStatusSummary\\"]",
          "agents_called_json": "[\\"commerce_mcp_connection\\"]",
          "tools_called_json": "[\\"get_customer_profile\\", \\"get_shipping_status\\"]",
          "llm_calls_json": "[\\"classifyIntent\\", \\"orderSubagent\\", \\"orderStatusSummary\\"]"
        }
      })
    ]
  })


# -- ORDER COMMIT PATH (ROUTER-GATED) -----------------------------------------

generator confirmIntent:
  description: "Determines whether the customer's message contains an explicit order-placement confirmation phrase."
  label: "Confirm Intent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You determine whether the customer's message contains an explicit order-placement confirmation. Emit a single structured output.

      Set has_explicit_confirmation to "true" ONLY if the message contains an explicit confirmation phrase such as: "place the order", "confirm my order", "go ahead and order", "yes, order it", or "confirm purchase". Otherwise set it to "false".

      Rules:
      - Always emit one value. Never ask the customer questions.
      - Do NOT include any assistant text or reasoning. The structured output is your only response.
      - ALWAYS set the completion flags exactly as follows: additionalInputRequired=false, goalComplete=true, goalFailed=false, authRequired=false. NEVER set additionalInputRequired=true — the router handles what happens next based on has_explicit_confirmation. Your job is emit-and-stop.
  prompt: ->
    | {!@request.payload.message.parts[0].text}
  outputs:
    properties:
      has_explicit_confirmation:
        type: "string"
        description: "True only if the message contains an explicit order confirmation phrase"
  on_exit: ->
    transition to @router.orderConfirmRouter

router orderConfirmRouter:
  description: "Hard gate: only proceeds to order placement when the customer has provided explicit confirmation."
  routes:
    - target: @executor.orderCommitExecutor
      when: @generator.confirmIntent.output.has_explicit_confirmation == "true"
      label: "Confirmed"
  otherwise:
    target: @echo.confirmationRequiredEcho

executor orderCommitExecutor:
  description: "Places the order via Commerce MCP's create_order tool. Identity travels in the OBO-exchanged token injected by commerce_mcp_connection, so the confirmation is persona-scoped. Irreversible — gated by orderConfirmRouter."
  do: ->
    run @actions.place_order
      with items = "your selected items"
      with http_headers = {"Authorization": @request.headers["Authorization"]}
  on_exit: ->
    transition to @echo.orderPlacedEcho


# -- MULTI-INTENT PATH --------------------------------------------------------

orchestrator multiOrchestrator:
  description: "Handles multi-intent requests by coordinating styling, availability, and loyalty agents. Inlines the authenticated username so downstream mocks filter to the correct persona."
  label: "Multi-Intent Orchestrator"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are a multi-intent coordinator for Vogue Premiere. The customer's request spans multiple areas. Follow these steps:

      Step 1: Identify which of the following intents are present: styling, availability, loyalty.
      Step 2: For each identified intent, call the corresponding agent. Keep the "Customer: <username>" prefix intact when forwarding the customer's message — the downstream mocks filter on it.
        - Styling intent → style_advisor
        - Availability intent → check_availability
        - Loyalty intent → loyalty_lookup
      Step 3: Combine all agent responses into a unified summary output that addresses each intent in the customer's message.
  reasoning:
    instructions: ->
      | Customer: {!@executor.fetchProfile.output.username} | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      style_advisor: @actions.send_to_styling_agent
      check_availability: @actions.send_to_availability_agent
      loyalty_lookup: @actions.send_to_loyalty_agent
    max_number_of_loops: 8
    task_timeout_secs: 90
    outputs:
      properties:
        summary:
          type: "string"
          description: "A unified response combining all relevant agent outputs"
  on_exit: ->
    transition to @generator.multiSummary

generator multiSummary:
  description: "Generates the multi-intent reply."
  system:
    instructions: "You generate warm, exclusive, personalized multi-intent replies for Vogue Premiere customers."
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Combined agent results: {!@orchestrator.multiOrchestrator.output.summary}
  on_exit: ->
    transition to @echo.multiResponse

echo multiResponse:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart(@generator.multiSummary.output),
      a2a.dataPart({
        data: {
          "intent": "multi",
          "identity": @executor.fetchProfile.output.username,
          "obo_exchanged_token": @executor.fetchProfile.output.obo_exchanged_token,
          "nodes_json": "[\\"fetchProfile\\", \\"classifyIntent\\", \\"multiOrchestrator\\", \\"multiSummary\\"]",
          "tools_called_json": "[\\"get_customer_profile\\"]",
          "llm_calls_json": "[\\"classifyIntent\\", \\"multiOrchestrator\\", \\"multiSummary\\"]"
        }
      })
    ]
  })


# -- ECHO NODES ---------------------------------------------------------------

echo confirmationRequiredEcho:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart("To complete your order, please confirm with a phrase such as 'place the order' or 'confirm my order'. What would you like to do?"),
      a2a.dataPart({
        data: {
          "intent": "confirmation_required",
          "identity": @executor.fetchProfile.output.username,
          "obo_exchanged_token": @executor.fetchProfile.output.obo_exchanged_token,
          "nodes_json": "[\\"fetchProfile\\", \\"classifyIntent\\", \\"confirmIntent\\"]",
          "agents_called_json": "[\\"commerce_mcp_connection\\"]",
          "tools_called_json": "[\\"get_customer_profile\\"]",
          "llm_calls_json": "[\\"classifyIntent\\", \\"confirmIntent\\"]"
        }
      })
    ]
  })

echo orderPlacedEcho:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart("Your order has been placed successfully. Thank you for shopping with Vogue Premiere. You will receive a confirmation shortly."),
      a2a.dataPart({
        data: {
          "intent": "order_commit",
          "identity": @executor.fetchProfile.output.username,
          "obo_exchanged_token": @executor.fetchProfile.output.obo_exchanged_token,
          "nodes_json": "[\\"fetchProfile\\", \\"classifyIntent\\", \\"confirmIntent\\", \\"orderCommitExecutor\\"]",
          "agents_called_json": "[\\"commerce_mcp_connection\\"]",
          "tools_called_json": "[\\"get_customer_profile\\", \\"create_order\\"]",
          "llm_calls_json": "[\\"classifyIntent\\", \\"confirmIntent\\"]"
        }
      })
    ]
  })`;
