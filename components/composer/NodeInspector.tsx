"use client";

import { Trash2, Plus } from "lucide-react";
import { KindIcon } from "@/components/composer/graph/KindIcon";
import InstructionTextArea from "@/components/composer/InstructionTextArea";
import HelpTip from "@/components/composer/HelpTip";
import { HelpSectionHeader } from "@/components/composer/HelpLabel";
import { instructionTextForEditor } from "@/lib/composer/instruction-text";
import { buildExpressionCatalog } from "@/lib/composer/agentfabric-expression-catalog";
import { helpForNodeKind } from "@/lib/composer/help/help-catalog";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { useHelpMode } from "@/lib/composer/help/help-mode";
import { A2A_TASK_STATE_OPTIONS, normalizeA2aTaskState, type A2aTaskState } from "@/lib/composer/a2a-task-states";
import { defaultArtifactExpr } from "@/lib/composer/echo-expressions";
import { useComposer } from "@/lib/composer/store";
import type { GraphNode, OutputProperty } from "@/lib/composer/model";
import { Button, Checkbox, SelectField, TextArea, TextField } from "@/components/composer/ui";

function OutputsEditor({ node }: { node: GraphNode }) {
  const { dispatch } = useComposer();
  const outputs = node.outputs ?? [];
  const help = helpForSection("section.structuredOutputs");

  function update(next: OutputProperty[]) {
    dispatch({ type: "updateNode", id: node.id, patch: { outputs: next } });
  }

  return (
    <div className="space-y-2">
      <HelpSectionHeader
        label="Structured outputs"
        help={help}
        action={
          <Button variant="ghost" onClick={() => update([...outputs, { name: "field", type: "string" }])}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      />
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
  const { helpMode } = useHelpMode();
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
  const expressionCatalog = buildExpressionCatalog(broker, { excludeNodeId: node.id });
  const help = helpForNodeKind(node.kind);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <KindIcon kind={node.kind} size={20} />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{node.kind}</span>
                <HelpTip entry={help} align="left" />
              </div>
              <p className="truncate text-sm font-semibold text-gray-900">{node.name}</p>
            </div>
          </div>
          {node.kind !== "trigger" && (
            <Button variant="danger" onClick={() => { dispatch({ type: "removeNode", id: node.id }); onDeleted(); }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
        <p className={`mt-1 text-[11px] leading-snug ${helpMode ? "text-primary/90" : "text-gray-500"}`}>{help.tagline}</p>
        {helpMode && help.whenToUse[0] ? (
          <p className="mt-0.5 text-[10px] leading-snug text-gray-500">{help.whenToUse[0]}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <TextField
          label="Node id"
          value={node.name}
          onChange={(v) => patch({ name: v })}
          mono
          help={helpForSection("field.nodeId")}
          hint="Emitted in the .agent file as the node key (e.g. orchestrator main → @orchestrator.main)."
        />
        <TextField
          label="Label"
          value={node.label ?? ""}
          onChange={(v) => patch({ label: v })}
          help={helpForSection("field.label")}
          hint="Optional display name on the canvas; does not affect expressions."
        />

        {node.kind === "trigger" && (
          <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
            Entry point. It transitions to <strong>{nodeName(node.onExitTarget)}</strong>. Change the target by dragging the connection in the graph.
          </p>
        )}

        {node.kind === "generator" && (
          <>
            <SelectField
              label="LLM"
              value={node.llmBindingName ?? ""}
              options={llmOptions}
              onChange={(v) => patch({ llmBindingName: v || undefined })}
              help={helpForSection("field.llm")}
              hint="Leave as broker default unless this generator needs a different model."
            />
            <TextArea
              label="System instructions"
              value={instructionTextForEditor(node.systemInstructions)}
              onChange={(v) => patch({ systemInstructions: v })}
              rows={3}
              help={helpForSection("field.systemInstructions")}
              placeholder="Optional persona override for this generator call."
              hint="Overrides broker system.instructions for this node only."
            />
            <InstructionTextArea
              label="Prompt"
              value={instructionTextForEditor(node.prompt)}
              onChange={(v) => patch({ prompt: v })}
              rows={4}
              mono
              catalog={expressionCatalog}
              help={helpForSection("field.prompt")}
              placeholder="Session-specific instructions for the single LLM call."
              hint="Required. Use Insert for {!@…} expressions (e.g. prior node output)."
            />
            <OutputsEditor node={node} />
          </>
        )}

        {(node.kind === "orchestrator" || node.kind === "subagent") && (
          <>
            <SelectField
              label="LLM"
              value={node.llmBindingName ?? ""}
              options={llmOptions}
              onChange={(v) => patch({ llmBindingName: v || undefined })}
              help={helpForSection("field.llm")}
              hint="Leave as broker default unless this agent needs a different model."
            />
            <TextArea
              label="System instructions"
              value={instructionTextForEditor(node.systemInstructions)}
              onChange={(v) => patch({ systemInstructions: v })}
              rows={3}
              help={helpForSection("field.systemInstructions")}
              placeholder="Optional persona override for this agent node."
              hint="Overrides broker system.instructions for this node only."
            />
            <InstructionTextArea
              label="Reasoning instructions"
              value={instructionTextForEditor(node.reasoningInstructions)}
              onChange={(v) => patch({ reasoningInstructions: v })}
              rows={3}
              mono
              catalog={expressionCatalog}
              help={helpForSection("field.reasoningInstructions")}
              placeholder="Session context for the reasoning loop (e.g. user message)."
              hint="Required. Typically includes {!@request.payload.message.parts[0].text} or prior node output."
            />
            <div>
              <HelpSectionHeader label="Actions available to this node" help={helpForSection("section.actionsAvailable")} />
              <div className="space-y-1 rounded-md border border-gray-200 p-2">
                {broker.actions.length === 0 ? (
                  <p className="text-xs text-gray-400">No actions — compose agents/MCP on the Actions tab first.</p>
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
            <SelectField
              label="Run action"
              value={node.runActionName ?? ""}
              options={actionOptions}
              onChange={(v) => patch({ runActionName: v || undefined })}
              help={helpForSection("field.runAction")}
              hint="Deterministic action invoked in the executor do: block."
            />
            <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
              Runs the selected action, then transitions to <strong>{nodeName(node.onExitTarget)}</strong>.
            </p>
          </>
        )}

        {node.kind === "router" && (
          <div className="space-y-2">
            <HelpSectionHeader label="Routes" help={helpForSection("section.routes")} />
            {(node.routes ?? []).length === 0 && <p className="text-xs text-gray-400">Connect this router to nodes to create routes.</p>}
            {(node.routes ?? []).map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border border-gray-200 p-2">
                <p className="text-xs text-gray-500">→ <span className="font-mono">{nodeName(r.targetNodeId)}</span></p>
                <TextField
                  label="When (condition)"
                  value={r.when}
                  mono
                  onChange={(v) => patch({ routes: (node.routes ?? []).map((x) => (x.id === r.id ? { ...x, when: v } : x)) })}
                  hint={'Python-like expression, e.g. @orchestrator.classify.output.severity == "high".'}
                />
                <TextField
                  label="Label"
                  value={r.label ?? ""}
                  onChange={(v) => patch({ routes: (node.routes ?? []).map((x) => (x.id === r.id ? { ...x, label: v } : x)) })}
                  hint="Optional label shown on the canvas edge."
                />
              </div>
            ))}
            <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
              Otherwise → <strong>{nodeName(node.otherwiseTargetNodeId)}</strong>. Draw edges on the canvas to set route and otherwise targets.
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
              onChange={(v) => {
                if (v === "a2a:artifact_update_event") {
                  patch({
                    echoKind: v,
                    ...(node.artifactExpr ? {} : { artifactExpr: defaultArtifactExpr() }),
                  });
                } else {
                  patch({ echoKind: v });
                }
              }}
              help={helpForSection("field.echoKind")}
            />
            {(node.echoKind ?? "a2a:status_update_event") === "a2a:status_update_event" ? (
              <>
                <SelectField<A2aTaskState>
                  label="State"
                  value={normalizeA2aTaskState(node.state)}
                  options={A2A_TASK_STATE_OPTIONS}
                  onChange={(v) => patch({ state: v })}
                  help={helpForSection("field.echoState")}
                  hint="A2A task state emitted with the status update event."
                />
                <TextArea
                  label="Message"
                  value={node.message ?? ""}
                  onChange={(v) => patch({ message: v })}
                  rows={4}
                  mono
                  help={helpForSection("field.echoMessage")}
                  hint="Plain text, @node.output, or full a2a.message({...}) expression."
                />
                <TextArea
                  label="Metadata (optional)"
                  value={node.metadataExpr ?? ""}
                  onChange={(v) => patch({ metadataExpr: v || undefined })}
                  rows={2}
                  mono
                  help={helpForSection("field.echoMetadata")}
                  hint={'Optional dict expression, e.g. {} or { key: "value" }.'}
                />
              </>
            ) : (
              <>
                <TextArea
                  label="Artifact"
                  value={node.artifactExpr ?? defaultArtifactExpr()}
                  onChange={(v) => patch({ artifactExpr: v })}
                  rows={6}
                  mono
                  help={helpForSection("field.echoArtifact")}
                  hint="Full a2a.artifact({...}) expression."
                />
                <div className="space-y-2">
                  <Checkbox
                    label="Append"
                    checked={node.echoAppend ?? false}
                    onChange={(v) => patch({ echoAppend: v })}
                  />
                  <Checkbox
                    label="Last chunk"
                    checked={node.echoLastChunk ?? false}
                    onChange={(v) => patch({ echoLastChunk: v })}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
