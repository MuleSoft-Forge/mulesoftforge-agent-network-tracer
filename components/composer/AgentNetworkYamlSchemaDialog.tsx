"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, X } from "lucide-react";
import {
  AGENT_NETWORK_YAML_BROKER,
  AGENT_NETWORK_YAML_COMPOSER_NOTES,
  AGENT_NETWORK_YAML_CONNECTION,
  AGENT_NETWORK_YAML_INFO,
  AGENT_NETWORK_YAML_INTRO,
  AGENT_NETWORK_YAML_SOURCES,
  AGENT_NETWORK_YAML_TOP_LEVEL,
} from "@/lib/composer/docs/agent-network-yaml-schema";
import {
  composerSourceLabel,
  type ExchangeJsonFieldDoc,
  type ExchangeJsonNestedDoc,
} from "@/lib/composer/docs/exchange-json-schema";
import {
  BUNDLED_ANF_SCHEMAS,
  anfSchemaProvenanceDetail,
  formatAnfSchemaProvenance,
  formatBundledSchemaJson,
  validateAgentNetworkDoc,
  schemaValidatorBuildError,
} from "@/lib/composer/schema/anf/index";
import { buildAgentNetworkDoc } from "@/lib/composer/serialize/agent-network-yaml";
import { useComposer } from "@/lib/composer/store";
import { Button } from "@/components/composer/ui";

function FieldTable({ fields }: { fields: ExchangeJsonFieldDoc[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Field</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Builder UI</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {fields.map((f) => (
            <tr key={f.field} className="align-top">
              <td className="px-3 py-2 font-mono text-gray-900">{f.field}</td>
              <td className="px-3 py-2 font-mono text-gray-600">{f.type}</td>
              <td className="px-3 py-2 text-gray-700">{f.composerUi}</td>
              <td className="px-3 py-2 text-gray-600">{composerSourceLabel(f.composerSource)}</td>
              <td className="px-3 py-2 text-gray-600">{f.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NestedSection({ doc }: { doc: ExchangeJsonNestedDoc }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-xs font-semibold text-gray-800">{doc.title}</h3>
      <FieldTable fields={doc.fields} />
    </section>
  );
}

function SchemaValidatorPanel() {
  const { project } = useComposer();
  const buildError = schemaValidatorBuildError();
  const issues = useMemo(
    () => validateAgentNetworkDoc(buildAgentNetworkDoc(project)),
    [project]
  );

  if (buildError) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Schema validator failed to load: {buildError}
      </div>
    );
  }

  const valid = issues.length === 0;

  return (
    <section className="rounded-md border border-gray-200 bg-gray-50/80 p-3">
      <div className="mb-2 flex items-center gap-2">
        {valid ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
        ) : (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-700">
            {issues.length}
          </span>
        )}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Live schema validation
        </h3>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            valid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}
        >
          {valid ? "Valid" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <p className="mb-2 text-xs text-gray-600">
        Validates <span className="font-mono">buildAgentNetworkDoc(project)</span> against{" "}
        <span className="font-mono">agent_network_v2.json</span> (Ajv, non-strict for JSON-LD keywords).
      </p>
      {valid ? (
        <p className="text-xs text-gray-500">Current project projection conforms to the official schema.</p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-auto font-mono text-[11px] text-red-800">
          {issues.map((issue) => (
            <li key={`${issue.path}::${issue.message}`}>
              <span className="text-red-600">{issue.path}</span>: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SchemaProvenancePanel() {
  const detail = anfSchemaProvenanceDetail();
  const commitUrl =
    detail.commit && detail.remoteUrl.includes("github.com")
      ? `${detail.remoteUrl.replace(/\.git$/, "")}/commit/${detail.commit}`
      : null;

  return (
    <section className="rounded-md border border-gray-200 bg-gray-50/80 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
        Bundled schema provenance
      </h3>
      <p className="mb-2 text-xs text-gray-700">{formatAnfSchemaProvenance()}</p>
      <dl className="grid gap-1.5 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Spec version</dt>
          <dd className="font-mono text-gray-800">{detail.specVersion}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Source repository</dt>
          <dd className="font-mono text-gray-800">{detail.repository}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Git commit</dt>
          <dd className="font-mono text-gray-800">
            {detail.commit ? (
              commitUrl ? (
                <a href={commitUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {detail.commit.slice(0, 12)}
                </a>
              ) : (
                detail.commit.slice(0, 12)
              )
            ) : (
              "unknown"
            )}
            {detail.ref ? ` (${detail.ref})` : null}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Commit date</dt>
          <dd className="font-mono text-gray-800">{detail.commitDate ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Synced into Builder</dt>
          <dd className="font-mono text-gray-800">{detail.syncedAt}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Schema files</dt>
          <dd className="font-mono text-gray-800">{detail.fileCount} JSON files · manifest.json</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-gray-500">
        Refresh from upstream with{" "}
        <span className="font-mono">npm run sync:anf-schemas</span> when agent-fabric-specification updates.
      </p>
    </section>
  );
}

function SchemaViewerPanel() {
  const [selected, setSelected] = useState(() => BUNDLED_ANF_SCHEMAS.find((s) => s.isRoot) ?? BUNDLED_ANF_SCHEMAS[0]);
  const [copied, setCopied] = useState(false);

  const formatted = useMemo(
    () => (selected ? formatBundledSchemaJson(selected.document) : ""),
    [selected]
  );

  async function copySchema() {
    if (!formatted) return;
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Official JSON Schema (bundled)
        </h3>
        <Button variant="secondary" onClick={() => void copySchema()} disabled={!formatted}>
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <p className="mb-2 text-xs text-gray-600">
        These are the exact schema files Builder validates against — copied from{" "}
        <span className="font-mono">agent-fabric-schema/src/main/resources/</span>.
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {BUNDLED_ANF_SCHEMAS.map((schema) => (
          <button
            key={schema.filename}
            type="button"
            onClick={() => setSelected(schema)}
            className={`rounded-md px-2 py-1 text-[11px] font-mono transition-colors ${
              selected?.filename === schema.filename
                ? "bg-primary/10 text-primary"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {schema.filename}
          </button>
        ))}
      </div>
          {selected ? (
        <div className="overflow-hidden rounded-md border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-900">{selected.title}</p>
            <p className="text-[11px] text-gray-500">{selected.description}</p>
            <p className="mt-1 font-mono text-[10px] text-gray-400">
              sha256:{selected.sha256.slice(0, 16)}… · {(selected.sizeBytes / 1024).toFixed(1)} KB
            </p>
          </div>
          <pre className="max-h-[min(42vh,28rem)] overflow-auto bg-white p-3 text-[10px] leading-relaxed text-gray-800">
            <code>{formatted}</code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}

export default function AgentNetworkYamlSchemaDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-network-yaml-schema-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="agent-network-yaml-schema-title" className="text-sm font-semibold text-gray-900">
              agent-network.yaml reference
            </h2>
            <p className="mt-1 text-xs text-gray-500">{formatAnfSchemaProvenance()}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4">
          <p className="text-sm leading-relaxed text-gray-700">{AGENT_NETWORK_YAML_INTRO}</p>

          <SchemaValidatorPanel />

          <SchemaProvenancePanel />

          <SchemaViewerPanel />

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Authority sources
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600">
              {AGENT_NETWORK_YAML_SOURCES.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Builder field mapping
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              How Builder UI fields project into the schema shape above (summary only — the JSON Schema is authoritative).
            </p>
            <FieldTable fields={AGENT_NETWORK_YAML_TOP_LEVEL} />
          </section>

          <NestedSection doc={AGENT_NETWORK_YAML_INFO} />
          <NestedSection doc={AGENT_NETWORK_YAML_CONNECTION} />
          <NestedSection doc={AGENT_NETWORK_YAML_BROKER} />

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Builder notes
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-gray-600">
              {AGENT_NETWORK_YAML_COMPOSER_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex justify-end border-t border-gray-200 px-4 py-2.5">
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
