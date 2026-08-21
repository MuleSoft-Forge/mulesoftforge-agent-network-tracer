"use client";

import { Plus, Trash2 } from "lucide-react";
import type { RegistryUrlEntry } from "@/lib/composer/registry/types";
import { Button, TextField } from "@/components/composer/ui";

export function RegistryUrlsEditor({
  urls,
  onChange,
}: {
  urls: RegistryUrlEntry[] | undefined;
  onChange: (urls: RegistryUrlEntry[] | undefined) => void;
}) {
  const entries = urls ?? [];

  function updateEntry(index: number, patch: Partial<RegistryUrlEntry>) {
    const list = entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    onChange(list.length > 0 ? list : undefined);
  }

  function removeEntry(index: number) {
    const list = entries.filter((_, i) => i !== index);
    onChange(list.length > 0 ? list : undefined);
  }

  function addEntry() {
    onChange([...entries, { name: `url-${entries.length + 1}`, url: "" }]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">URLs</p>
        <Button variant="secondary" className="h-6 px-2 text-[11px]" onClick={addEntry}>
          <Plus className="h-3 w-3" /> Add URL
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-gray-400">No endpoint URLs defined.</p>
      ) : (
        entries.map((entry, index) => (
          <div key={`registry-url-${index}`} className="flex items-start gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <TextField
                label="Name"
                uppercaseLabel
                value={entry.name}
                onChange={(name) => updateEntry(index, { name })}
                mono
              />
              <TextField
                label="URL"
                uppercaseLabel
                value={entry.url}
                onChange={(url) => updateEntry(index, { url })}
                mono
              />
            </div>
            <Button
              variant="danger"
              className="mt-5 h-7 px-2"
              onClick={() => removeEntry(index)}
              title="Remove URL"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
