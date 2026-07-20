"use client";

import type { ReactNode } from "react";
import { Bot, Cpu, Sparkles, Network as NetworkIcon, Link2 } from "lucide-react";
import type {
  ParsedExchangeMetadata,
  ExchangeConnection,
  ExchangeAssetRef,
} from "@/lib/mulesoft/exchange-asset-metadata";

const KIND_ICON: Record<string, typeof Bot> = {
  agent: Bot,
  a2a: Bot,
  mcp: Cpu,
  llm: Sparkles,
  broker: NetworkIcon,
};

function KindBadge({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind.toLowerCase()] ?? Link2;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
      <Icon className="h-3 w-3" />
      {kind}
    </span>
  );
}

function RefLabel({ ref }: { ref: ExchangeAssetRef }) {
  return (
    <span className="font-mono text-xs text-gray-800">
      {ref.assetId}
      {ref.version && <span className="text-gray-400">@{ref.version}</span>}
    </span>
  );
}

function ConnectionRow({ connection }: { connection: ExchangeConnection }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5">
      <KindBadge kind={connection.kind} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {connection.name && <span className="text-xs font-medium text-gray-900">{connection.name}</span>}
          <RefLabel ref={connection.ref} />
        </div>
        <p className="text-[10px] text-gray-400 truncate">{connection.ref.groupId}</p>
        {connection.allowed && connection.allowed.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {connection.allowed.map((tool) => (
              <span key={tool} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-mono text-indigo-700">
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      {children}
    </div>
  );
}

/**
 * Renders the connections graph carried by a `*-metadata` classified Exchange
 * file (agent-metadata, mcp-metadata, llm-metadata, agent-network-metadata) —
 * see `lib/mulesoft/exchange-asset-metadata.ts` for the ground-truth shapes.
 */
export default function ExchangeMetadataView({ metadata }: { metadata: ParsedExchangeMetadata }) {
  switch (metadata.fileKind) {
    case "agent-metadata":
      return (
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-1.5">
            {metadata.protocol && <KindBadge kind={metadata.protocol} />}
            {metadata.platform && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                {metadata.platform}
              </span>
            )}
          </div>
          <Section title={`Connections (${metadata.connections.length})`}>
            {metadata.connections.length === 0 ? (
              <p className="text-xs text-gray-400">No outbound connections declared.</p>
            ) : (
              <div className="space-y-1.5">
                {metadata.connections.map((c, i) => (
                  <ConnectionRow key={`${c.kind}-${c.ref.assetId}-${i}`} connection={c} />
                ))}
              </div>
            )}
          </Section>
          {metadata.provenance?.url && (
            <p className="text-[10px] text-gray-400 truncate">
              Provenance: <span className="font-mono">{metadata.provenance.url}</span>
            </p>
          )}
        </div>
      );

    case "mcp-metadata":
      return (
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-1.5">
            {metadata.transport?.kind && <KindBadge kind={metadata.transport.kind} />}
            {metadata.protocolVersion && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-600">
                {metadata.protocolVersion}
              </span>
            )}
            {metadata.capabilities &&
              Object.entries(metadata.capabilities)
                .filter(([, v]) => v)
                .map(([cap]) => (
                  <span key={cap} className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    {cap}
                  </span>
                ))}
          </div>
          <Section title={`Tools (${metadata.tools.length})`}>
            {metadata.tools.length === 0 ? (
              <p className="text-xs text-gray-400">No tools declared.</p>
            ) : (
              <div className="space-y-1">
                {metadata.tools.map((t) => (
                  <div key={t.name} className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5">
                    <span className="font-mono text-xs font-medium text-gray-900">{t.name}</span>
                    {t.description && <p className="text-[11px] text-gray-500">{t.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>
          {metadata.connections.length > 0 && (
            <Section title={`Connections (${metadata.connections.length})`}>
              <div className="space-y-1.5">
                {metadata.connections.map((c, i) => (
                  <ConnectionRow key={`${c.kind}-${c.ref.assetId}-${i}`} connection={c} />
                ))}
              </div>
            </Section>
          )}
        </div>
      );

    case "llm-metadata":
      return (
        <div className="space-y-2 p-3">
          {metadata.platform && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {metadata.platform}
            </span>
          )}
          {metadata.policyRef && (
            <Section title="Transcoding policy">
              <RefLabel ref={metadata.policyRef} />
            </Section>
          )}
        </div>
      );

    case "agent-network-metadata":
      return (
        <div className="space-y-3 p-3">
          <Section title={`Brokers (${metadata.brokers.length})`}>
            {metadata.brokers.length === 0 ? (
              <p className="text-xs text-gray-400">No brokers declared.</p>
            ) : (
              <div className="space-y-2">
                {metadata.brokers.map((b, i) => (
                  <div key={`${b.ref.assetId}-${i}`} className="rounded-md border border-gray-200 p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <NetworkIcon className="h-3.5 w-3.5 text-gray-400" />
                      <RefLabel ref={b.ref} />
                      {b.kind && <KindBadge kind={b.kind} />}
                    </div>
                    {b.connections.length > 0 && (
                      <div className="space-y-1 pl-4">
                        {b.connections.map((c, j) => (
                          <ConnectionRow key={`${c.kind}-${c.ref.assetId}-${j}`} connection={c} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
          {metadata.registry.length > 0 && (
            <Section title={`Registry (${metadata.registry.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {metadata.registry.map((r, i) => (
                  <span key={`${r.ref.assetId}-${i}`} className="rounded-full bg-gray-100 px-2 py-0.5">
                    <RefLabel ref={r.ref} />
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
      );

    default: {
      const exhaustiveCheck: never = metadata;
      return exhaustiveCheck;
    }
  }
}
