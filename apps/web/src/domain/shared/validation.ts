/**
 * Input limits shared by the forms (maxLength, min/max) and the server-side
 * checks, so the browser and the server always agree on what is accepted.
 */
export const LIMITS = {
  designation: 120,
  domain: 120,
  aboutMe: 1000,
  selfDescription: 500,
  mostImpressiveBuild: 1000,
  yearsOfExperience: 80,
  interestCount: 20,
  interestLength: 40,
  searchQuery: 300,
  introMessage: 500,
  eventNameMin: 2,
  eventName: 120,
  eventDescription: 2000,
  eventSlug: 80,
  zoneCount: 30,
  zoneLength: 80,
  rosterBytes: 10 * 1024 * 1024,
  rosterRows: 10_000,
} as const;

/** A rejected input. `field` names the form field so the UI can show the message beside it. */
export class ValidationError extends Error {
  constructor(readonly field: string | null, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Trims text; empty becomes null. Over-long text is rejected, never silently cut. */
export function boundedText(
  value: string | null | undefined,
  field: string,
  label: string,
  max: number,
  options: { required?: boolean; min?: number } = {}
): string | null {
  const text = value?.trim() ?? "";
  if (!text) {
    if (options.required) throw new ValidationError(field, `${label} is required`);
    return null;
  }
  if (options.min && text.length < options.min) {
    throw new ValidationError(field, `${label} must be at least ${options.min} characters`);
  }
  if (text.length > max) throw new ValidationError(field, `${label} must be ${max} characters or fewer`);
  return text;
}

/** Trims items, dropping blanks and duplicates, within count and per-item length limits. */
export function boundedItems(
  values: readonly string[],
  field: string,
  label: string,
  limits: { count: number; length: number }
): string[] {
  const items = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  if (items.length > limits.count) throw new ValidationError(field, `Use at most ${limits.count} ${label}`);
  if (items.some((item) => item.length > limits.length)) {
    throw new ValidationError(field, `Each of the ${label} must be ${limits.length} characters or fewer`);
  }
  return items;
}

/** Same as boundedItems, for a comma-separated form value. */
export function boundedList(
  value: string | null | undefined,
  field: string,
  label: string,
  limits: { count: number; length: number }
): string[] {
  return boundedItems(String(value ?? "").split(","), field, label, limits);
}
