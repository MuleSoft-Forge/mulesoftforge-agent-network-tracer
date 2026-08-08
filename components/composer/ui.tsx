"use client";

import { useState, type ReactNode } from "react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { HelpLabel } from "@/components/composer/HelpLabel";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";
import { useHelpMode } from "@/lib/composer/help/help-mode";
import type { AssetKind } from "@/lib/composer/model";

export const composerInputCls =
  "w-full rounded-anypoint border border-gray-300 bg-composer-surface px-2.5 py-1.5 text-sm text-gray-900 shadow-sm transition-anypoint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2";

const inputCls = composerInputCls;

export function Field({
  label,
  help,
  children,
  hint,
  error,
  alwaysShowHint,
  uppercaseLabel,
  required,
}: {
  label: string;
  help?: HelpEntry;
  children: ReactNode;
  hint?: string;
  /** Validation message — always visible even when help mode is off. */
  error?: string;
  /** Show hint even when help mode is off (e.g. format rules users must always see). */
  alwaysShowHint?: boolean;
  uppercaseLabel?: boolean;
  required?: boolean;
}) {
  const { helpMode } = useHelpMode();
  const showHint = Boolean(hint && !error && (alwaysShowHint || helpMode));

  return (
    <label className="block">
      <HelpLabel label={label} help={help} uppercase={uppercaseLabel} required={required} />
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
      {showHint ? <span className="mt-1 block text-xs text-composer-label-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * Field wrapper for controls made of several buttons/inputs, which cannot sit
 * inside `Field`'s `<label>` without the label hijacking their clicks.
 */
export function FieldGroup({
  label,
  help,
  children,
  hint,
  error,
  alwaysShowHint,
  uppercaseLabel,
  required,
}: {
  label: string;
  help?: HelpEntry;
  children: ReactNode;
  hint?: string;
  error?: string;
  alwaysShowHint?: boolean;
  uppercaseLabel?: boolean;
  required?: boolean;
}) {
  const { helpMode } = useHelpMode();
  const showHint = Boolean(hint && !error && (alwaysShowHint || helpMode));

  return (
    <div role="group" aria-label={label}>
      <HelpLabel label={label} help={help} uppercase={uppercaseLabel} required={required} />
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
      {showHint ? <span className="mt-1 block text-xs text-composer-label-muted">{hint}</span> : null}
    </div>
  );
}

/** Inline guidance block — visible only when Help mode is on. */
export function HelpHint({
  children,
  className = "text-xs leading-relaxed text-composer-label-muted",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { helpMode } = useHelpMode();
  if (!helpMode) return null;
  return <div className={className}>{children}</div>;
}

/** Expanded guidance below a field — visible only when Help mode is on. */
export function FieldDetail({
  title,
  summary,
  children,
}: {
  title?: string;
  summary?: string;
  children?: ReactNode;
}) {
  const { helpMode } = useHelpMode();
  if (!helpMode) return null;

  return (
    <div className="mt-1.5 rounded-anypoint border border-composer-border bg-composer-surface-muted px-2.5 py-2 text-xs leading-relaxed text-composer-label-muted">
      {title ? <p className="font-medium text-composer-label">{title}</p> : null}
      {summary ? <p className={title ? "mt-1" : undefined}>{summary}</p> : null}
      {children}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-composer-label">
      <input
        type="checkbox"
        className="h-4 w-4 rounded-anypoint border-gray-300 text-primary transition-anypoint focus:ring-2 focus:ring-primary focus:ring-offset-2"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  onFocus,
  placeholder,
  hint,
  help,
  mono,
  uppercaseLabel,
  required,
  error,
  alwaysShowHint,
  restrictAnfId,
  readOnly,
  protected: protectedField,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  hint?: string;
  help?: HelpEntry;
  mono?: boolean;
  uppercaseLabel?: boolean;
  required?: boolean;
  error?: string;
  alwaysShowHint?: boolean;
  /** Only allow lowercase letters, digits, and underscores while typing. */
  restrictAnfId?: boolean;
  readOnly?: boolean;
  /** Stronger locked styling (grey fill) for fields that must not be edited in-place. */
  protected?: boolean;
}) {
  const isProtected = readOnly && protectedField;
  const borderCls = error
    ? "border-red-400 focus:border-red-500 focus:ring-red-500"
    : isProtected
      ? "border-gray-300 bg-gray-100 text-gray-500 shadow-inner"
      : readOnly
        ? "border-gray-200 bg-gray-50 text-gray-600"
        : "border-gray-300 focus:border-primary focus:ring-primary";

  const inputClassName = isProtected
    ? `w-full rounded-anypoint border px-2.5 py-1.5 text-sm transition-anypoint focus:outline-none focus:ring-0 cursor-not-allowed select-none ${borderCls} ${mono ? "font-mono" : ""}`
    : `w-full rounded-anypoint border px-2.5 py-1.5 text-sm shadow-sm transition-anypoint focus:outline-none focus:ring-2 focus:ring-offset-2 ${borderCls} ${mono ? "font-mono" : ""} ${error ? "text-red-900" : readOnly ? "cursor-default focus:ring-0" : "bg-composer-surface text-gray-900"}`;

  return (
    <Field label={label} help={help} hint={hint} error={error} alwaysShowHint={alwaysShowHint} uppercaseLabel={uppercaseLabel} required={required}>
      <input
        type="text"
        required={required}
        readOnly={readOnly}
        aria-required={required || undefined}
        aria-readonly={readOnly || undefined}
        aria-invalid={error ? true : undefined}
        className={inputClassName}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(restrictAnfId ? e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") : e.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
      />
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  rows = 4,
  hint,
  help,
  mono,
  uppercaseLabel,
  required,
  error,
  alwaysShowHint,
  readOnly,
  protected: protectedField,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
  help?: HelpEntry;
  mono?: boolean;
  uppercaseLabel?: boolean;
  required?: boolean;
  error?: string;
  alwaysShowHint?: boolean;
  readOnly?: boolean;
  protected?: boolean;
}) {
  const isProtected = readOnly && protectedField;
  const borderCls = error
    ? "border-red-400 text-red-900 focus:border-red-500 focus:ring-red-500"
    : isProtected
      ? "border-gray-300 bg-gray-100 text-gray-500 shadow-inner"
      : "";
  const errorCls = error
    ? "border-red-400 text-red-900 focus:border-red-500 focus:ring-red-500"
    : "";
  return (
    <Field label={label} help={help} hint={hint} error={error} uppercaseLabel={uppercaseLabel} required={required} alwaysShowHint={alwaysShowHint}>
      <textarea
        required={required}
        readOnly={readOnly}
        aria-required={required || undefined}
        aria-readonly={readOnly || undefined}
        aria-invalid={error ? true : undefined}
        className={`${inputCls} ${mono ? "font-mono text-xs" : ""} ${isProtected ? borderCls : errorCls} ${readOnly ? "cursor-not-allowed" : ""}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </Field>
  );
}

/**
 * Integer input that keeps invalid keystrokes local instead of writing `NaN`
 * into the model. The draft clears on blur so the field re-syncs to the model.
 */
export function NumberField({
  label,
  value,
  onChange,
  min = 1,
  max,
  placeholder,
  hint,
  help,
  uppercaseLabel,
  required,
  alwaysShowHint,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
  help?: HelpEntry;
  uppercaseLabel?: boolean;
  required?: boolean;
  alwaysShowHint?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value !== undefined ? String(value) : "");

  const trimmed = text.trim();
  const parsed = trimmed ? Number(trimmed) : undefined;
  const error =
    trimmed && (!Number.isInteger(parsed) || (parsed as number) < min || (max !== undefined && (parsed as number) > max))
      ? max !== undefined
        ? `Enter a whole number between ${min} and ${max}.`
        : `Enter a whole number of ${min} or more.`
      : undefined;

  function handleChange(next: string) {
    setDraft(next);
    const value = next.trim();
    if (!value) {
      onChange(undefined);
      return;
    }
    const n = Number(value);
    if (Number.isInteger(n) && n >= min && (max === undefined || n <= max)) {
      onChange(n);
    }
  }

  return (
    <Field label={label} help={help} hint={hint} error={error} uppercaseLabel={uppercaseLabel} required={required} alwaysShowHint={alwaysShowHint}>
      <input
        type="text"
        inputMode="numeric"
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        className={`${inputCls} ${error ? "border-red-400 text-red-900 focus:border-red-500 focus:ring-red-500" : ""}`}
        value={text}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
      />
    </Field>
  );
}

export type SelectOption<T extends string> = { value: T; label: string };

export type SelectOptionGroup<T extends string> = {
  label: string;
  options: Array<SelectOption<T>>;
};

export function SelectField<T extends string>({
  label,
  value,
  options,
  groups,
  trailingOptions,
  onChange,
  hint,
  help,
  uppercaseLabel,
  required,
  error,
  alwaysShowHint,
  disabled,
}: {
  label: string;
  value: T;
  options?: Array<SelectOption<T>>;
  groups?: Array<SelectOptionGroup<T>>;
  trailingOptions?: Array<SelectOption<T>>;
  onChange: (v: T) => void;
  hint?: string;
  help?: HelpEntry;
  uppercaseLabel?: boolean;
  required?: boolean;
  error?: string;
  alwaysShowHint?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label={label} help={help} hint={hint} error={error} uppercaseLabel={uppercaseLabel} required={required} alwaysShowHint={alwaysShowHint}>
      <select
        className={`${inputCls} disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
          error ? "border-red-400 text-red-900 focus:border-red-500 focus:ring-red-500" : ""
        }`}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
        {trailingOptions?.map((o) => (
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
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-anypoint px-3 py-1.5 text-sm font-medium transition-anypoint focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  const variants: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary/90",
    secondary: "border border-composer-border bg-composer-surface text-composer-label hover:bg-composer-surface-muted",
    danger: "border border-red-200 bg-composer-surface text-red-600 hover:bg-red-50",
    ghost: "text-composer-label-muted hover:bg-composer-surface-muted hover:text-composer-label",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { helpMode } = useHelpMode();

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-composer-label">{title}</h3>
        {helpMode && description ? (
          <p className="mt-0.5 text-xs leading-snug text-composer-label-muted">{description}</p>
        ) : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-composer-label-muted">{children}</h3>
      {action}
    </div>
  );
}

const KIND_BADGE: Record<string, string> = {
  agent: "bg-violet/10 text-violet",
  mcp: "bg-teal/10 text-teal-700",
  llm: "bg-navy/10 text-navy",
};

export function KindBadge({ kind }: { kind: AssetKind }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-anypoint px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_BADGE[kind] ?? "bg-gray-100 text-gray-600"}`}
    >
      <MuleIcon assetKind={kind} size={12} />
      {kind}
    </span>
  );
}
