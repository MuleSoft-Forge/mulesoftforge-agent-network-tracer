/**
 * Central catalog for vendored Agent Network v2 JSON Schemas.
 *
 * - bundle-config.ts: which files belong in the bundle
 * - manifest.json: git provenance + checksums (regenerate via npm run sync:anf-schemas)
 * - *.json: schema documents (validation + UI viewer)
 */

import manifest from "@/lib/composer/schema/anf/manifest.json";
import {
  ANF_BUNDLE_FILE_CONFIG,
  ANF_SPEC_VERSION,
} from "@/lib/composer/schema/anf/bundle-config";
import agentNetworkV2 from "@/lib/composer/schema/anf/agent_network_v2.json";
import a2aV1 from "@/lib/composer/schema/anf/a2a_v1.json";
import a2a from "@/lib/composer/schema/anf/a2a.json";
import references from "@/lib/composer/schema/anf/references.json";
import agentMetadata from "@/lib/composer/schema/anf/agent_metadata.json";
import mcpMetadata from "@/lib/composer/schema/anf/mcp_metadata.json";
import otherCard from "@/lib/composer/schema/anf/other_card.json";
import metadataProvenance from "@/lib/composer/schema/anf/metadata_provenance.json";

export interface AnfSchemaManifestFile {
  filename: string;
  sha256: string;
  sizeBytes: number;
  isRoot?: boolean;
}

export interface AnfSchemaManifest {
  bundleVersion: number;
  specVersion: string;
  source: {
    repository: string;
    remoteUrl: string;
    subpath: string;
    commit: string | null;
    ref: string | null;
    commitDate: string | null;
    syncedAt: string;
  };
  files: AnfSchemaManifestFile[];
}

export interface BundledAnfSchema {
  filename: string;
  title: string;
  description: string;
  document: object;
  sha256: string;
  sizeBytes: number;
  isRoot?: boolean;
}

const SCHEMA_DOCUMENTS: Record<string, object> = {
  "agent_network_v2.json": agentNetworkV2,
  "references.json": references,
  "agent_metadata.json": agentMetadata,
  "mcp_metadata.json": mcpMetadata,
  "a2a.json": a2a,
  "a2a_v1.json": a2aV1,
  "other_card.json": otherCard,
  "metadata_provenance.json": metadataProvenance,
};

export const ANF_SCHEMA_MANIFEST = manifest as AnfSchemaManifest;

function schemaTitle(document: object, fallback: string): string {
  const title = (document as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title : fallback;
}

function configFor(filename: string) {
  return ANF_BUNDLE_FILE_CONFIG.find((f) => f.filename === filename);
}

function buildBundledSchemas(): BundledAnfSchema[] {
  return ANF_SCHEMA_MANIFEST.files.map((file) => {
    const document = SCHEMA_DOCUMENTS[file.filename];
    if (!document) {
      throw new Error(
        `Missing schema import for ${file.filename}. Update catalog.ts when adding to bundle-config.ts.`
      );
    }
    const config = configFor(file.filename);
    return {
      filename: file.filename,
      title: schemaTitle(document, file.filename),
      description: config?.description ?? file.filename,
      document,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      isRoot: file.isRoot,
    };
  });
}

export const BUNDLED_ANF_SCHEMAS = buildBundledSchemas();

export const AGENT_NETWORK_ROOT_SCHEMA =
  BUNDLED_ANF_SCHEMAS.find((s) => s.isRoot)?.document ??
  SCHEMA_DOCUMENTS["agent_network_v2.json"];

/** Referenced schemas keyed by filename (excludes root). Used by Ajv. */
export function referencedSchemasByFilename(): Record<string, object> {
  const map: Record<string, object> = {};
  for (const entry of BUNDLED_ANF_SCHEMAS) {
    if (!entry.isRoot) {
      map[entry.filename] = entry.document;
    }
  }
  return map;
}

export function bundledSchemaByFilename(filename: string): BundledAnfSchema | undefined {
  return BUNDLED_ANF_SCHEMAS.find((s) => s.filename === filename);
}

export function formatBundledSchemaJson(document: object): string {
  return JSON.stringify(document, null, 2);
}

/** Human-readable provenance line for UI. */
export function formatAnfSchemaProvenance(): string {
  const { source, specVersion } = ANF_SCHEMA_MANIFEST;
  const commit = source.commit ? source.commit.slice(0, 12) : "unknown";
  const synced = source.syncedAt.slice(0, 10);
  return `Agent Network spec ${specVersion} · ${source.repository}@${commit} · synced ${synced}`;
}

export function anfSchemaProvenanceDetail(): {
  specVersion: string;
  repository: string;
  remoteUrl: string;
  subpath: string;
  commit: string | null;
  ref: string | null;
  commitDate: string | null;
  syncedAt: string;
  fileCount: number;
} {
  const { source, specVersion, files } = ANF_SCHEMA_MANIFEST;
  return {
    specVersion,
    repository: source.repository,
    remoteUrl: source.remoteUrl,
    subpath: source.subpath,
    commit: source.commit,
    ref: source.ref,
    commitDate: source.commitDate,
    syncedAt: source.syncedAt,
    fileCount: files.length,
  };
}

/** Verify manifest structure matches bundle-config (checksums verified in composer-test). */
export function verifyAnfSchemaManifestStructure(): string[] {
  const errors: string[] = [];
  const configNames = new Set(ANF_BUNDLE_FILE_CONFIG.map((f) => f.filename));
  const manifestNames = new Set(ANF_SCHEMA_MANIFEST.files.map((f) => f.filename));

  for (const name of configNames) {
    if (!manifestNames.has(name)) errors.push(`manifest missing ${name}`);
  }
  for (const name of manifestNames) {
    if (!configNames.has(name)) errors.push(`manifest has unexpected ${name}`);
  }

  const rootCount = ANF_SCHEMA_MANIFEST.files.filter((f) => f.isRoot).length;
  if (rootCount !== 1) errors.push(`expected exactly one isRoot schema, found ${rootCount}`);

  if (ANF_SCHEMA_MANIFEST.specVersion !== ANF_SPEC_VERSION) {
    errors.push(
      `manifest specVersion ${ANF_SCHEMA_MANIFEST.specVersion} != bundle-config ${ANF_SPEC_VERSION}`
    );
  }

  for (const name of configNames) {
    if (!SCHEMA_DOCUMENTS[name]) {
      errors.push(`missing schema import for ${name} in catalog.ts`);
    }
  }

  return errors;
}
