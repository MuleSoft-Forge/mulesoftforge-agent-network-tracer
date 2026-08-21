"use client";

/**
 * Renders plain text with a left gutter of 1-based line numbers.
 * Outer container scrolls so line numbers and code stay aligned.
 */
export default function LineNumberedBlock({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const digits = String(lines.length).length;

  return (
    <div
      className={`max-h-96 overflow-auto rounded-b bg-white ${className}`.trim()}
    >
      <div className="flex min-w-min text-xs font-mono leading-relaxed">
        <div
          className="shrink-0 select-none border-r border-gray-200 bg-gray-50 py-3 pl-2 pr-2 text-right text-gray-400 tabular-nums"
          style={{ minWidth: `${Math.max(2, digits + 1)}ch` }}
        >
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre className="min-w-0 flex-1 whitespace-pre py-3 pr-3 pl-3 text-gray-700">
          {normalized}
        </pre>
      </div>
    </div>
  );
}
