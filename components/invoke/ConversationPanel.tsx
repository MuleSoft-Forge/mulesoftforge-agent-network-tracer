"use client";

import { useRef, useEffect, useState, KeyboardEvent, Dispatch } from "react";
import type { InvokeMessage, InvokeAction, AgentSkill, InvokeState } from "@/lib/invoke/types";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import { handleSend } from "@/lib/invoke/flow-engine";
import { skillPromptText } from "@/lib/invoke/discovery";
import { findCanonicalNodeForSkill } from "@/lib/invoke/graph-builder";

interface ConversationPanelProps {
  state: InvokeState;
  skills: AgentSkill[];
  displayGraph: CanonicalGraph;
  dispatch: Dispatch<InvokeAction>;
}

const TYPE_PILL: Record<string, string> = {
  AGENT: "bg-violet-50 text-violet-700 border-violet-200",
  MCP: "bg-amber-50 text-amber-700 border-amber-200",
  BROKER: "bg-blue-50 text-blue-700 border-blue-200",
  LLM: "bg-sky-50 text-sky-700 border-sky-200",
};

function AttributionBadge({
  attribution,
}: {
  attribution: InvokeMessage["attribution"];
}) {
  if (!attribution?.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-2.5 border-t border-gray-200">
      <span className="text-xs text-gray-400 font-medium shrink-0">Skill used</span>
      {attribution.map((a, i) => (
        <span
          key={i}
          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
            TYPE_PILL[a.nodeType] ?? "bg-gray-100 text-gray-600 border-gray-200"
          }`}
        >
          {a.name}
        </span>
      ))}
    </div>
  );
}

function MessageBubble({ msg }: { msg: InvokeMessage }) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap bg-primary text-white">
          {msg.content}
        </div>
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
        <div className="max-w-[84%] rounded-2xl rounded-tl-sm px-4 py-3 bg-red-50 text-red-700 border border-red-200">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden border border-primary/20 bg-primary/10 flex items-center justify-center mt-0.5">
        <svg className="h-4 w-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
        </svg>
      </div>
      <div className="max-w-[84%] rounded-2xl rounded-tl-sm px-4 py-3 bg-gray-50 text-gray-900 border border-gray-200">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        <AttributionBadge attribution={msg.attribution} />
      </div>
    </div>
  );
}

export default function ConversationPanel({
  state,
  skills,
  displayGraph,
  dispatch,
}: ConversationPanelProps) {
  const { messages, isProcessing, currentStep, brokerUrl } = state;
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  function adjustHeight(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  async function onSend(text?: string, skillId?: string) {
    const msg = (text ?? input).trim();
    if (!msg || isProcessing) return;
    setInput("");
    const preferredNodeId = skillId
      ? findCanonicalNodeForSkill(skillId, displayGraph)
      : undefined;
    await handleSend(msg, brokerUrl, displayGraph, preferredNodeId, dispatch);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
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
            {skills.length > 0 ? (
              <>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                  Agent Skills ({skills.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {skills.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => onSend(skillPromptText(skill), skill.name)}
                      disabled={isProcessing}
                      title={skill.description}
                      className="text-left text-xs text-gray-700 bg-gray-50 hover:bg-primary/5 hover:text-primary hover:border-primary/30 border border-gray-200 rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50 leading-snug"
                    >
                      {skill.name}
                    </button>
                  ))}
                </div>
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
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {isProcessing && currentStep && (
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
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
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => setInput(skillPromptText(skill))}
                disabled={isProcessing}
                className="shrink-0 text-[11px] text-gray-500 hover:text-primary bg-gray-50 hover:bg-primary/5 border border-gray-200 hover:border-primary/30 rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {skill.name}
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
    </div>
  );
}
