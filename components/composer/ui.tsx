"use client";

import type { ReactNode } from "react";

const labelCls = "block text-xs font-medium text-gray-600 mb-1";
const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="text"
        className={`${inputCls} ${mono ? "font-mono" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={`${inputCls} ${mono ? "font-mono text-xs" : ""}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary/90",
    secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
    ghost: "text-gray-600 hover:bg-gray-100",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h3>
      {action}
    </div>
  );
}

const KIND_BADGE: Record<string, string> = {
  agent: "bg-violet/10 text-violet",
  mcp: "bg-teal/10 text-teal-700",
  llm: "bg-navy/10 text-navy",
};

export function KindBadge({ kind }: { kind: "agent" | "mcp" | "llm" }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_BADGE[kind] ?? "bg-gray-100 text-gray-600"}`}>
      {kind}
    </span>
  );
}
