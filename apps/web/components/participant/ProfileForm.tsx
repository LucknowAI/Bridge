"use client";

import { useActionState } from "react";
import { initialFormState } from "@/lib/form-state";
import { LIMITS } from "@/src/domain/shared/validation";
import type { ProfileFormConfig } from "@/src/domain/participant/profile-form";
import { FormAlert, SelectField, SubmitButton, TextField, type FormAction } from "../ui/form";

export interface ProfileFormValues {
  name: string;
  designation: string | null;
  domain: string | null;
  aboutMe: string | null;
  selfDescription: string | null;
  mostImpressiveBuild: string | null;
  yearsOfExperience: number | null;
  interests: string[];
  intent: string;
  venueZone: string | null;
  visible: boolean;
}

const label = (intent: string) => intent.replaceAll("_", " ").toLowerCase();

/** The participant profile, shaped by the event's profile form (labels, hidden and required fields). */
export default function ProfileForm({ action, profile, intents, zones, form }: {
  action: FormAction;
  profile: ProfileFormValues;
  intents: string[];
  zones: string[];
  form: ProfileFormConfig;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const field = form.fields;
  return <form action={formAction} className="form-grid">
    <FormAlert state={state} />
    <TextField label="Name" name="name" state={state} defaultValue={profile.name} readOnly hint="From your registration" />
    {field.designation.shown && <TextField label={field.designation.label} name="designation" state={state} defaultValue={profile.designation}
      required={field.designation.required} maxLength={LIMITS.designation} />}
    {field.domain.shown && <TextField label={field.domain.label} name="domain" state={state} defaultValue={profile.domain}
      required={field.domain.required} maxLength={LIMITS.domain} />}
    {field.aboutMe.shown && <TextField label={field.aboutMe.label} name="aboutMe" state={state} defaultValue={profile.aboutMe}
      required={field.aboutMe.required} multiline maxLength={LIMITS.aboutMe} hint={`Up to ${LIMITS.aboutMe} characters`} />}
    {field.selfDescription.shown && <TextField label={field.selfDescription.label} name="selfDescription" state={state} defaultValue={profile.selfDescription}
      required={field.selfDescription.required} multiline rows={2} maxLength={LIMITS.selfDescription} />}
    {field.mostImpressiveBuild.shown && <TextField label={field.mostImpressiveBuild.label} name="mostImpressiveBuild" state={state}
      defaultValue={profile.mostImpressiveBuild} required={field.mostImpressiveBuild.required} multiline rows={2} maxLength={LIMITS.mostImpressiveBuild} />}
    {field.yearsOfExperience.shown && <TextField label={field.yearsOfExperience.label} name="yearsOfExperience" state={state}
      defaultValue={profile.yearsOfExperience} required={field.yearsOfExperience.required} type="number" min={0} max={LIMITS.yearsOfExperience} />}
    {field.interests.shown && <TextField label={field.interests.label} name="interests" state={state} defaultValue={profile.interests.join(", ")}
      required={field.interests.required} placeholder="AI, product, climate" hint={`Separate with commas, up to ${LIMITS.interestCount}`} />}
    <SelectField label="What are you looking for?" name="intent" state={state} defaultValue={profile.intent}
      options={intents.map((intent) => ({ value: intent, label: label(intent) }))} />
    {zones.length > 0 && <SelectField label="Where can people find you?" name="venueZone" state={state} defaultValue={profile.venueZone}
      placeholder="Choose a venue zone" options={zones.map((zone) => ({ value: zone, label: zone }))} />}
    <div className="field" style={{ gridColumn: "1 / -1" }}>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 400 }}>
        <input type="hidden" name="visible.submitted" value="1" />
        <input type="checkbox" name="visible" defaultChecked={state.values["visible.submitted"] ? state.values.visible === "on" : profile.visible} />
        Show my profile in other attendees&apos; matches and search
      </label>
      <small className="field-hint">Hidden, you can still browse and keep your accepted connections; nobody new can find you or request an introduction.</small>
    </div>
    <div className="form-actions"><SubmitButton pendingLabel="Saving your profile…">Save profile and find matches</SubmitButton></div>
  </form>;
}
