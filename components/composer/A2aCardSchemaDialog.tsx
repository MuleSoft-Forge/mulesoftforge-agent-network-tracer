"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, X } from "lucide-react";
import {
  A2A_CARD_CAPABILITIES,
  A2A_CARD_COMPOSER_NOTES,
  A2A_CARD_INTRO,
  A2A_CARD_SKILL,
  A2A_CARD_SOURCES,
  A2A_CARD_TOP_LEVEL,
} from "@/lib/composer/docs/a2a-card-schema";
import {
  composerSourceLabel,
  type ExchangeJsonFieldDoc,
  type ExchangeJsonNestedDoc,
} from "@/lib/composer/docs/exchange-json-schema";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { primaryBroker } from "@/lib/composer/model";
import {
  a2aCardSchemaValidatorBuildError,
  agentCardSchemaDefinition,
  formatA2aV1BundleJson,
  formatAgentCardSchemaJson,
  validateBrokerCardDoc,
} from "@/lib/composer/schema/a2a-card-schema";
import { anfSchemaProvenanceDetail, formatAnfSchemaProvenance } from "@/lib/composer/schema/anf/index";
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
            <th className="px-3 py-2">Composer UI</th>
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

function CardValidatorPanel() {
  const { project } = useComposer();
  const broker = primaryBroker(project);
  const buildError = a2aCardSchemaValidatorBuildError();

  const cardDoc = useMemo(
    () => (broker ? serializeBrokerCard(broker.card) : null),
    [broker]
  );

  const issues = useMemo(
    () => (cardDoc ? validateBrokerCardDoc(cardDoc) : []),
    [cardDoc]
  );

  if (!broker) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        No broker in this project — add one to validate an A2A card.
      </div>
    );
  }

  if (buildError) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        A2A card schema validator failed to load: {buildError}
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
        Validates <span className="font-mono">serializeBrokerCard(broker.card)</span> against{" "}
        <span className="font-mono">a2a_v1.json#/definitions/Agent Card</span>.
      </p>
      {valid ? (
        <p className="text-xs text-gray-500">Current broker card conforms to the official A2A v1 Agent Card schema.</p>
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

function SchemaViewerPanel() {
  const [view, setView] = useState<"card" | "bundle">("card");
  const [copied, setCopied] = useState(false);

  const formatted = useMemo(
    () => (view === "card" ? formatAgentCardSchemaJson() : formatA2aV1BundleJson()),
    [view]
  );

  const cardDef = agentCardSchemaDefinition();

  async function copySchema() {
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
        <Button variant="secondary" onClick={() => void copySchema()}>
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <p className="mb-2 text-xs text-gray-600">
        From <span className="font-mono">lib/composer/schema/anf/a2a_v1.json</span> — the Agent Card definition
        referenced by <span className="font-mono">agent_network_v2.json</span>.
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setView("card")}
          className={`rounded-md px-2 py-1 text-[11px] font-mono transition-colors ${
            view === "card" ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Agent Card definition
        </button>
        <button
          type="button"
          onClick={() => setView("bundle")}
          className={`rounded-md px-2 py-1 text-[11px] font-mono transition-colors ${
            view === "bundle" ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          a2a_v1.json (full bundle)
        </button>
      </div>
      <div className="overflow-hidden rounded-md border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-900">
            {view === "card" ? "definitions.Agent Card" : "a2a_v1.json"}
          </p>
          {view === "card" ? (
            <p className="text-[11px] text-gray-500">
              {(cardDef.description as string | undefined) ??
                "A2A v1 agent card — network front door metadata."}
            </p>
          ) : (
            <p className="text-[11px] text-gray-500">Full A2A protocol v1 JSON Schema bundle (proto-derived).</p>
          )}
        </div>
        <pre className="max-h-[min(42vh,28rem)] overflow-auto bg-white p-3 text-[10px] leading-relaxed text-gray-800">
          <code>{formatted}</code>
        </pre>
      </div>
    </section>
  );
}

function ProvenancePanel() {
  const detail = anfSchemaProvenanceDetail();
  return (
    <section className="rounded-md border border-gray-200 bg-gray-50/80 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Schema provenance</h3>
      <p className="text-xs text-gray-700">{formatAnfSchemaProvenance()}</p>
      <p className="mt-2 font-mono text-[11px] text-gray-500">
        File: a2a_v1.json · {detail.fileCount} schemas in bundle · synced {detail.syncedAt.slice(0, 10)}
      </p>
    </section>
  );
}

export default function A2aCardSchemaDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="a2a-card-schema-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="a2a-card-schema-title" className="text-sm font-semibold text-gray-900">
              A2A card reference
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              brokers.*.interfaces.a2a.card · a2a_v1.json#/definitions/Agent Card
            </p>
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
          <p className="text-sm leading-relaxed text-gray-700">{A2A_CARD_INTRO}</p>

          <CardValidatorPanel />
          <ProvenancePanel />
          <SchemaViewerPanel />

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Authority sources</h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600">
              {A2A_CARD_SOURCES.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Composer field mapping
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              How Broker tab fields map to the Agent Card schema. The JSON Schema is authoritative.
            </p>
            <FieldTable fields={A2A_CARD_TOP_LEVEL} />
          </section>

          <NestedSection doc={A2A_CARD_CAPABILITIES} />
          <NestedSection doc={A2A_CARD_SKILL} />

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Composer notes</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-gray-600">
              {A2A_CARD_COMPOSER_NOTES.map((n) => (
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
