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
  "metadata": {
    "variables": {
      "stylingAgent": {
        "url": {
          "description": "Styling A2A agent URL",
          "default": "https://www.a2d-ai.com/api/platform/71ffb179-20e9-4cdc-8ba3-f4fd4abdc2e1/a2a",
          "secret": false
        }
      },
      "availabilityAgent": {
        "url": {
          "description": "Availability A2A agent URL",
          "default": "https://www.a2d-ai.com/api/platform/8e503ffc-8e5f-480d-aa3b-8421b572a5a2/a2a",
          "secret": false
        }
      },
      "loyaltyAgent": {
        "url": {
          "description": "Loyalty A2A agent URL",
          "default": "https://www.a2d-ai.com/api/platform/dbebcf30-1327-4fcb-b8cd-525c2f37417c/a2a",
          "secret": false
        }
      },
      "customerMcp": {
        "url": {
          "description": "Customer MCP server URL",
          "default": "https://www.a2d-ai.com/api/platform/5b9581fd-ffae-460f-a21a-d8a3afab99fb",
          "secret": false
        }
      },
      "orderMcp": {
        "url": {
          "description": "Order MCP server URL",
          "default": "https://www.a2d-ai.com/api/platform/8bbb5f18-1a6d-4d10-baca-fe3873f88cf7",
          "secret": false
        }
      },
      "openai": {
        "url": {
          "description": "OpenAI (or proxy) base URL",
          "default": "https://llm-proxy.workshops.mulesoft.com/openai/v1/",
          "secret": false
        },
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
  "assetId": "vogue-premiere-broker-v2-template",
  "version": "0.0.0"
}
`;

export const AGENT_YAML = `agentNetwork: 2.0.0
info:
  label: Vogue Premiere Agent Network
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
              url: \${stylingAgent.url}
              protocolVersion: 0.3.0
              name: Styling Agent
              version: 1.0.0
              description: Recommends complete outfits for the customer.
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
              url: \${availabilityAgent.url}
              protocolVersion: 0.3.0
              name: Availability Agent
              version: 1.0.0
              description: Verifies stock and sizes across Product 360 and the OMS.
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
              url: \${loyaltyAgent.url}
              protocolVersion: 0.3.0
              name: Loyalty Agent
              version: 1.0.0
              description: Applies tier-specific loyalty perks.
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
    customerMcp:
      info:
        label: Customer MCP Server
      metadata:
        transport:
          kind: streamableHttp
          path: /mcp
    orderMcp:
      info:
        label: Order MCP Server
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
    customer_mcp_connection:
      kind: mcp
      ref:
        name: customerMcp
      url: \${customerMcp.url}
    order_mcp_connection:
      kind: mcp
      ref:
        name: orderMcp
      url: \${orderMcp.url}
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
          version: 1.0.0
          description: A personal luxury fashion assistant that handles styling, availability, loyalty, and orders.
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
              tags:
                - styling
                - loyalty
                - orders
                - vogue
              examples:
                - Hi, this is Alex Chen. I have a dinner in Napa next Saturday and I'm looking for an outfit that's nicer than business casual, but not a full suit
                - Can you check if all those products are available in my size?
                - Show me my loyalty perks
                - Place the order for the whole outfit.
              inputModes:
                - application/json
                - text/plain
              outputModes:
                - application/json
                - text/plain
          supportedInterfaces:
            - url: https://myOmniGateway/vogue_premiere/
              protocolVersion: "1.0"
              protocolBinding: HTTP+JSON
`;

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

actions:
  fetch_customer_profile:
    target: "mcp://customer_mcp_connection"
    kind: "mcp:tool"
    tool_name: "get_customer_profile"
    inputs:
      customer_name: string

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
    target: "mcp://order_mcp_connection"
    kind: "mcp:tool"
    tool_name: "get_shipping_status"
    inputs:
      orderId: string

  place_order:
    target: "mcp://order_mcp_connection"
    kind: "mcp:tool"
    tool_name: "post_order"
    inputs:
      customerName: string

trigger customerTrigger:
  kind: "a2a"
  target: "brokers://vogue_premiere/a2a"
  on_message: ->
    transition to @executor.fetchProfile

executor fetchProfile:
  description: "Calls the mock Customer MCP, which unconditionally returns Alex Chen. The \`customer_name\` input is required by the MCP but ignored by the mock."
  do: ->
    run @actions.fetch_customer_profile
      with customer_name = ""
  on_exit: ->
    transition to @generator.classifyIntent

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

subagent stylingSubagent:
  description: "Delegates to the Styling Agent for outfit recommendations."
  label: "Styling Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are a styling coordinator for Vogue Premiere.
      Step 1: Send the customer's full request to style_advisor (the Styling Agent).
      Step 2: Return the Styling Agent's recommendation as the summary output.
  reasoning:
    instructions: ->
      | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      style_advisor: @actions.send_to_styling_agent
    outputs:
      properties:
        summary:
          type: "string"
          description: "The personalized styling recommendation from the Styling Agent"
    max_number_of_loops: 3
    task_timeout_secs: 60
  on_exit: ->
    transition to @generator.stylingSummary

generator stylingSummary:
  description: "Generates the styling reply."
  system:
    instructions: |
      You generate warm, exclusive, personalized styling replies for Vogue Premiere customers.
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Styling recommendation: {!@subagent.stylingSubagent.output.summary}
  on_exit: ->
    transition to @echo.stylingResponse

echo stylingResponse:
  description: "echo stylingResponse"
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart(@generator.stylingSummary.output)]})

subagent availabilitySubagent:
  description: "Delegates to the Availability Agent for stock and sizing checks."
  label: "Availability Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are an availability coordinator for Vogue Premiere.
      Step 1: Send the customer's full request to check_availability (the Availability Agent) for a stock, sizing, and inventory check.
      Step 2: Return the Availability Agent's response as the summary output.
  reasoning:
    instructions: ->
      | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      check_availability: @actions.send_to_availability_agent
    outputs:
      properties:
        summary:
          type: "string"
          description: "The availability information from the Availability Agent"
    max_number_of_loops: 3
    task_timeout_secs: 60
  on_exit: ->
    transition to @generator.availabilitySummary

generator availabilitySummary:
  description: "Generates the availability reply."
  system:
    instructions: |
      You generate warm, exclusive, personalized availability replies for Vogue Premiere customers.
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Availability check result: {!@subagent.availabilitySubagent.output.summary}
  on_exit: ->
    transition to @echo.availabilityResponse

echo availabilityResponse:
  description: "echo availabilityResponse"
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart(@generator.availabilitySummary.output)]})

subagent loyaltySubagent:
  description: "Handles loyalty program queries by delegating to the Loyalty Agent."
  label: "Loyalty Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are a loyalty program assistant for Vogue Premiere.
      Step 1: Send the customer's full request to loyalty_lookup (the Loyalty Agent) to retrieve their points balance, rewards, and membership tier.
      Step 2: Return the Loyalty Agent's response as the summary output.
  reasoning:
    instructions: ->
      | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      loyalty_lookup: @actions.send_to_loyalty_agent
    outputs:
      properties:
        summary:
          type: "string"
          description: "The loyalty program information from the Loyalty Agent"
    max_number_of_loops: 3
    task_timeout_secs: 30
  on_exit: ->
    transition to @generator.loyaltySummary

generator loyaltySummary:
  description: "Generates the loyalty reply."
  system:
    instructions: |
      You generate warm, exclusive, personalized loyalty replies for Vogue Premiere customers.
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Loyalty information: {!@subagent.loyaltySubagent.output.summary}
  on_exit: ->
    transition to @echo.loyaltyResponse

echo loyaltyResponse:
  description: "echo loyaltyResponse"
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart(@generator.loyaltySummary.output)]})

subagent orderSubagent:
  description: "Retrieves the status of an existing order using the Order MCP."
  label: "Order Status Subagent"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are an order status assistant for Vogue Premiere.
      Step 1: Extract the order ID from the customer's message.
      Step 2: Call check_order_status with the extracted order ID.
      Step 3: Return the order status details as the summary output. If no order ID is found in the message, set summary to "No order ID provided. Please share your order number and I will look it up for you."
  reasoning:
    instructions: ->
      | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      check_order_status: @actions.get_order_status
        with orderId = ...
    outputs:
      properties:
        summary:
          type: "string"
          description: "The order status information retrieved from the Order MCP"
    max_number_of_loops: 3
  on_exit: ->
    transition to @generator.orderStatusSummary

generator orderStatusSummary:
  description: "Generates the order status reply."
  system:
    instructions: |
      You generate warm, exclusive, personalized order status replies for Vogue Premiere customers.
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Order status result: {!@subagent.orderSubagent.output.summary}
  on_exit: ->
    transition to @echo.orderStatusResponse

echo orderStatusResponse:
  description: "echo orderStatusResponse"
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart(@generator.orderStatusSummary.output)]})

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
  description: "Places the order via the Order MCP tool. Irreversible — gated by orderConfirmRouter."
  do: ->
    run @actions.place_order
      with customerName = "Alex Chen"
  on_exit: ->
    transition to @echo.orderPlacedEcho

orchestrator multiOrchestrator:
  description: "Handles multi-intent requests by coordinating styling, availability, and loyalty agents."
  label: "Multi-Intent Orchestrator"
  llm: @llm.openai_mini
  system:
    instructions: |
      You are a multi-intent coordinator for Vogue Premiere. The customer's request spans multiple areas. Follow these steps:

      Step 1: Identify which of the following intents are present: styling, availability, loyalty.
      Step 2: For each identified intent, call the corresponding agent:
        - Styling intent → style_advisor
        - Availability intent → check_availability
        - Loyalty intent → loyalty_lookup
      Step 3: Combine all agent responses into a unified summary output that addresses each intent in the customer's message.
  reasoning:
    instructions: ->
      | Customer request: {!@request.payload.message.parts[0].text}
    actions:
      style_advisor: @actions.send_to_styling_agent
      check_availability: @actions.send_to_availability_agent
      loyalty_lookup: @actions.send_to_loyalty_agent
    outputs:
      properties:
        summary:
          type: "string"
          description: "A unified response combining all relevant agent outputs"
    max_number_of_loops: 8
    task_timeout_secs: 90
  on_exit: ->
    transition to @generator.multiSummary

generator multiSummary:
  description: "Generates the multi-intent reply."
  system:
    instructions: |
      You generate warm, exclusive, personalized multi-intent replies for Vogue Premiere customers.
  prompt: ->
    | Original customer request: {!@request.payload.message.parts[0].text}. Combined agent results: {!@orchestrator.multiOrchestrator.output.summary}
  on_exit: ->
    transition to @echo.multiResponse

echo multiResponse:
  description: "echo multiResponse"
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({messageId: uuid(), parts: [a2a.textPart(@generator.multiSummary.output)]})

echo confirmationRequiredEcho:
  description: "echo confirmationRequiredEcho"
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart("To complete your order, please confirm with a phrase such as 'place the order' or 'confirm my order'. What would you like to do?")
    ]
  })

echo orderPlacedEcho:
  description: "echo orderPlacedEcho"
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({
    messageId: uuid(),
    parts: [
      a2a.textPart("Your order has been placed successfully. Thank you for shopping with Vogue Premiere. You will receive a confirmation shortly.")
    ]
  })
`;
