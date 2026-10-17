"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { initialFormState, type FormState } from "@/lib/form-state";

export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

/** Disabled while its form is submitting, so a slow save cannot be sent twice. */
export function SubmitButton({ children, pendingLabel, secondary }: { children: ReactNode; pendingLabel: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={secondary ? "btn btn-secondary" : "btn"} disabled={pending} aria-busy={pending}>
    {pending ? pendingLabel : children}
  </button>;
}

/** Form-level error, announced to screen readers when it appears. */
export function FormAlert({ state }: { state: FormState }) {
  return state.error ? <p role="alert" className="form-alert">{state.error}</p> : null;
}

interface FieldProps {
  label: string;
  name: string;
  state: FormState;
  defaultValue?: string | number | null;
  hint?: string;
  required?: boolean;
}

function fieldAria(name: string, state: FormState, hint?: string) {
  const error = state.fieldErrors[name];
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(" ") || undefined;
  return { error, props: { id: `field-${name}`, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy } };
}

function FieldShell({ label, name, hint, error, required, children }: { label: string; name: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return <div className="field">
    <label htmlFor={`field-${name}`}>{label}{required && <span aria-hidden="true"> *</span>}</label>
    {children}
    {hint && <small id={`${name}-hint`} className="field-hint">{hint}</small>}
    {error && <small id={`${name}-error`} className="field-error">{error}</small>}
  </div>;
}

/** Text input or textarea that keeps the submitted value after a rejected save. */
export function TextField({ label, name, state, defaultValue, hint, required, multiline, rows, ...input }: FieldProps & {
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  type?: "text" | "number";
  min?: number;
  max?: number;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const { error, props } = fieldAria(name, state, hint);
  const value = state.values[name] ?? (defaultValue == null ? "" : String(defaultValue));
  return <FieldShell label={label} name={name} hint={hint} error={error} required={required}>
    {multiline
      ? <textarea {...props} defaultValue={value} rows={rows ?? 3} required={required} maxLength={input.maxLength} placeholder={input.placeholder} />
      : <input {...props} {...input} defaultValue={value} required={required} />}
  </FieldShell>;
}

export function SelectField({ label, name, state, defaultValue, hint, required, options, placeholder }: FieldProps & {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  const { error, props } = fieldAria(name, state, hint);
  return <FieldShell label={label} name={name} hint={hint} error={error} required={required}>
    <select {...props} defaultValue={state.values[name] ?? String(defaultValue ?? "")} required={required}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </FieldShell>;
}

/** A small form (one button, maybe one control) that shows its own error inline. */
export function ActionForm({ action, label, pendingLabel, secondary, hidden, children }: {
  action: FormAction;
  label: string;
  pendingLabel: string;
  secondary?: boolean;
  hidden?: Record<string, string>;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  // No fields to highlight here, so show the field's own message.
  const message = Object.values(state.fieldErrors)[0] ?? state.error;
  return <form action={formAction} className="action-form">
    {Object.entries(hidden ?? {}).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    {children}
    <SubmitButton pendingLabel={pendingLabel} secondary={secondary}>{label}</SubmitButton>
    {message && <p role="alert" className="field-error">{message}</p>}
  </form>;
}
