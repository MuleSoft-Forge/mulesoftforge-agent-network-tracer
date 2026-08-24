"use client";

import { useRef, useEffect, useMemo, useState, KeyboardEvent, Dispatch } from "react";
import { Braces, Copy, X } from "lucide-react";
import type { InvokeMessage, InvokeAction, AgentSkill, InvokeState } from "@/lib/invoke/types";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import { handleSend } from "@/lib/invoke/flow-engine";
import { skillPromptText, isPlaceholderSkillDescription } from "@/lib/invoke/discovery";
import { useImeComposition } from "@/lib/ime-composition";

interface ConversationPanelProps {
  state: InvokeState;
  skills: AgentSkill[];
  displayGraph: CanonicalGraph;
  dispatch: Dispatch<InvokeAction>;
}

function PayloadModal({
  title,
  subtitle,
  payload,
  onClose,
}: {
  title: string;
  subtitle: string;
  payload: unknown;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const formatted = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  async function copyPayload() {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-white p-3 text-[11px] leading-relaxed text-gray-800">
          <code>{formatted}</code>
        </pre>
        <div className="flex justify-end border-t border-gray-200 px-4 py-2.5">
          <button
            type="button"
            onClick={() => void copyPayload()}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onInspect,
}: {
  msg: InvokeMessage;
  onInspect: (msg: InvokeMessage) => void;
}) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";
  const hasPayload = msg.requestPayload != null || msg.responsePayload != null;
  const inspectTitle = isUser ? "View sent payload" : "View raw response payload";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={hasPayload ? () => onInspect(msg) : undefined}
          title={hasPayload ? inspectTitle : undefined}
          className={`group relative max-w-[88%] rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-left bg-primary text-white ${
            hasPayload ? "cursor-pointer hover:brightness-110" : "cursor-default"
          }`}
        >
          {msg.content}
          {hasPayload && (
            <Braces className="absolute -top-1.5 -left-1.5 h-4 w-4 rounded-full bg-white p-0.5 text-primary opacity-0 shadow group-hover:opacity-100" />
          )}
        </button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 w-8 h-8 rounded-full bg-red-100 border border-red-200 flex items-center justify-center mt-0.5">
          <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <button
          type="button"
          onClick={hasPayload ? () => onInspect(msg) : undefined}
          title={hasPayload ? inspectTitle : undefined}
          className={`group relative max-w-[84%] rounded-2xl rounded-tl-sm px-4 py-3 bg-red-50 text-red-700 border border-red-200 text-left ${
            hasPayload ? "cursor-pointer hover:bg-red-100" : "cursor-default"
          }`}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          {hasPayload && (
            <Braces className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-white p-0.5 text-red-600 opacity-0 shadow group-hover:opacity-100" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden border border-primary/20 bg-primary/10 flex items-center justify-center mt-0.5">
        <span className="text-sm leading-none" aria-label="ANT" role="img">
          🐜
        </span>
      </div>
      <button
        type="button"
        onClick={hasPayload ? () => onInspect(msg) : undefined}
        title={hasPayload ? inspectTitle : undefined}
        className={`group relative max-w-[84%] rounded-2xl rounded-tl-sm px-4 py-3 bg-gray-50 text-gray-900 border border-gray-200 text-left ${
          hasPayload ? "cursor-pointer hover:bg-gray-100" : "cursor-default"
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        {hasPayload && (
          <Braces className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-white p-0.5 text-gray-500 opacity-0 shadow group-hover:opacity-100" />
        )}
      </button>
    </div>
  );
}

export default function ConversationPanel({
  state,
  skills,
  displayGraph,
  dispatch,
}: ConversationPanelProps) {
  const { messages, isProcessing, currentStep, brokerUrl, a2aVersion, auth, contextId } = state;
  const [input, setInput] = useState("");
  const [showSkills, setShowSkills] = useState(false);
  const [inspecting, setInspecting] = useState<InvokeMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { compositionProps, isComposing } = useImeComposition();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  useEffect(() => {
    setShowSkills(false);
  }, [brokerUrl]);

  const examplePrompts = useMemo(() => {
    const seen = new Set<string>();
    const prompts: Array<{ key: string; text: string; skillName: string }> = [];
    for (const skill of skills) {
      for (const example of skill.examples ?? []) {
        const trimmed = example.trim();
        if (!trimmed) continue;
        const normalized = trimmed.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        prompts.push({ key: `${skill.id}:${trimmed}`, text: trimmed, skillName: skill.name });
      }
    }
    return prompts;
  }, [skills]);

  function adjustHeight(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  async function onSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || isProcessing) return;
    setInput("");
    await handleSend(msg, brokerUrl, displayGraph, dispatch, auth, a2aVersion, contextId);
  }

  function applySkillPrompt(skill: AgentSkill) {
    const prompt = skillPromptText(skill);
    setInput(prompt);
    textareaRef.current?.focus();
    if (textareaRef.current) adjustHeight(textareaRef.current);
  }

  function applyExamplePrompt(text: string) {
    setInput(text);
    textareaRef.current?.focus();
    if (textareaRef.current) adjustHeight(textareaRef.current);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !isComposing(e)) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="pt-2 space-y-3">
            {examplePrompts.length > 0 ? (
              <>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                  Example Prompts ({examplePrompts.length})
                </p>
                <div className="space-y-2">
                  {examplePrompts.map((example) => (
                    <button
                      key={example.key}
                      type="button"
                      onClick={() => applyExamplePrompt(example.text)}
                      disabled={isProcessing}
                      title={`From ${example.skillName}`}
                      className="w-full text-left text-xs text-gray-700 bg-gray-50 hover:bg-primary/5 hover:text-primary hover:border-primary/30 border border-gray-200 rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50 leading-snug"
                    >
                      {example.text}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {skills.length > 0 ? (
              <>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                  Agent Skills ({skills.length})
                </p>
                {!showSkills ? (
                  <button
                    type="button"
                    onClick={() => setShowSkills(true)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-700 hover:border-primary/30 hover:bg-primary/5 hover:text-primary transition-colors"
                  >
                    Show skill prompts
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {skills.map((skill) => (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => applySkillPrompt(skill)}
                        disabled={isProcessing}
                        title={
                          isPlaceholderSkillDescription(skill.description)
                            ? skillPromptText(skill)
                            : skill.description ?? skillPromptText(skill)
                        }
                        className="text-left text-xs text-gray-700 bg-gray-50 hover:bg-primary/5 hover:text-primary hover:border-primary/30 border border-gray-200 rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50 leading-snug"
                      >
                        {skill.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center pt-4">
                <p className="text-sm text-gray-400">No skills in agent card.</p>
                <p className="text-xs text-gray-300 mt-1">Type a prompt below to interact directly.</p>
              </div>
            )}
            <p className="text-xs text-gray-400 text-center">or type a prompt below</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onInspect={setInspecting} />
        ))}

        {isProcessing && currentStep && (
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s`, animationDuration: "1.4s" }}
                />
              ))}
            </span>
            <span className="text-xs text-gray-400">{currentStep}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Skill chips (when conversation is active) */}
      {messages.length > 0 && skills.length > 0 && (
        <div className="px-3 pt-1.5 pb-0.5">
          {!showSkills ? (
            <button
              type="button"
              onClick={() => setShowSkills(true)}
              className="text-[11px] text-gray-500 hover:text-primary border border-gray-200 hover:border-primary/30 rounded-full px-2.5 py-1 bg-gray-50 hover:bg-primary/5 transition-colors"
            >
              Show skills
            </button>
          ) : (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => applySkillPrompt(skill)}
                  disabled={isProcessing}
                  className="shrink-0 text-[11px] text-gray-500 hover:text-primary bg-gray-50 hover:bg-primary/5 border border-gray-200 hover:border-primary/30 rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {skill.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {messages.length > 0 && examplePrompts.length > 0 && (
        <div className="px-3 pb-1">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {examplePrompts.map((example) => (
              <button
                key={example.key}
                type="button"
                onClick={() => applyExamplePrompt(example.text)}
                disabled={isProcessing}
                className="shrink-0 text-[11px] text-gray-500 hover:text-primary bg-gray-50 hover:bg-primary/5 border border-gray-200 hover:border-primary/30 rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 whitespace-nowrap"
                title={`From ${example.skillName}`}
              >
                {example.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-gray-200 px-3 py-2.5">
        <div className="flex items-end gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); adjustHeight(e.target); }}
            onKeyDown={handleKey}
            {...compositionProps}
            placeholder="Ask the broker…"
            disabled={isProcessing}
            style={{ height: "auto", minHeight: "36px", maxHeight: "180px" }}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 resize-none outline-none leading-relaxed overflow-y-auto disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => onSend()}
            disabled={!input.trim() || isProcessing}
            className="shrink-0 w-8 h-8 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors mb-0.5"
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <path d="M2 10L10 6L2 2V5.5L7.5 6L2 6.5V10Z" fill="white" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1 text-center">Shift+Enter for new line · A2A calls are proxied server-side</p>
      </div>

      {inspecting && (
        <PayloadModal
          title={inspecting.role === "user" ? "Sent payload" : "Raw response payload"}
          subtitle={
            inspecting.role === "user"
              ? "JSON-RPC body sent to the broker for this turn"
              : "Raw body the broker returned for this turn"
          }
          payload={inspecting.role === "user" ? inspecting.requestPayload : inspecting.responsePayload}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}
