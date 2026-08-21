/**
 * Versioned source-of-truth boundary for AgentScript emitted by the Builder.
 * Keep this manifest aligned with package.json and conformance fixtures.
 */
export const AGENTSCRIPT_CONTRACT = {
  dialect: "AGENTFABRIC",
  defaultDialectVersion: "1.0",
  validatorPackage: "@sf-agentscript/agentfabric-dialect",
  validatorPackageVersion: "1.2.10",
  referenceRevision: "2026-08-19",
  referenceUrl: "https://docs.mulesoft.com/agent-network/latest/af-agent-script-reference",
  /**
   * MuleSoft does not publish a separate semver for the embedded AgentFabric
   * runtime in the referenced material. Runtime compatibility is therefore
   * established by the deploy smoke suite, not by a guessed version literal.
   */
  minimumRuntimeVersion: null,
  knownDisagreements: [
    {
      field: "Gemini thinking_budget",
      reference: "-1 means automatic",
      validator:
        "@sf-agentscript/agentfabric-dialect 1.2.10 rejects unary negative number syntax",
      builderBehavior:
        "Require zero or greater until the pinned validator accepts the documented value",
    },
    {
      field: "Executor run-scoped @outputs",
      reference: "The dialect schema supports assigning action outputs inside a run statement",
      validator:
        "@sf-agentscript/agentfabric-dialect 1.2.10 reports @outputs as an unknown namespace",
      builderBehavior:
        "Ignore only that exact diagnostic when every @outputs reference is inside a nested run capture",
    },
  ],
} as const;

/** Non-deprecated primitive keywords exported by @sf-agentscript/language. */
export const AGENTSCRIPT_ACTION_INPUT_TYPES = [
  "string",
  "number",
  "boolean",
  "object",
  "currency",
  "date",
  "datetime",
  "time",
  "timestamp",
  "integer",
  "long",
] as const;
