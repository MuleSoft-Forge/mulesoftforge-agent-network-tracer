import { z } from "zod";
import { ConnectionAccessSchema, PolicyRefSchema } from "@/lib/composer/connectivity/connection-extras-zod";

/** Declared policy under context.policies.{bindingName} (agent_network_v2.json PolicyBinding). */
export const DeclaredPolicyBindingSchema = z.object({
  ref: PolicyRefSchema,
  configuration: z.record(z.string(), z.unknown()).default({}),
  access: ConnectionAccessSchema.optional(),
  /** Exchange template version — used to fetch JSON Schema in Composer; omitted from yaml. */
  templateVersion: z.string().nullable().optional(),
});

export const PolicyBindingsMapSchema = z.record(z.string(), DeclaredPolicyBindingSchema).default({});

export type DeclaredPolicyBinding = z.infer<typeof DeclaredPolicyBindingSchema>;
export type PolicyBindingsMap = z.infer<typeof PolicyBindingsMapSchema>;
