"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { fetchAgentCard } from "@/lib/invoke/discovery";
import {
  mergeAgentCardIntoEntity,
  mergeMcpMetadataIntoEntity,
  parseAgentCardJson,
  parseMcpMetadataJson,
} from "@/lib/composer/registry/import-helpers";
import type { McpMetadata } from "@/lib/mulesoft/exchange-mcp-metadata";
import type { RegistryAgentEntity, RegistryMcpEntity } from "@/lib/composer/registry/types";
import { Button, TextField } from "@/components/composer/ui";

type RegistryImportKind = "agent" | "mcp";

export function RegistrySchemaImport({
  kind,
  agentEntity,
  mcpEntity,
  onAgentImport,
  onMcpImport,
}: {
  kind: RegistryImportKind;
  agentEntity?: RegistryAgentEntity;
  mcpEntity?: RegistryMcpEntity;
  onAgentImport?: (next: RegistryAgentEntity, interfaceKey: "a2a" | "a2a_v03") => void;
  onMcpImport?: (next: RegistryMcpEntity) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const label = kind === "agent" ? "agent card" : "MCP metadata";

  async function applyAgentCard(cardRaw: Record<string, unknown>, sourceUrl?: string) {
    if (!agentEntity || !onAgentImport) return;
    const merged = mergeAgentCardIntoEntity(agentEntity, cardRaw, sourceUrl);
    onAgentImport(merged.entity, merged.interfaceKey);
  }

  async function applyMcpMetadata(metadata: McpMetadata, sourceUrl?: string) {
    if (!mcpEntity || !onMcpImport) return;
    onMcpImport(mergeMcpMetadataIntoEntity(mcpEntity, metadata, sourceUrl));
  }

  async function handleFetch() {
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    try {
      if (kind === "agent") {
        const card = await fetchAgentCard(trimmed);
        await applyAgentCard(card as Record<string, unknown>, trimmed);
      } else {
        const params = new URLSearchParams({ kind: "mcp", url: trimmed });
        const res = await fetch(`/api/composer/registry-fetch?${params.toString()}`);
        const data = (await res.json()) as {
          metadata?: McpMetadata;
          sourceUrl?: string;
          error?: string;
        };
        if (!res.ok || !data.metadata) {
          setError(data.error ?? "Could not fetch MCP metadata from URL");
          return;
        }
        await applyMcpMetadata(data.metadata, data.sourceUrl ?? trimmed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to fetch ${label}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    const text = await file.text();

    if (kind === "agent") {
      const parsed = parseAgentCardJson(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      await applyAgentCard(parsed.card);
      return;
    }

    const parsed = parseMcpMetadataJson(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    await applyMcpMetadata(parsed.metadata);
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-gray-300 bg-gray-50/80 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Import {label}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <TextField
            label="From URL"
            uppercaseLabel
            value={url}
            onChange={setUrl}
            mono
            hint={kind === "agent" ? "Broker base URL or direct agent-card.json" : "Direct mcp-metadata.json URL"}
          />
        </div>
        <Button
          variant="secondary"
          className="h-8 px-2 text-xs"
          disabled={loading || !url.trim()}
          onClick={() => void handleFetch()}
        >
          <Download className="h-3.5 w-3.5" />
          {loading ? "Fetching…" : "Fetch"}
        </Button>
        <Button
          variant="secondary"
          className="h-8 px-2 text-xs"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" /> Upload JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
