"use client";

import { X } from "lucide-react";
import {
  EXCHANGE_JSON_COMPOSER_NOTES,
  EXCHANGE_JSON_DEPENDENCY,
  EXCHANGE_JSON_INTRO,
  EXCHANGE_JSON_SOURCES,
  EXCHANGE_JSON_TOP_LEVEL,
  EXCHANGE_JSON_VARIABLE,
  composerSourceLabel,
  type ExchangeJsonFieldDoc,
  type ExchangeJsonNestedDoc,
} from "@/lib/composer/docs/exchange-json-schema";
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

export default function ExchangeJsonSchemaDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exchange-json-schema-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="exchange-json-schema-title" className="text-sm font-semibold text-gray-900">
              exchange.json reference
            </h2>
            <p className="mt-1 text-xs text-gray-500">Exchange project descriptor · agentic-network v2</p>
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
          <p className="text-sm leading-relaxed text-gray-700">{EXCHANGE_JSON_INTRO}</p>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Authority sources</h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600">
              {EXCHANGE_JSON_SOURCES.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Top-level fields</h3>
            <FieldTable fields={EXCHANGE_JSON_TOP_LEVEL} />
          </section>

          <NestedSection doc={EXCHANGE_JSON_DEPENDENCY} />
          <NestedSection doc={EXCHANGE_JSON_VARIABLE} />

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Builder notes</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-gray-600">
              {EXCHANGE_JSON_COMPOSER_NOTES.map((n) => (
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
