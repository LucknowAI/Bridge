import { boundedText, LIMITS, ValidationError } from "../shared/validation";

/**
 * The profile fields an organizer can configure for an event. They are the
 * fields matching already reads, so whatever the form shows, every stored
 * value keeps feeding matching the same way. Intent and venue zone are
 * configured separately (event intents and zones).
 */
export const PROFILE_FIELDS = {
  designation: { label: "Role or designation", kind: "text", limit: LIMITS.designation, required: true, descriptive: true },
  domain: { label: "Professional domain", kind: "text", limit: LIMITS.domain, required: true, descriptive: true },
  aboutMe: { label: "About you", kind: "multiline", limit: LIMITS.aboutMe, required: true, descriptive: true },
  selfDescription: { label: "Current focus", kind: "multiline", limit: LIMITS.selfDescription, required: false, descriptive: true },
  mostImpressiveBuild: { label: "Most impressive thing you have built", kind: "multiline", limit: LIMITS.mostImpressiveBuild, required: false, descriptive: true },
  yearsOfExperience: { label: "Years of experience", kind: "number", limit: LIMITS.yearsOfExperience, required: false, descriptive: false },
  interests: { label: "Interests", kind: "list", limit: LIMITS.interestCount, required: false, descriptive: false },
} as const;

export type ProfileFieldKey = keyof typeof PROFILE_FIELDS;
export const PROFILE_FIELD_KEYS = Object.keys(PROFILE_FIELDS) as ProfileFieldKey[];

export interface ProfileFieldSetting {
  shown: boolean;
  required: boolean;
  label: string;
}

export interface ProfileFormConfig {
  /** Goes up on every change, so profiles saved under an older form can be found. */
  version: number;
  fields: Record<ProfileFieldKey, ProfileFieldSetting>;
}

export const LABEL_LIMIT = 60;

/** The event's stored form_config, with defaults for anything missing or malformed. */
export function readProfileForm(raw: unknown): ProfileFormConfig {
  const stored = (raw && typeof raw === "object" ? raw : {}) as { version?: unknown; fields?: Record<string, Partial<ProfileFieldSetting>> };
  const fields = {} as Record<ProfileFieldKey, ProfileFieldSetting>;
  for (const key of PROFILE_FIELD_KEYS) {
    const field = stored.fields?.[key] ?? {};
    const shown = typeof field.shown === "boolean" ? field.shown : true;
    fields[key] = {
      shown,
      required: shown && (typeof field.required === "boolean" ? field.required : PROFILE_FIELDS[key].required),
      label: typeof field.label === "string" && field.label.trim() ? field.label.trim().slice(0, LABEL_LIMIT) : PROFILE_FIELDS[key].label,
    };
  }
  return { version: Number.isInteger(stored.version) ? stored.version as number : 0, fields };
}

/** Validates an organizer's form settings and stamps the next version. */
export function buildProfileForm(settings: Record<ProfileFieldKey, ProfileFieldSetting>, previous: ProfileFormConfig): ProfileFormConfig {
  const fields = {} as Record<ProfileFieldKey, ProfileFieldSetting>;
  for (const key of PROFILE_FIELD_KEYS) {
    const setting = settings[key];
    const label = boundedText(setting.label, `${key}.label`, `${PROFILE_FIELDS[key].label} label`, LABEL_LIMIT) ?? PROFILE_FIELDS[key].label;
    if (setting.required && !setting.shown) {
      throw new ValidationError(`${key}.required`, `"${label}" cannot be required while it is hidden`);
    }
    fields[key] = { shown: setting.shown, required: setting.required, label };
  }
  if (!PROFILE_FIELD_KEYS.some((key) => PROFILE_FIELDS[key].descriptive && fields[key].required)) {
    throw new ValidationError(null, "Keep at least one descriptive field (role, domain, about, focus or build) required, so matching has something to read.");
  }
  return { version: previous.version + 1, fields };
}

/** Required fields a saved profile leaves empty under the current form. */
export function missingRequiredFields(form: ProfileFormConfig, values: Partial<Record<ProfileFieldKey, unknown>>): ProfileFieldKey[] {
  return PROFILE_FIELD_KEYS.filter((key) => {
    if (!form.fields[key].required) return false;
    const value = values[key];
    return value == null || (Array.isArray(value) ? value.length === 0 : String(value).trim() === "");
  });
}
