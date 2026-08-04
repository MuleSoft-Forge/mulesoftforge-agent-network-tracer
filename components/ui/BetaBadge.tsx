/** Small pill shown next to pre-release product names (e.g. Builder). */
export default function BetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-200/80 ${className}`}
    >
      Beta
    </span>
  );
}
