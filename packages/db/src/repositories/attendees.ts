import { query } from "../client";
import type { Attendee, PublicAttendee } from "../types";

/**
 * Columns exposed to the browser. `email` and `phone` are deliberately absent —
 * under Supabase these leaked to the client through the anon key, and the whole
 * point of moving reads server-side is that contact details stay here.
 */
const PUBLIC_COLUMNS = `
  id, name, designation, domain, about_me,
  self_description, years_of_experience, most_impressive_build
`;

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Coerce a user-supplied phone number to E.164, assuming +91 when no country
 * code is present. Kept identical to the original POC behaviour so existing
 * imported rows still match.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return `+${digits}`;
}

export async function findByEmail(email: string): Promise<Attendee | null> {
  const { rows } = await query<Attendee>(
    `select * from registered_attendees where email = $1 limit 1`,
    [normalizeEmail(email)]
  );
  return rows[0] ?? null;
}

export async function findByPhone(phone: string): Promise<Attendee | null> {
  const { rows } = await query<Attendee>(
    `select * from registered_attendees where phone = $1 limit 1`,
    [normalizePhone(phone)]
  );
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<Attendee | null> {
  const { rows } = await query<Attendee>(
    `select * from registered_attendees where id = $1 limit 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findIdsByEmails(emails: string[]): Promise<Array<{ id: string; email: string }>> {
  if (!emails.length) return [];
  const normalized = emails.map(normalizeEmail);
  const { rows } = await query<{ id: string; email: string }>(
    `select id, email from registered_attendees where email = any($1::text[])`,
    [normalized]
  );
  return rows;
}

/** True when the e-mail is on the attendee roster — the gate for every login. */
export async function isRegisteredEmail(email: string): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `select exists(select 1 from registered_attendees where email = $1) as exists`,
    [normalizeEmail(email)]
  );
  return rows[0]?.exists ?? false;
}

/**
 * Every attendee eligible to be matched, minus the requester.
 * `excludeId` is applied in SQL so the excluded row never reaches the process.
 */
export async function listMatchCandidates(
  excludeId: string | null
): Promise<PublicAttendee[]> {
  const { rows } = await query<PublicAttendee>(
    `select ${PUBLIC_COLUMNS}
       from registered_attendees
      where name is not null
        and ($1::uuid is null or id <> $1::uuid)
      order by created_at asc`,
    [excludeId]
  );
  return rows;
}

/** Distinct non-empty domains, for the profile dropdown. */
export async function listDomains(): Promise<string[]> {
  const { rows } = await query<{ domain: string }>(
    `select distinct domain
       from registered_attendees
      where domain is not null and domain <> ''
      order by domain asc`
  );
  return rows.map((r) => r.domain);
}

/**
 * Insert-or-update by e-mail, used by the Excel importer.
 * Returns the number of rows written.
 */
export async function upsertMany(
  records: Array<Partial<Attendee>>
): Promise<number> {
  if (records.length === 0) return 0;

  const columns = [
    "name",
    "email",
    "phone",
    "about_me",
    "designation",
    "domain",
    "self_description",
    "years_of_experience",
    "most_impressive_build",
  ] as const;

  const values: unknown[] = [];
  const tuples = records.map((record, rowIndex) => {
    const placeholders = columns.map((column, colIndex) => {
      values.push(record[column] ?? null);
      return `$${rowIndex * columns.length + colIndex + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const updates = columns
    .filter((c) => c !== "email")
    // COALESCE keeps an existing value when the incoming sheet leaves a cell blank.
    .map((c) => `${c} = coalesce(excluded.${c}, registered_attendees.${c})`)
    .join(", ");

  const { rowCount } = await query(
    `insert into registered_attendees (${columns.join(", ")})
     values ${tuples.join(", ")}
     on conflict (email) do update
        set ${updates}, updated_at = now()`,
    values
  );

  return rowCount ?? 0;
}
