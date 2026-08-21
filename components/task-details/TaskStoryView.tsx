"use client";

import type { TaskStory, TaskStoryMessage } from "./types";

interface TaskStoryViewProps {
  story: TaskStory;
}

/** Pretty-print structured JSON strings; leave plain text untouched. */
function formatMaybeJson(text: string): string {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function roleStyle(role: string): { label: string; badge: string; bubble: string } {
  const normalized = role.toLowerCase();
  if (normalized === "user") {
    return {
      label: "User",
      badge: "bg-blue-100 text-blue-700",
      bubble: "border-blue-100 bg-blue-50",
    };
  }
  if (normalized === "agent" || normalized === "assistant") {
    return {
      label: "Agent",
      badge: "bg-emerald-100 text-emerald-700",
      bubble: "border-emerald-100 bg-emerald-50",
    };
  }
  return {
    label: role.charAt(0).toUpperCase() + role.slice(1),
    badge: "bg-gray-100 text-gray-700",
    bubble: "border-gray-200 bg-gray-50",
  };
}

function statusStyle(state: string | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "completed":
      return "bg-green-100 text-green-800";
    case "failed":
    case "canceled":
    case "cancelled":
      return "bg-red-100 text-red-800";
    case "input-required":
    case "auth-required":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function MessageBubble({ message }: { message: TaskStoryMessage }) {
  const style = roleStyle(message.role);
  return (
    <div className={`rounded-lg border p-3 ${style.bubble}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.badge}`}>
          {style.label}
        </span>
        {message.kind && message.kind !== "message" ? (
          <span className="text-[10px] text-gray-400">{message.kind}</span>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-800">
        {formatMaybeJson(message.text)}
      </pre>
    </div>
  );
}

export default function TaskStoryView({ story }: TaskStoryViewProps) {
  const hasHistory = story.history.length > 0;
  const hasArtifacts = story.artifacts.length > 0;
  const hasState = story.stateEntries.length > 0;
  const hasStatus = Boolean(story.statusState || story.statusText);

  if (!hasHistory && !hasArtifacts && !hasState && !hasStatus) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        No structured task story was reconstructed from the Object Store payload.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {hasStatus ? (
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">Outcome</h4>
            {story.statusState ? (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle(story.statusState)}`}>
                {story.statusState}
              </span>
            ) : null}
          </div>
          {story.statusText ? (
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-gray-800">
              {formatMaybeJson(story.statusText)}
            </pre>
          ) : null}
        </section>
      ) : null}

      {hasHistory ? (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-gray-900">
            Conversation ({story.history.length} turn{story.history.length === 1 ? "" : "s"})
          </h4>
          <div className="space-y-2">
            {story.history.map((message, index) => (
              <MessageBubble key={message.messageId ?? `turn-${index}`} message={message} />
            ))}
          </div>
        </section>
      ) : null}

      {hasArtifacts ? (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-gray-900">
            Artifacts ({story.artifacts.length})
          </h4>
          <div className="space-y-2">
            {story.artifacts.map((artifact, index) => (
              <div key={`artifact-${index}`} className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                    {artifact.name || `Artifact ${index + 1}`}
                  </span>
                </div>
                {artifact.description ? (
                  <p className="mb-1 text-xs text-gray-500">{artifact.description}</p>
                ) : null}
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-800">
                  {formatMaybeJson(artifact.text)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {hasState ? (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-amber-900">
            Graph state ({story.stateEntries.length})
          </h4>
          <div className="space-y-2">
            {story.stateEntries.map((entry, index) => (
              <details key={`state-${index}`} className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <summary className="cursor-pointer font-mono text-[11px] text-amber-800">
                  {entry.key}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-amber-100 p-2 font-sans text-sm text-amber-900">
                  {formatMaybeJson(entry.text)}
                </pre>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
