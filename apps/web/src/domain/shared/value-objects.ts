/** Stable identifiers crossing application and persistence boundaries. */
export type EventId = string;
export type OrganizationId = string;
export type ParticipantId = string;
export type IntroRequestId = string;

export function assertNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
