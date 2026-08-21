import { z } from "zod";

/** Reference types used inside registry entities (AgentRef, MCPRef, LLMRef, PolicyRef). */
export const NamedRefSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().optional(),
});

export const RegistryUrlEntrySchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
});

export const RegistryInfoSchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const RegistryAgentInterfaceCardSchema = z.object({
  /** Normalized to BrokerCard on import; serialized via serializeBrokerCard. */
  card: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryAgentInterfaceOtherSchema = z.object({
  protocol: z.string().min(1),
  card: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryAgentInterfacesSchema = z.object({
  a2a: RegistryAgentInterfaceCardSchema.optional(),
  a2a_v03: RegistryAgentInterfaceCardSchema.optional(),
  other: RegistryAgentInterfaceOtherSchema.optional(),
});

export const RegistryAgentToolMcpSchema = z.object({
  mcp: z.object({
    ref: NamedRefSchema,
    allowed: z.array(z.string()).optional(),
  }),
});

export const RegistryAgentToolA2aSchema = z.object({
  a2a: z.object({
    ref: NamedRefSchema,
  }),
});

export const RegistryAgentToolSchema = z.union([RegistryAgentToolMcpSchema, RegistryAgentToolA2aSchema]);

export const RegistryAgentMetadataSchema = z.object({
  platform: z.string().min(1),
  interfaces: RegistryAgentInterfacesSchema,
  tools: z.array(RegistryAgentToolSchema).optional(),
  llm: z.object({ ref: NamedRefSchema }).optional(),
  /** Metadata fields not edited in UI — preserved on round-trip. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryAgentEntitySchema = z.object({
  /** Registry map key (agents.<key>). */
  key: z.string().min(1),
  info: RegistryInfoSchema.optional(),
  metadata: RegistryAgentMetadataSchema,
  urls: z.array(RegistryUrlEntrySchema).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryMcpTransportKindSchema = z.enum(["sse", "stdio", "streamableHttp"]);

export const RegistryMcpTransportSchema = z.object({
  kind: RegistryMcpTransportKindSchema,
  ssePath: z.string().optional(),
  messagesPath: z.string().optional(),
  instructions: z.string().optional(),
  path: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryMcpProviderSchema = z.object({
  organization: z.string().optional(),
  url: z.string().optional(),
});

export const RegistryMcpMetadataSchema = z.object({
  protocolVersion: z
    .enum(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"])
    .optional(),
  transport: RegistryMcpTransportSchema,
  provider: RegistryMcpProviderSchema.optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  tools: z.array(z.record(z.string(), z.unknown())).optional(),
  resources: z.array(z.record(z.string(), z.unknown())).optional(),
  resourceTemplates: z.array(z.record(z.string(), z.unknown())).optional(),
  prompts: z.array(z.record(z.string(), z.unknown())).optional(),
  platform: z.string().optional(),
  securitySchemes: z.record(z.string(), z.unknown()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryMcpEntitySchema = z.object({
  key: z.string().min(1),
  info: RegistryInfoSchema.optional(),
  urls: z.array(RegistryUrlEntrySchema).optional(),
  metadata: RegistryMcpMetadataSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryLlmPlatformSchema = z.enum(["Gemini", "OpenAI", "AzureOpenai"]);

export const RegistryLlmMetadataSchema = z.object({
  platform: RegistryLlmPlatformSchema,
  models: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const RegistryLlmEntitySchema = z.object({
  key: z.string().min(1),
  info: RegistryInfoSchema.optional(),
  metadata: RegistryLlmMetadataSchema,
  urls: z.array(RegistryUrlEntrySchema).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const NetworkRegistrySchema = z.object({
  agents: z.array(RegistryAgentEntitySchema).default([]),
  mcps: z.array(RegistryMcpEntitySchema).default([]),
  llms: z.array(RegistryLlmEntitySchema).default([]),
  /** Raw entity entries that did not meet strict parse — merged back on serialize. */
  passthroughAgents: z.record(z.string(), z.unknown()).optional(),
  passthroughMcps: z.record(z.string(), z.unknown()).optional(),
  passthroughLlms: z.record(z.string(), z.unknown()).optional(),
  /** Top-level registry keys not edited in UI — preserved on round-trip. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type NamedRef = z.infer<typeof NamedRefSchema>;
export type RegistryUrlEntry = z.infer<typeof RegistryUrlEntrySchema>;
export type RegistryInfo = z.infer<typeof RegistryInfoSchema>;
export type RegistryAgentInterfaces = z.infer<typeof RegistryAgentInterfacesSchema>;
export type RegistryAgentTool = z.infer<typeof RegistryAgentToolSchema>;
export type RegistryAgentMetadata = z.infer<typeof RegistryAgentMetadataSchema>;
export type RegistryAgentEntity = z.infer<typeof RegistryAgentEntitySchema>;
export type RegistryMcpTransportKind = z.infer<typeof RegistryMcpTransportKindSchema>;
export type RegistryMcpTransport = z.infer<typeof RegistryMcpTransportSchema>;
export type RegistryMcpMetadata = z.infer<typeof RegistryMcpMetadataSchema>;
export type RegistryMcpEntity = z.infer<typeof RegistryMcpEntitySchema>;
export type RegistryLlmMetadata = z.infer<typeof RegistryLlmMetadataSchema>;
export type RegistryLlmEntity = z.infer<typeof RegistryLlmEntitySchema>;
export type NetworkRegistry = z.infer<typeof NetworkRegistrySchema>;
