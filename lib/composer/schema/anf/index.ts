/**
 * Public API for Agent Network v2 schema bundle — validation, display, provenance.
 */

export {
  AGENT_NETWORK_ROOT_SCHEMA,
  ANF_SCHEMA_MANIFEST,
  BUNDLED_ANF_SCHEMAS,
  anfSchemaProvenanceDetail,
  bundledSchemaByFilename,
  formatAnfSchemaProvenance,
  formatBundledSchemaJson,
  referencedSchemasByFilename,
  verifyAnfSchemaManifestStructure,
  type AnfSchemaManifest,
  type AnfSchemaManifestFile,
  type BundledAnfSchema,
} from "@/lib/composer/schema/anf/catalog";

export {
  ANF_BUNDLE_FILE_CONFIG,
  ANF_BUNDLE_FILENAMES,
  ANF_BUNDLE_SOURCE,
  ANF_SPEC_VERSION,
} from "@/lib/composer/schema/anf/bundle-config";

export {
  validateAgentNetworkDoc,
  schemaValidatorBuildError,
  type SchemaIssue,
} from "@/lib/composer/schema/network-schema";

export {
  validateBrokerCardDoc,
  a2aCardSchemaValidatorBuildError,
  agentCardSchemaDefinition,
  formatAgentCardSchemaJson,
  formatA2aV1BundleJson,
} from "@/lib/composer/schema/a2a-card-schema";
