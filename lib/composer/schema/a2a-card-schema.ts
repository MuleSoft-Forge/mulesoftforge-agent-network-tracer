/**
 * Schema validation for brokers.*.interfaces.a2a.card against
 * a2a_v1.json#/definitions/Agent Card (bundled from agent-fabric-specification).
 */

import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import a2aV1 from "@/lib/composer/schema/anf/a2a_v1.json";
import { collectSchemaIssues, type SchemaIssue } from "@/lib/composer/schema/schema-issues";

let validator: ValidateFunction | null = null;
let buildError: string | null = null;

function getValidator(): ValidateFunction | null {
  if (validator || buildError) return validator;
  try {
    const ajv = new Ajv({
      strict: false,
      allErrors: true,
      validateFormats: false,
      allowUnionTypes: true,
    });
    ajv.addSchema(a2aV1, "a2a_v1.json");
    validator = ajv.compile({ $ref: "a2a_v1.json#/definitions/Agent Card" });
    return validator;
  } catch (e) {
    buildError = (e as Error).message;
    return null;
  }
}

/** Validate a serialized Agent Card object against a2a_v1.json. */
export function validateBrokerCardDoc(card: unknown): SchemaIssue[] {
  const validate = getValidator();
  if (!validate) return [];
  if (validate(card)) return [];
  return collectSchemaIssues(validate.errors);
}

export function a2aCardSchemaValidatorBuildError(): string | null {
  getValidator();
  return buildError;
}

/** The Agent Card definition from the bundled a2a_v1.json schema. */
export function agentCardSchemaDefinition(): Record<string, unknown> {
  const defs = (a2aV1 as { definitions?: Record<string, unknown> }).definitions;
  const card = defs?.["Agent Card"];
  return card && typeof card === "object" ? (card as Record<string, unknown>) : {};
}

export function formatAgentCardSchemaJson(): string {
  return JSON.stringify(agentCardSchemaDefinition(), null, 2);
}

export function formatA2aV1BundleJson(): string {
  return JSON.stringify(a2aV1, null, 2);
}
