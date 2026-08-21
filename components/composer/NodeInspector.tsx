"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { nodeFieldIssues } from "@/lib/composer/node-field-issues";
import { useFieldIssue, useValidationResult } from "@/lib/composer/validation/validation-context";
import { SEVERITY_UI } from "@/lib/composer/validation/severity";
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
import type { GraphNode } from "@/lib/composer/model";
import {
  GRAPH_ANCHOR,
  type GraphFieldAnchor,
} from "@/lib/composer/project-field-anchors";
import {
  nodeUsesOnExitTransition,
  onExitTargetFieldHint,
  onExitTargetFieldLabel,
  onExitTargetOptional,
} from "@/lib/composer/graph-transitions";
import { nodeNameValidationMessage } from "@/lib/composer/node-name";
import OutputsEditor from "@/components/composer/OutputsEditor";
import ActionBindingsEditor from "@/components/composer/ActionBindingsEditor";
import ExecutorStatementsEditor from "@/components/composer/ExecutorStatementsEditor";
import { Button, Checkbox, NumberField, SelectField, TextArea, TextField } from "@/components/composer/ui";

function FieldAnchor({ id, children }: { id: GraphFieldAnchor; children: ReactNode }) {
  const issue = useFieldIssue(id);
  const tone = issue ? SEVERITY_UI[issue.severity] : null;
  return (
    <div id={id} className={`scroll-mt-4 ${tone ? `rounded-md ${tone.ring}` : ""}`}>
      {children}
      {issue ? <p className={`mt-1 text-[11px] ${tone!.text}`}>{issue.message}</p> : null}
    </div>
  );
}

export default function NodeInspector({
  nodeId,
  onDeleted,
  focusAnchor,
  onFocusAnchorHandled,
}: {
  nodeId: string;
  onDeleted: () => void;
  focusAnchor?: string | null;
  onFocusAnchorHandled?: () => void;
}) {
  const { project, dispatch } = useComposer();
  const { helpMode } = useHelpMode();
  const result = useValidationResult();
  const fieldIssues = useMemo(() => nodeFieldIssues(result, nodeId), [result, nodeId]);
  const broker = project.brokers[0];
  const node = broker?.nodes.find((n) => n.id === nodeId);

  useEffect(() => {
    if (!focusAnchor) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(focusAnchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.classList.add("ring-2", "ring-primary/30", "rounded-md");
        window.setTimeout(() => el.classList.remove("ring-2", "ring-primary/30", "rounded-md"), 1400);
      }
      onFocusAnchorHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusAnchor, onFocusAnchorHandled]);

  if (!broker || !node) return <div className="p-3 text-sm text-gray-400">Node not found.</div>;

  const patch = (p: Partial<GraphNode>) => dispatch({ type: "updateNode", id: node.id, patch: p });
  const llmOptions = [
    { value: "", label: "(broker default)" },
    ...broker.llmBindings.map((b) => ({ value: b.name, label: b.name })),
  ];
  const targetNodeOptions = broker.nodes
    .filter((n) => n.id !== node.id && n.kind !== "trigger")
    .map((n) => ({ value: n.id, label: `${n.kind} · ${n.name}` }));
  const expressionCatalog = buildExpressionCatalog(broker, { excludeNodeId: node.id });
  const help = helpForNodeKind(node.kind);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-composer-border px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <KindIcon kind={node.kind} size={20} />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-composer-label-muted">{node.kind}</span>
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
        <p className={`mt-1 text-xs leading-snug ${helpMode ? "text-primary/90" : "text-composer-label-muted"}`}>{help.tagline}</p>
        {helpMode && help.whenToUse[0] ? (
          <p className="mt-0.5 text-xs leading-snug text-composer-label-muted">{help.whenToUse[0]}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 scrollbar-thin">
        <FieldAnchor id={GRAPH_ANCHOR.name}>
          <TextField
            label="Node id"
            value={node.name}
            onChange={(v) => patch({ name: v })}
            mono
            required
            error={nodeNameValidationMessage(broker, node.id, node.name) ?? fieldIssues.get("name")}
            help={helpForSection("field.nodeId")}
            hint="Emitted in the .agent file as the node key (e.g. orchestrator main → @orchestrator.main)."
          />
        </FieldAnchor>
        <FieldAnchor id={GRAPH_ANCHOR.instructions}>
          <TextField
            label="Label"
            value={node.label ?? ""}
            onChange={(v) => patch({ label: v })}
            help={helpForSection("field.label")}
            hint="Optional display name on the canvas; does not affect expressions."
          />
        </FieldAnchor>

        {node.kind === "generator" && (
          <>
            <FieldAnchor id={GRAPH_ANCHOR.llm}>
              <SelectField
                label="LLM"
                value={node.llmBindingName ?? ""}
                options={llmOptions}
                onChange={(v) => patch({ llmBindingName: v || undefined })}
                error={fieldIssues.get("llm")}
                help={helpForSection("field.llm")}
                hint="Leave as broker default unless this generator needs a different model."
              />
            </FieldAnchor>
            <TextArea
              label="System instructions"
              value={instructionTextForEditor(node.systemInstructions)}
              onChange={(v) => patch({ systemInstructions: v })}
              rows={3}
              help={helpForSection("field.systemInstructions")}
              placeholder="Optional persona override for this generator call."
              hint="Overrides broker system.instructions for this node only."
            />
            <FieldAnchor id={GRAPH_ANCHOR.prompt}>
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
                error={fieldIssues.get("prompt")}
              />
            </FieldAnchor>
            <OutputsEditor node={node} />
          </>
        )}

        {(node.kind === "orchestrator" || node.kind === "subagent") && (
          <>
            <FieldAnchor id={GRAPH_ANCHOR.llm}>
              <SelectField
                label="LLM"
                value={node.llmBindingName ?? ""}
                options={llmOptions}
                onChange={(v) => patch({ llmBindingName: v || undefined })}
                error={fieldIssues.get("llm")}
                help={helpForSection("field.llm")}
                hint="Leave as broker default unless this agent needs a different model."
              />
            </FieldAnchor>
            <TextArea
              label="System instructions"
              value={instructionTextForEditor(node.systemInstructions)}
              onChange={(v) => patch({ systemInstructions: v })}
              rows={3}
              help={helpForSection("field.systemInstructions")}
              placeholder="Optional persona override for this agent node."
              hint="Overrides broker system.instructions for this node only."
            />
            <FieldAnchor id={GRAPH_ANCHOR.reasoning}>
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
                error={fieldIssues.get("reasoning")}
              />
            </FieldAnchor>
            <FieldAnchor id={GRAPH_ANCHOR.actions}>
              <ActionBindingsEditor node={node} broker={broker} />
            </FieldAnchor>
            <NumberField
              label="Max reasoning loops"
              value={node.maxNumberOfLoops}
              onChange={(v) => patch({ maxNumberOfLoops: v })}
              placeholder="60"
              hint="Maps to max_number_of_loops (e.g. 60 for triagePipeline)."
            />
            <NumberField
              label="Task timeout (seconds)"
              value={node.taskTimeoutSecs}
              onChange={(v) => patch({ taskTimeoutSecs: v })}
              placeholder="360"
              hint="Maps to task_timeout_secs (e.g. 360)."
            />
            <NumberField
              label="Max consecutive errors"
              value={node.maxConsecutiveErrors}
              onChange={(v) => patch({ maxConsecutiveErrors: v })}
              hint="Maps to max_consecutive_errors in the reasoning block."
            />
            <OutputsEditor node={node} />
          </>
        )}

        {node.kind === "executor" && (
          <FieldAnchor id={GRAPH_ANCHOR.actions}>
            <ExecutorStatementsEditor
              node={node}
              broker={broker}
              onChange={(executorStatements) => patch({ executorStatements })}
            />
          </FieldAnchor>
        )}

        {node.kind === "trigger" && node.triggerTarget ? (
          <TextField
            label="Trigger target"
            value={node.triggerTarget}
            onChange={(v) => patch({ triggerTarget: v.trim() || undefined })}
            mono
            hint="brokers:// URI preserved from import. Leave unchanged unless you intend to override export."
          />
        ) : null}

        {node.kind === "router" && (
          <FieldAnchor id={GRAPH_ANCHOR.routes}>
            <div className="space-y-2">
            <HelpSectionHeader
              label="Routes"
              help={helpForSection("section.routes")}
              action={
                targetNodeOptions.length > 0 ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      patch({
                        routes: [
                          ...(node.routes ?? []),
                          {
                            id: `route-${Math.random().toString(36).slice(2)}`,
                            targetNodeId: targetNodeOptions[0].value,
                            when: "true",
                            label: "",
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                ) : null
              }
            />
            {fieldIssues.get("routes") ? (
              <p className="text-xs text-red-600">{fieldIssues.get("routes")}</p>
            ) : null}
            {(node.routes ?? []).length === 0 ? (
              <p className="text-xs text-gray-400">Add a route below, then set the target and when condition for each branch.</p>
            ) : null}
            {(node.routes ?? []).map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border border-gray-200 p-2">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <SelectField
                      label="Target"
                      value={r.targetNodeId}
                      options={targetNodeOptions}
                      onChange={(v) =>
                        patch({ routes: (node.routes ?? []).map((x) => (x.id === r.id ? { ...x, targetNodeId: v } : x)) })
                      }
                      hint="Node to transition to when the when condition matches."
                    />
                  </div>
                  <Button
                    variant="danger"
                    onClick={() => patch({ routes: (node.routes ?? []).filter((x) => x.id !== r.id) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <TextField
                  label="When (condition)"
                  value={r.when}
                  mono
                  required
                  error={r.when.trim() ? undefined : "A route needs a condition."}
                  onChange={(v) => patch({ routes: (node.routes ?? []).map((x) => (x.id === r.id ? { ...x, when: v } : x)) })}
                  hint={'Python-like expression, e.g. @generator.classifyIntent.output.intent == "list".'}
                />
                <TextField
                  label="Label"
                  value={r.label ?? ""}
                  onChange={(v) => patch({ routes: (node.routes ?? []).map((x) => (x.id === r.id ? { ...x, label: v } : x)) })}
                  hint="Optional label shown on the canvas edge."
                />
              </div>
            ))}
            <FieldAnchor id={GRAPH_ANCHOR.otherwise}>
              <SelectField
                label="Otherwise target"
                value={node.otherwiseTargetNodeId ?? ""}
                options={[{ value: "", label: "(none)" }, ...targetNodeOptions]}
                onChange={(v) => patch({ otherwiseTargetNodeId: v || undefined })}
                error={fieldIssues.get("otherwise")}
                hint="Fallback when no route condition matches."
              />
            </FieldAnchor>
            </div>
          </FieldAnchor>
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
                <FieldAnchor id={GRAPH_ANCHOR.message}>
                  <InstructionTextArea
                    label="Message"
                    value={node.message ?? ""}
                    onChange={(v) => patch({ message: v })}
                    rows={4}
                    mono
                    help={helpForSection("field.echoMessage")}
                    hint="Plain text, @node.output, or full a2a.message({...}) expression."
                    catalog={expressionCatalog}
                    error={fieldIssues.get("message")}
                  />
                </FieldAnchor>
              </>
            ) : (node.echoKind ?? "a2a:status_update_event") === "a2a:artifact_update_event" ? (
              <>
                <FieldAnchor id={GRAPH_ANCHOR.message}>
                  <InstructionTextArea
                    label="Artifact"
                    value={node.artifactExpr ?? defaultArtifactExpr()}
                    onChange={(v) => patch({ artifactExpr: v })}
                    rows={6}
                    mono
                    help={helpForSection("field.echoArtifact")}
                    hint="Full a2a.artifact({...}) expression."
                    catalog={expressionCatalog}
                    error={fieldIssues.get("message")}
                  />
                </FieldAnchor>
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
            ) : null}
            <InstructionTextArea
              label="Metadata (optional)"
              value={node.metadataExpr ?? ""}
              onChange={(v) => patch({ metadataExpr: v || undefined })}
              rows={2}
              mono
              help={helpForSection("field.echoMetadata")}
              hint={'Optional event metadata expression, e.g. {} or { key: "value" }.'}
              catalog={expressionCatalog}
            />
          </>
        )}

        {nodeUsesOnExitTransition(node.kind) ? (
          <FieldAnchor id={GRAPH_ANCHOR.onExit}>
            <SelectField
              label={onExitTargetFieldLabel(node.kind)}
              value={node.onExitTarget ?? ""}
              options={[
                ...(node.onExitTarget
                  ? []
                  : node.kind === "trigger"
                    ? [{ value: "", label: "(select initial node)" }]
                    : onExitTargetOptional(node.kind)
                      ? [{ value: "", label: "(none)" }]
                      : []),
                ...targetNodeOptions,
              ]}
              onChange={(v) => patch({ onExitTarget: v || undefined })}
              error={fieldIssues.get("onExit")}
              help={helpForSection("field.onExitTarget")}
              hint={onExitTargetFieldHint(node.kind)}
              alwaysShowHint
            />
          </FieldAnchor>
        ) : null}
      </div>
    </div>
  );
}
