"use client";

import { useActionState } from "react";
import { initialFormState } from "@/lib/form-state";
import { LIMITS } from "@/src/domain/shared/validation";
import { FormAlert, SelectField, SubmitButton, TextField, type FormAction } from "../ui/form";

export function NewEventForm({ action }: { action: FormAction }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return <form action={formAction} className="form-stack">
    <FormAlert state={state} />
    <TextField label="Event name" name="name" state={state} required maxLength={LIMITS.eventName} placeholder="AI Community Meetup" />
    <TextField label="URL slug" name="slug" state={state} maxLength={LIMITS.eventSlug} placeholder="meetup-2026"
      hint="Optional. Built from the event name when left blank." />
    <TextField label="Description" name="description" state={state} multiline maxLength={LIMITS.eventDescription} />
    <div className="form-actions"><SubmitButton pendingLabel="Creating event…">Create event</SubmitButton></div>
  </form>;
}

export function EventSetupForm({ action, event }: {
  action: FormAction;
  event: { name: string; description: string | null; status: string; intents: string[]; zones: string[] };
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return <form action={formAction} className="form-stack">
    <FormAlert state={state} />
    <TextField label="Event name" name="name" state={state} defaultValue={event.name} required maxLength={LIMITS.eventName} />
    <TextField label="Description" name="description" state={state} defaultValue={event.description} multiline maxLength={LIMITS.eventDescription} />
    <SelectField label="Registration status" name="status" state={state} defaultValue={event.status} options={[
      { value: "draft", label: "Draft" }, { value: "open", label: "Open registration" }, { value: "closed", label: "Closed" },
    ]} />
    <TextField label="Supported intents" name="intents" state={state} defaultValue={event.intents.join(", ")} required
      hint="Comma separated, e.g. NETWORKING, HIRING, MENTORING" />
    <TextField label="Venue zones" name="zones" state={state} defaultValue={event.zones.join(", ")} placeholder="Main hall, Workshop room"
      hint={`Comma separated, up to ${LIMITS.zoneCount} zones of ${LIMITS.zoneLength} characters`} />
    <div className="form-actions"><SubmitButton pendingLabel="Saving…">Save event configuration</SubmitButton></div>
  </form>;
}

export function RosterUploadForm({ action }: { action: FormAction }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = state.fieldErrors.file;
  return <form action={formAction} className="upload-form">
    <FormAlert state={state} />
    <div className="field">
      <label htmlFor="field-file">Import an Excel roster (.xlsx or .xls)</label>
      <input id="field-file" type="file" name="file" accept=".xlsx,.xls" required aria-describedby={error ? "file-hint file-error" : "file-hint"}
        aria-invalid={error ? true : undefined} />
      <small id="file-hint" className="field-hint">Up to 10 MB and {LIMITS.rosterRows.toLocaleString("en")} rows. Needs an e-mail column.</small>
      {error && <small id="file-error" className="field-error">{error}</small>}
    </div>
    <SubmitButton pendingLabel="Importing…">Import roster</SubmitButton>
  </form>;
}
