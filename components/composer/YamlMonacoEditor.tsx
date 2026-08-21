"use client";

import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";
import { BUNDLED_ANF_SCHEMAS } from "@/lib/composer/schema/anf/catalog";
import { setupMonacoWorkers } from "@/lib/composer/monaco-setup";

const SCHEMA_BASE_URI = "https://agent-network.schema.local";
const YAML_FILE_MATCH = ["*.yaml", "*.yml", "**/agent-network.yaml"];
const NEVER_FILE_MATCH = ["__never_match__.yaml"];

let yamlConfigured = false;

function schemaUri(filename: string): string {
  return `${SCHEMA_BASE_URI}/${filename}`;
}

function configureYaml(monaco: typeof Monaco) {
  if (yamlConfigured) return;
  yamlConfigured = true;
  const rootFilename =
    BUNDLED_ANF_SCHEMAS.find((entry) => entry.isRoot)?.filename ?? "agent_network_v2.json";

  configureMonacoYaml(monaco, {
    enableSchemaRequest: false,
    validate: true,
    completion: true,
    hover: true,
    format: { enable: true },
    schemas: BUNDLED_ANF_SCHEMAS.map((entry) => ({
      uri: schemaUri(entry.filename),
      // Only the root schema should apply to the yaml document.
      // Referenced schemas are still registered for $ref resolution, but must
      // not become independent completion roots.
      fileMatch: entry.filename === rootFilename ? YAML_FILE_MATCH : NEVER_FILE_MATCH,
      schema: entry.document,
    })),
  });
}

export default function YamlMonacoEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const suppressChangeRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let disposed = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;

    async function mount() {
      if (!containerRef.current) return;
      await setupMonacoWorkers();
      const monaco = await import("monaco-editor");
      if (disposed || !containerRef.current) return;

      monacoRef.current = monaco;
      configureYaml(monaco);

      const modelUri = monaco.Uri.parse("file:///agent-network.yaml");
      let model = monaco.editor.getModel(modelUri);
      if (!model) {
        model = monaco.editor.createModel(valueRef.current, "yaml", modelUri);
      } else if (model.getValue() !== valueRef.current) {
        model.setValue(valueRef.current);
      }
      modelRef.current = model;

      editor = monaco.editor.create(containerRef.current, {
        model,
        theme: "vs",
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: "on",
        wordWrap: "off",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        // Match ACB-like behavior: prefer schema-driven completions and avoid
        // generic in-document token suggestions ("offers all...").
        wordBasedSuggestions: "off",
        suggest: {
          showWords: false,
        },
      });

      editorRef.current = editor;
      editor.onDidChangeModelContent(() => {
        if (suppressChangeRef.current) return;
        onChangeRef.current(editor?.getValue() ?? "");
      });
    }

    void mount();
    return () => {
      disposed = true;
      editor?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model || model.getValue() === value) return;

    suppressChangeRef.current = true;
    editor.pushUndoStop();
    model.setValue(value);
    editor.pushUndoStop();
    suppressChangeRef.current = false;
  }, [value]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
}
