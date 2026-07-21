"use client";

import { Trash2, Plus } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import type { GraphNode, OutputProperty } from "@/lib/composer/model";
import { Button, SelectField, TextArea, TextField } from "@/components/composer/ui";

function OutputsEditor({ node }: { node: GraphNode }) {
  const { dispatch } = useComposer();
  const outputs = node.outputs ?? [];

  function update(next: OutputProperty[]) {
    dispatch({ type: "updateNode", id: node.id, patch: { outputs: next } });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">Structured outputs</span>
        <Button variant="ghost" onClick={() => update([...outputs, { name: "field", type: "string" }])}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {outputs.map((o, i) => (
        <div key={i} className="flex items-end gap-2 rounded-md border border-gray-200 p-2">
          <div className="flex-1">
            <TextField label="Name" value={o.name} onChange={(v) => update(outputs.map((x, j) => (j === i ? { ...x, name: v } : x)))} mono />
          </div>
          <div className="w-28">
            <SelectField
              label="Type"
              value={o.type}
              options={["string", "number", "integer", "boolean", "array", "object"].map((t) => ({ value: t as OutputProperty["type"], label: t }))}
              onChange={(v) => update(outputs.map((x, j) => (j === i ? { ...x, type: v } : x)))}
            />
          </div>
          <Button variant="danger" onClick={() => update(outputs.filter((_, j) => j !== i))}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function NodeInspector({ nodeId, onDeleted }: { nodeId: string; onDeleted: () => void }) {
  const { project, dispatch } = useComposer();
  const broker = project.brokers[0];
  const node = broker?.nodes.find((n) => n.id === nodeId);
  if (!broker || !node) return <div className="p-3 text-sm text-gray-400">Node not found.</div>;

  const patch = (p: Partial<GraphNode>) => dispatch({ type: "updateNode", id: node.id, patch: p });
  const nodeName = (id?: string) => broker.nodes.find((n) => n.id === id)?.name ?? "—";
  const llmOptions = [
    { value: "", label: "(broker default)" },
    ...broker.llmBindings.map((b) => ({ value: b.name, label: b.name })),
  ];
  const actionOptions = [{ value: "", label: "(none)" }, ...broker.actions.map((a) => ({ value: a.name, label: a.name }))];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{node.kind}</span>
          <p className="text-sm font-semibold text-gray-900">{node.name}</p>
        </div>
        {node.kind !== "trigger" && (
          <Button variant="danger" onClick={() => { dispatch({ type: "removeNode", id: node.id }); onDeleted(); }}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <TextField label="Node id" value={node.name} onChange={(v) => patch({ name: v })} mono hint="Identifier used in the .agent file." />
        <TextField label="Label" value={node.label ?? ""} onChange={(v) => patch({ label: v })} />

        {node.kind === "trigger" && (
          <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
            Entry point. It transitions to <strong>{nodeName(node.onExitTarget)}</strong>. Change the target by dragging the connection in the graph.
          </p>
        )}

        {node.kind === "generator" && (
          <>
            <SelectField label="LLM" value={node.llmBindingName ?? ""} options={llmOptions} onChange={(v) => patch({ llmBindingName: v || undefined })} />
            <TextArea label="System instructions" value={node.systemInstructions ?? ""} onChange={(v) => patch({ systemInstructions: v })} rows={3} />
            <TextArea label="Prompt" value={node.prompt ?? ""} onChange={(v) => patch({ prompt: v })} rows={4} mono hint="Expressions like {!@node.output} are inserted as-is." />
            <OutputsEditor node={node} />
          </>
        )}

        {(node.kind === "orchestrator" || node.kind === "subagent") && (
          <>
            <SelectField label="LLM" value={node.llmBindingName ?? ""} options={llmOptions} onChange={(v) => patch({ llmBindingName: v || undefined })} />
            <TextArea label="System instructions" value={node.systemInstructions ?? ""} onChange={(v) => patch({ systemInstructions: v })} rows={3} />
            <TextArea label="Reasoning instructions" value={node.reasoningInstructions ?? ""} onChange={(v) => patch({ reasoningInstructions: v })} rows={3} mono />
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-600">Actions available to this node</span>
              <div className="space-y-1 rounded-md border border-gray-200 p-2">
                {broker.actions.length === 0 ? (
                  <p className="text-xs text-gray-400">No actions — compose agents/MCP first.</p>
                ) : (
                  broker.actions.map((a) => {
                    const checked = (node.actionRefs ?? []).includes(a.name);
                    return (
                      <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const set = new Set(node.actionRefs ?? []);
                            if (e.target.checked) set.add(a.name);
                            else set.delete(a.name);
                            patch({ actionRefs: Array.from(set) });
                          }}
                        />
                        <span className="font-mono text-xs">{a.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
            <OutputsEditor node={node} />
          </>
        )}

        {node.kind === "executor" && (
          <>
            <SelectField label="Run action" value={node.runActionName ?? ""} options={actionOptions} onChange={(v) => patch({ runActionName: v || undefined })} />
            <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
              Deterministically runs the selected action, then transitions to <strong>{nodeName(node.onExitTarget)}</strong>.
            </p>
          </>
        )}

        {node.kind === "router" && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-gray-600">Routes (targets set via graph edges)</span>
            {(node.routes ?? []).length === 0 && <p className="text-xs text-gray-400">Connect this router to nodes to create routes.</p>}
            {(node.routes ?? []).map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border border-gray-200 p-2">
                <p className="text-xs text-gray-500">→ <span className="font-mono">{nodeName(r.targetNodeId)}</span></p>
                <TextField
                  label="When (condition)"
                  value={r.when}
                  mono
                  onChange={(v) => patch({ routes: (node.routes ?? []).map((x) => (x.id === r.id ? { ...x, when: v } : x)) })}
                />
                <TextField
                  label="Label"
                  value={r.label ?? ""}
                  onChange={(v) => patch({ routes: (node.routes ?? []).map((x) => (x.id === r.id ? { ...x, label: v } : x)) })}
                />
              </div>
            ))}
            <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
              Otherwise → <strong>{nodeName(node.otherwiseTargetNodeId)}</strong>. The last edge you draw becomes a route; set the otherwise target by connecting after routes exist.
            </p>
          </div>
        )}

        {node.kind === "echo" && (
          <>
            <SelectField
              label="Kind"
              value={node.echoKind ?? "a2a:status_update_event"}
              options={[
                { value: "a2a:status_update_event", label: "status_update_event" },
                { value: "a2a:artifact_update_event", label: "artifact_update_event" },
              ]}
              onChange={(v) => patch({ echoKind: v })}
            />
            {(node.echoKind ?? "a2a:status_update_event") === "a2a:status_update_event" && (
              <TextField label="State" value={node.state ?? "TASK_STATE_COMPLETED"} onChange={(v) => patch({ state: v })} mono />
            )}
            <TextArea label="Message" value={node.message ?? ""} onChange={(v) => patch({ message: v })} rows={3} hint="Plain text is quoted; text starting with @ is treated as an expression." />
          </>
        )}
      </div>
    </div>
  );
}
