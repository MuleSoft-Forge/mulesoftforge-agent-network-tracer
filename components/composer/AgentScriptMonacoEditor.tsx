"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { SchemaFieldInfo } from "@sf-agentscript/language";
import { setupMonacoWorkers } from "@/lib/composer/monaco-setup";
import { lintAgentFabricSource } from "@/lib/composer/agentscript-lint";
import { registerAgentFabricCompletions } from "@/lib/composer/agentscript-completions";

const LINT_DEBOUNCE_MS = 400;
const monacoEditorModule = typeof window === "undefined" ? null : import("monaco-editor");
const agentScriptMonacoModule =
  typeof window === "undefined" ? null : import("@sf-agentscript/monaco");
const agentFabricDialectModule =
  typeof window === "undefined" ? null : import("@sf-agentscript/agentfabric-dialect");

export interface AgentScriptEditorHandle {
  /** Reveal a 0-based line/character position in the editor. */
  revealPosition: (position: { line: number; character: number }) => void;
}

export interface AgentScriptMonacoEditorProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}

const AgentScriptMonacoEditor = forwardRef<AgentScriptEditorHandle, AgentScriptMonacoEditorProps>(
  function AgentScriptMonacoEditor({ value, onChange, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    const lintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressChangeRef = useRef(false);
    // Always holds the latest value so the async editor mount picks up any value
    // that arrived while monaco was still loading (avoids a blank first open).
    const valueRef = useRef(value);
    valueRef.current = value;

    const runLint = useCallback(async (source: string, model: Monaco.editor.ITextModel, monaco: typeof Monaco) => {
      const versionId = model.getVersionId();
      try {
        const diagnostics = await lintAgentFabricSource(source);
        if (!agentScriptMonacoModule) return;
        const { createDiagnosticMarkers } = await agentScriptMonacoModule;
        if (model.isDisposed() || model.getVersionId() !== versionId) return;
        monaco.editor.setModelMarkers(model, "agentfabric", createDiagnosticMarkers(diagnostics));
      } catch (error) {
        if (model.isDisposed() || model.getVersionId() !== versionId) return;
        monaco.editor.setModelMarkers(model, "agentfabric", [
          {
            severity: monaco.MarkerSeverity.Error,
            message: `AgentScript validator unavailable: ${
              error instanceof Error ? error.message : String(error)
            }`,
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 2,
          },
        ]);
      }
    }, []);

    useImperativeHandle(ref, () => ({
      revealPosition({ line, character }) {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco) return;
        const lineNumber = line + 1;
        const column = character + 1;
        editor.setSelection(new monaco.Selection(lineNumber, column, lineNumber, column));
        editor.revealPositionInCenter({ lineNumber, column });
        editor.focus();
      },
    }));

    useEffect(() => {
      let disposed = false;
      let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
      let completionDisposable: Monaco.IDisposable | null = null;

      async function mount() {
        if (!containerRef.current) return;

        if (!monacoEditorModule || !agentScriptMonacoModule || !agentFabricDialectModule) return;
        await setupMonacoWorkers();
        const monaco = await monacoEditorModule;
        if (disposed || !containerRef.current) return;

        monacoRef.current = monaco;

        const [{ registerAgentScriptLanguage }, { AgentFabricSchema }] = await Promise.all([
          agentScriptMonacoModule,
          agentFabricDialectModule,
        ]);
        try {
          await registerAgentScriptLanguage({
            schema: AgentFabricSchema as Record<string, SchemaFieldInfo>,
          });
        } catch {
          // Editor still works with basic tokenization when parser init fails.
        }

        // Native schema/AST-aware completion (namespaces, node members, fields,
        // enum values, with-params) backed by the official LanguageService.
        completionDisposable = registerAgentFabricCompletions(monaco);

        editor = monaco.editor.create(containerRef.current, {
          value: valueRef.current,
          language: "agentscript",
          theme: "agentscript-light",
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          wordBasedSuggestions: "off",
          quickSuggestions: true,
        });

        editorRef.current = editor;

        editor.onDidChangeModelContent(() => {
          if (suppressChangeRef.current) return;
          const next = editor?.getValue() ?? "";
          onChange(next);

          const model = editor?.getModel();
          if (!model) return;
          if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
          lintTimerRef.current = setTimeout(() => {
            void runLint(next, model, monaco);
          }, LINT_DEBOUNCE_MS);
        });

        const model = editor.getModel();
        if (model) void runLint(valueRef.current, model, monaco);
      }

      void mount();

      return () => {
        disposed = true;
        monacoRef.current = null;
        if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
        completionDisposable?.dispose();
        editor?.dispose();
        editorRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; value synced separately
    }, [onChange, runLint]);

    useEffect(() => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;
      const model = editor.getModel();
      if (!model || model.getValue() === value) return;

      suppressChangeRef.current = true;
      editor.pushUndoStop();
      model.setValue(value);
      editor.pushUndoStop();
      suppressChangeRef.current = false;
      void runLint(value, model, monaco);
    }, [value, runLint]);

    return <div ref={containerRef} className={className ?? "h-full w-full"} />;
  }
);

export default AgentScriptMonacoEditor;
