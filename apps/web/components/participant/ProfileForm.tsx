"use client";

import { useActionState } from "react";
import { initialFormState } from "@/lib/form-state";
import { LIMITS } from "@/src/domain/shared/validation";
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
}

const label = (intent: string) => intent.replaceAll("_", " ").toLowerCase();

export default function ProfileForm({ action, profile, intents, zones }: {
  action: FormAction;
  profile: ProfileFormValues;
  intents: string[];
  zones: string[];
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return <form action={formAction} className="form-grid">
    <FormAlert state={state} />
    <TextField label="Name" name="name" state={state} defaultValue={profile.name} readOnly hint="From your registration" />
    <TextField label="Role or designation" name="designation" state={state} defaultValue={profile.designation} required maxLength={LIMITS.designation} />
    <TextField label="Professional domain" name="domain" state={state} defaultValue={profile.domain} required maxLength={LIMITS.domain} />
    <TextField label="About you" name="aboutMe" state={state} defaultValue={profile.aboutMe} required multiline maxLength={LIMITS.aboutMe}
      hint={`Up to ${LIMITS.aboutMe} characters`} />
    <TextField label="Current focus" name="selfDescription" state={state} defaultValue={profile.selfDescription} multiline rows={2}
      maxLength={LIMITS.selfDescription} />
    <TextField label="Most impressive thing you have built" name="mostImpressiveBuild" state={state} defaultValue={profile.mostImpressiveBuild}
      multiline rows={2} maxLength={LIMITS.mostImpressiveBuild} />
    <TextField label="Years of experience" name="yearsOfExperience" state={state} defaultValue={profile.yearsOfExperience}
      type="number" min={0} max={LIMITS.yearsOfExperience} />
    <TextField label="Interests" name="interests" state={state} defaultValue={profile.interests.join(", ")} placeholder="AI, product, climate"
      hint={`Separate with commas, up to ${LIMITS.interestCount}`} />
    <SelectField label="What are you looking for?" name="intent" state={state} defaultValue={profile.intent}
      options={intents.map((intent) => ({ value: intent, label: label(intent) }))} />
    {zones.length > 0 && <SelectField label="Where can people find you?" name="venueZone" state={state} defaultValue={profile.venueZone}
      placeholder="Choose a venue zone" options={zones.map((zone) => ({ value: zone, label: zone }))} />}
    <div className="form-actions"><SubmitButton pendingLabel="Saving your profile…">Save profile and find matches</SubmitButton></div>
  </form>;
}
