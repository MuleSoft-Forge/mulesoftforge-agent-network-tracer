"use client";

/** One-time Monaco worker bootstrap for the browser bundle. */
let setupDone = false;

export async function setupMonacoWorkers(): Promise<void> {
  if (setupDone || typeof window === "undefined") return;
  setupDone = true;

  const MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") {
        return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url));
      }
      if (label === "yaml") {
        return new Worker(new URL("monaco-yaml/yaml.worker", import.meta.url));
      }
      return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url));
    },
  };

  (self as typeof self & { MonacoEnvironment?: typeof MonacoEnvironment }).MonacoEnvironment =
    MonacoEnvironment;
}
