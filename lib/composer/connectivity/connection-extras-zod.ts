import { z } from "zod";

export const ConnectionAccessSchema = z.enum(["internal", "shared"]);

export const PolicyRefSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().optional(),
});

export const ConnectionPolicyItemSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ref"),
    name: z.string().min(1),
    namespace: z.string().optional(),
  }),
  z.object({
    mode: z.literal("inline"),
    document: z.record(z.string(), z.unknown()),
  }),
]);

export const ConnectionPoliciesSchema = z.object({
  inbound: z.array(ConnectionPolicyItemSchema).optional(),
  outbound: z.array(ConnectionPolicyItemSchema).optional(),
});
