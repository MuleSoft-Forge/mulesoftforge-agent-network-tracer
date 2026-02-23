"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Brain, Lightbulb, AlertCircle, CheckCircle2, Info } from "lucide-react";

interface LLMReasoningStep {
  step: string;
  content: string[];
}

interface LLMReasoningData {
  steps?: LLMReasoningStep[];
  rawReasoning?: string[];
  toolCallIds?: string[];
  downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
}

interface LLMReasoningPanelProps {
  reasoning: LLMReasoningData;
  source: "objectStore" | "logs";
  /** When source is objectStore: which partitions contributed (tasks and/or conversations) */
  sourcesUsed?: ("tasks" | "conversations")[];
}

/**
 * Component to display LLM reasoning/decision-making process from Object Store
 * Shows step-by-step reasoning that explains why decisions were made
 */
export default function LLMReasoningPanel({ reasoning, source, sourcesUsed }: LLMReasoningPanelProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  // Parse raw reasoning into structured steps if needed
  const parseRawReasoning = (raw: string[]): LLMReasoningStep[] => {
    const steps: LLMReasoningStep[] = [];
    let currentStep: LLMReasoningStep | null = null;

    for (const line of raw) {
      // Check if this is a step header (e.g., "STEP 1:", "STEP 2:", etc.)
      const stepMatch = line.match(/^(STEP\s+\d+:|ISTEP\s+\d+:)\s*(.+)$/i);
      if (stepMatch) {
        // Save previous step if exists
        if (currentStep) {
          steps.push(currentStep);
        }
        // Start new step
        currentStep = {
          step: stepMatch[2].trim() || stepMatch[1].trim(),
          content: [],
        };
      } else if (currentStep) {
        // Add content to current step
        currentStep.content.push(line);
      } else {
        // No current step, create a default one
        if (steps.length === 0) {
          currentStep = {
            step: "Reasoning",
            content: [],
          };
        }
        if (currentStep) {
          currentStep.content.push(line);
        }
      }
    }

    // Add last step
    if (currentStep) {
      steps.push(currentStep);
    }

    return steps.length > 0 ? steps : [{ step: "Reasoning", content: raw }];
  };

  // Use steps when non-empty; otherwise derive from rawReasoning so we never show blank when raw text exists
  const steps =
    reasoning.steps && reasoning.steps.length > 0
      ? reasoning.steps
      : parseRawReasoning(reasoning.rawReasoning || []);

  if (steps.length === 0 && (!reasoning.rawReasoning || reasoning.rawReasoning.length === 0)) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4" />
          <span>No LLM reasoning available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-indigo-600" />
          <div>
            <h3 className="font-semibold text-gray-900">LLM Reasoning & Decision Process</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              <strong>Reasoning expires after one day</strong>
            </p>
          </div>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            source === "objectStore"
              ? "bg-purple-100 text-purple-700 border border-purple-200"
              : "bg-blue-100 text-blue-700 border border-blue-200"
          }`}
        >
          {source === "objectStore"
            ? sourcesUsed?.length
              ? `Object Store (${sourcesUsed.map((s) => s === "tasks" ? "Tasks" : "Conversations").join(" + ")})`
              : "Object Store"
            : "Logs"}
        </span>
      </div>

      {/* Step-by-step reasoning */}
      <div className="space-y-2">
        {steps.map((stepData, idx) => {
          const stepId = `step-${idx}`;
          const isExpanded = expandedSteps.has(stepId);
          const stepNumber = stepData.step.match(/STEP\s+(\d+)/i)?.[1] || String(idx + 1);
          const stepTitle = stepData.step.replace(/^(STEP\s+\d+:|ISTEP\s+\d+:)\s*/i, "").trim() || `Step ${stepNumber}`;

          // Detect step type for icon
          let stepIcon = <Lightbulb className="h-4 w-4 text-indigo-500" />;
          let stepColor = "indigo";
          if (stepTitle.toLowerCase().includes("analysis") || stepTitle.toLowerCase().includes("decision")) {
            stepIcon = <Brain className="h-4 w-4 text-purple-500" />;
            stepColor = "purple";
          } else if (stepTitle.toLowerCase().includes("error") || stepTitle.toLowerCase().includes("issue")) {
            stepIcon = <AlertCircle className="h-4 w-4 text-red-500" />;
            stepColor = "red";
          } else if (stepTitle.toLowerCase().includes("complete") || stepTitle.toLowerCase().includes("final")) {
            stepIcon = <CheckCircle2 className="h-4 w-4 text-green-500" />;
            stepColor = "green";
          }

          // Determine border/background colors based on stepColor
          const borderColorClass = isExpanded
            ? stepColor === "purple"
              ? "border-purple-300 bg-purple-50"
              : stepColor === "red"
                ? "border-red-300 bg-red-50"
                : stepColor === "green"
                  ? "border-green-300 bg-green-50"
                  : "border-indigo-300 bg-indigo-50"
            : "border-gray-200 bg-white hover:border-gray-300";
          const chevronColorClass = isExpanded
            ? stepColor === "purple"
              ? "text-purple-600"
              : stepColor === "red"
                ? "text-red-600"
                : stepColor === "green"
                  ? "text-green-600"
                  : "text-indigo-600"
            : "text-gray-400";
          const titleColorClass = isExpanded
            ? stepColor === "purple"
              ? "text-purple-900"
              : stepColor === "red"
                ? "text-red-900"
                : stepColor === "green"
                  ? "text-green-900"
                  : "text-indigo-900"
            : "text-gray-900";
          const borderTopColorClass = stepColor === "purple"
            ? "border-purple-200"
            : stepColor === "red"
              ? "border-red-200"
              : stepColor === "green"
                ? "border-green-200"
                : "border-indigo-200";

          return (
            <div
              key={stepId}
              className={`rounded-lg border ${borderColorClass} transition-colors`}
            >
              <button
                type="button"
                onClick={() => toggleStep(stepId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <div className={`flex-shrink-0 ${chevronColorClass}`}>
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
                <div className="flex-shrink-0">{stepIcon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${titleColorClass}`}>
                      {stepTitle}
                    </span>
                    <span className="text-xs text-gray-500">({stepData.content.length} items)</span>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className={`border-t ${borderTopColorClass} bg-white px-4 py-3`}>
                  <div className="space-y-2 text-sm text-gray-700">
                    {stepData.content.map((contentLine, lineIdx) => {
                      // Format bullet points
                      const isBullet = contentLine.trim().startsWith("-");
                      const formattedLine = isBullet ? contentLine.trim().substring(1).trim() : contentLine.trim();

                      // Highlight important patterns
                      const hasDecision = /(NoDispute|DisputeFound|chose|decided|determined)/i.test(formattedLine);
                      const hasError = /(error|not found|unavailable|missing)/i.test(formattedLine);
                      const hasRule = /(per rules|must not|should not|per instructions)/i.test(formattedLine);

                      return (
                        <div
                          key={`${stepId}-line-${lineIdx}`}
                          className={`flex gap-2 ${
                            hasDecision
                              ? "bg-yellow-50 border-l-2 border-yellow-400 pl-2 py-1"
                              : hasError
                                ? "bg-red-50 border-l-2 border-red-400 pl-2 py-1"
                                : hasRule
                                  ? "bg-blue-50 border-l-2 border-blue-400 pl-2 py-1"
                                  : ""
                          }`}
                        >
                          {isBullet && (
                            <span className="text-gray-400 flex-shrink-0">•</span>
                          )}
                          <span className="whitespace-pre-wrap break-words font-mono text-xs">{formattedLine}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Additional metadata */}
      {(reasoning.toolCallIds && reasoning.toolCallIds.length > 0) ||
      (reasoning.downstreamContextIds && reasoning.downstreamContextIds.length > 0) ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h4 className="mb-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">Additional Context</h4>
          <div className="space-y-2 text-xs">
            {reasoning.toolCallIds && reasoning.toolCallIds.length > 0 && (
              <div>
                <span className="font-medium text-gray-600">Tool Call IDs:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {reasoning.toolCallIds.map((callId: string, idx: number) => (
                    <span
                      key={idx}
                      className="rounded bg-indigo-100 px-2 py-0.5 font-mono text-indigo-700 border border-indigo-200"
                    >
                      {callId}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {reasoning.downstreamContextIds && reasoning.downstreamContextIds.length > 0 && (
              <div>
                <span className="font-medium text-gray-600">Downstream Agent Contexts:</span>
                <div className="mt-1 space-y-1">
                  {reasoning.downstreamContextIds.map((ctx: { agent: string; contextId: string; taskId: string }, idx: number) => (
                    <div key={idx} className="rounded bg-purple-50 px-2 py-1 border border-purple-200">
                      <div className="font-medium text-purple-900">{ctx.agent.replace(/^[a-zA-Z0-9]+_/, "")}</div>
                      <div className="font-mono text-xs text-purple-700">
                        Context: {ctx.contextId} | Task: {ctx.taskId}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
