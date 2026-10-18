"use client";

import { useActionState } from "react";
import { initialFormState } from "@/lib/form-state";
import { LABEL_LIMIT, PROFILE_FIELD_KEYS, PROFILE_FIELDS, type ProfileFormConfig } from "@/src/domain/participant/profile-form";
import { FormAlert, SubmitButton, type FormAction } from "../ui/form";

/** Organizer settings for the participant profile form: label, shown, required per field. */
export default function ProfileFormSettings({ action, form }: { action: FormAction; form: ProfileFormConfig }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const value = (name: string, fallback: string) => state.values[name] ?? fallback;
  const checked = (name: string, fallback: boolean) => state.values[`${name}.submitted`] ? state.values[name] === "on" : fallback;
  return <form action={formAction} className="form-stack" style={{ maxWidth: 820 }}>
    <FormAlert state={state} />
    <div style={{ overflowX: "auto", position: "relative" }}><table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
      <thead><tr><th>Field</th><th>Label shown to attendees</th><th>Show</th><th>Required</th></tr></thead>
      <tbody>{PROFILE_FIELD_KEYS.map((key) => {
        const setting = form.fields[key];
        const error = state.fieldErrors[`${key}.label`] ?? state.fieldErrors[`${key}.required`];
        return <tr key={key}>
          <td>{PROFILE_FIELDS[key].label}</td>
          <td>
            <label className="visually-hidden" htmlFor={`form-${key}-label`}>Label for {PROFILE_FIELDS[key].label}</label>
            <input id={`form-${key}-label`} name={`${key}.label`} defaultValue={value(`${key}.label`, setting.label)} maxLength={LABEL_LIMIT}
              aria-invalid={error ? true : undefined} style={input} />
            {error && <small className="field-error" style={{ display: "block" }}>{error}</small>}
            <input type="hidden" name={`${key}.shown.submitted`} value="1" />
            <input type="hidden" name={`${key}.required.submitted`} value="1" />
          </td>
          <td><input type="checkbox" name={`${key}.shown`} defaultChecked={checked(`${key}.shown`, setting.shown)} aria-label={`Show ${setting.label}`} /></td>
          <td><input type="checkbox" name={`${key}.required`} defaultChecked={checked(`${key}.required`, setting.required)} aria-label={`Require ${setting.label}`} /></td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="field-hint">Hidden fields keep what attendees already saved, and everything saved still feeds matching. Name, intent and venue zone are always asked.</p>
    <div className="form-actions"><SubmitButton pendingLabel="Saving…">Save profile form</SubmitButton></div>
  </form>;
}

const input = { width: "100%", minWidth: 180, boxSizing: "border-box", padding: "9px 10px", border: "1px solid #3f3f46", borderRadius: 8, background: "#151519", color: "#f4f4f5", font: "inherit" } as const;
