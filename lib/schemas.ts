/**
 * Zod schemas for API request/response validation
 * Provides type safety and runtime validation
 */

import { z } from "zod";

// ============================================================================
// Auth Schemas
// ============================================================================

export const TokenRequestSchema = z.object({
  code: z.string().min(1),
});

export const StateValidationSchema = z.object({
  state: z.string().min(1),
});

// ============================================================================
// Broker Tasks Schemas
// ============================================================================

export const BrokerTasksRequestSchema = z.object({
  orgId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  apiInstanceId: z.string().min(1).max(200),
  envId: z.string().min(1).max(100).optional(),
  timeRangeMs: z.number().int().positive().max(7 * 24 * 3600 * 1000).optional(),
});

export const BrokerTasksResponseSchema = z.object({
  tasks: z.array(z.object({
    taskId: z.string(),
    apiInstanceId: z.string(),
    orgId: z.string(),
    timestamp: z.number().optional(),
  })),
  totalTasks: z.number(),
  source: z.string(),
  query: z.string().optional(),
  filters: z.record(z.unknown()).optional(),
});

// ============================================================================
// Task Callstack Schemas
// ============================================================================

export const TaskCallstackRequestSchema = z.object({
  orgId: z.string().min(1),
  taskId: z.string().min(1),
  apiInstanceId: z.string().min(1).optional(),
  envId: z.string().min(1).optional(),
  skipTraces: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

// ============================================================================
// Brokers in Environment Schemas
// ============================================================================

export const BrokersInEnvironmentRequestSchema = z.object({
  orgId: z.string().min(1),
  environmentId: z.string().min(1),
});

export const BrokerSchema = z.object({
  nodeId: z.string(),
  assetId: z.string(),
  name: z.string(),
  version: z.string().optional(),
  type: z.string().optional(),
});

export const BrokersInEnvironmentResponseSchema = z.object({
  brokers: z.array(BrokerSchema),
  error: z.string().optional(),
});

// ============================================================================
// Profile Schemas
// ============================================================================

const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentName: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  isRoot: z.boolean().optional(),
  isMaster: z.boolean().optional(),
});

export const ProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string(),
  email: z.string().email().optional(),
  organization: OrganizationSchema.optional(),
  memberOfOrganizations: z.array(OrganizationSchema).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

// ============================================================================
// Visualizer Schemas
// ============================================================================

export const VisualizerRequestSchema = z.object({
  environmentType: z.string().nullable().optional(),
  orgIds: z.array(z.string()).optional(),
});

// ============================================================================
// Accounts/Organizations Schemas
// ============================================================================

export const EnvironmentSchema = z.object({
  id: z.string(),
  isProduction: z.boolean().optional(),
  name: z.string().optional(),
});

export const EnvironmentsResponseSchema = z.object({
  data: z.array(EnvironmentSchema).optional(),
});

// ============================================================================
// Exchange Schemas
// ============================================================================

export const ExchangeIconRequestSchema = z.object({
  path: z.string().min(1),
});

export const ExchangeAssetRequestSchema = z.object({
  organizationId: z.string().min(1).optional(),
  assetId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
}).refine(
  (data) => (data.organizationId && data.assetId && data.version) || data.path,
  {
    message: "Either provide organizationId, assetId, and version, or provide path",
  }
);

export const ExchangeMetadataRequestSchema = z.object({
  organizationId: z.string().min(1).optional(),
  assetId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
}).refine(
  (data) => (data.organizationId && data.assetId && data.version) || data.path,
  {
    message: "Either provide organizationId, assetId, and version, or provide path",
  }
);
