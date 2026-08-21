"use client";

import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { setupMonacoWorkers } from "@/lib/composer/monaco-setup";

export default function JsonMonacoEditor({
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

      const modelUri = monaco.Uri.parse("file:///exchange.json");
      let model = monaco.editor.getModel(modelUri);
      if (!model) {
        model = monaco.editor.createModel(valueRef.current, "json", modelUri);
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
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fixedOverflowWidgets: true,
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
