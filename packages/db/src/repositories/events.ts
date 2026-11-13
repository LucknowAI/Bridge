import { query, transaction } from "../client";

export interface EventRecord {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  name: string;
  slug: string;
  description: string | null;
  status: "draft" | "open" | "closed";
  intents: string[];
  zones: string[];
  form_config: Record<string, unknown>;
  created_at: Date;
}

const EVENT_SELECT = `select e.*, o.name as organization_name, o.slug as organization_slug
  from events e join organizations o on o.id = e.organization_id`;

export async function findBySlug(orgSlug: string, eventSlug: string): Promise<EventRecord | null> {
  const { rows } = await query<EventRecord>(`${EVENT_SELECT} where o.slug = $1 and e.slug = $2 limit 1`, [orgSlug, eventSlug]);
  return rows[0] ?? null;
}

export async function findByEventSlug(eventSlug: string): Promise<EventRecord | null> {
  const { rows } = await query<EventRecord>(`${EVENT_SELECT} where e.slug = $1 order by e.created_at desc limit 1`, [eventSlug]);
  return rows[0] ?? null;
}

export async function findOrganization(slug: string): Promise<{ id: string; name: string; slug: string } | null> {
  const { rows } = await query<{ id: string; name: string; slug: string }>(
    `select id, name, slug from organizations where slug = $1 limit 1`, [slug]
  );
  return rows[0] ?? null;
}

/**
 * The organization's events. With a viewer, only those they may open:
 * everything for organization owners and admins, otherwise their own events.
 */
export async function listForOrganization(orgSlug: string, viewerId?: string): Promise<EventRecord[]> {
  const { rows } = await query<EventRecord>(
    `${EVENT_SELECT}
      where o.slug = $1
        and ($2::uuid is null
             or exists (select 1 from organization_members m
                         where m.organization_id = o.id and m.attendee_id = $2 and m.role in ('owner', 'admin'))
             or exists (select 1 from event_organizers eo where eo.event_id = e.id and eo.attendee_id = $2))
      order by e.created_at desc`,
    [orgSlug, viewerId ?? null]
  );
  return rows;
}

export type OrganizerRole = "owner" | "admin" | "organizer";

/** The attendee's role on the event and in its organization (null when none). */
export async function organizerRoles(eventId: string, attendeeId: string): Promise<{ event: OrganizerRole | null; organization: OrganizerRole | null }> {
  const { rows } = await query<{ event_role: OrganizerRole | null; organization_role: OrganizerRole | null }>(
    `select (select role from event_organizers where event_id = $1 and attendee_id = $2) as event_role,
            (select m.role from organization_members m join events e on e.organization_id = m.organization_id
              where e.id = $1 and m.attendee_id = $2) as organization_role`,
    [eventId, attendeeId]
  );
  return { event: rows[0]?.event_role ?? null, organization: rows[0]?.organization_role ?? null };
}

export async function create(input: {
  organizationId: string;
  organizerId: string;
  name: string;
  slug: string;
  description?: string | null;
}): Promise<EventRecord> {
  return transaction(async (client) => {
    const { rows } = await client.query<EventRecord>(
      `insert into events (organization_id, name, slug, description)
       select $1, $3, $4, $5
        where exists (select 1 from organization_members where organization_id = $1 and attendee_id = $2)
       returning *, ''::text as organization_name, ''::text as organization_slug`,
      [input.organizationId, input.organizerId, input.name.trim(), input.slug, input.description?.trim() || null]
    );
    const event = rows[0];
    if (!event) throw new Error("You do not have permission to create events for this organization");
    await client.query(
      `insert into event_organizers (event_id, attendee_id, role)
       values ($1, $2, 'owner') on conflict (event_id, attendee_id) do nothing`,
      [event.id, input.organizerId]
    );
    return event;
  });
}

export async function update(input: {
  eventId: string;
  organizerId: string;
  name?: string;
  description?: string | null;
  status?: EventRecord["status"];
  intents?: string[];
  zones?: string[];
  formConfig?: Record<string, unknown>;
}): Promise<EventRecord | null> {
  const { rows } = await query<EventRecord>(
    `${EVENT_SELECT}
      where e.id = $1
        and (exists (select 1 from event_organizers eo where eo.event_id = e.id and eo.attendee_id = $2)
             or exists (select 1 from organization_members m
                         where m.organization_id = e.organization_id and m.attendee_id = $2 and m.role in ('owner', 'admin')))
      limit 1`,
    [input.eventId, input.organizerId]
  );
  if (!rows[0]) return null;
  const old = rows[0];
  const updated = await query(
    `update events set
       name = $2, description = $3, status = $4, intents = $5::jsonb,
       zones = $6::jsonb, form_config = $7::jsonb, updated_at = now()
     where id = $1`,
    [input.eventId, input.name?.trim() || old.name, input.description === undefined ? old.description : input.description,
      input.status ?? old.status, JSON.stringify(input.intents ?? old.intents), JSON.stringify(input.zones ?? old.zones),
      JSON.stringify(input.formConfig ?? old.form_config)]
  );
  void updated;
  return findBySlug(old.organization_slug, old.slug);
}

/** Name and public slug, for notification text and links. */
export async function basics(eventId: string): Promise<{ name: string; slug: string } | null> {
  const { rows } = await query<{ name: string; slug: string }>(`select name, slug from events where id = $1`, [eventId]);
  return rows[0] ?? null;
}

/** The event's status, or null when the event no longer exists. */
export async function statusOf(eventId: string): Promise<EventRecord["status"] | null> {
  const { rows } = await query<{ status: EventRecord["status"] }>(`select status from events where id = $1`, [eventId]);
  return rows[0]?.status ?? null;
}

/** Whether the attendee may open the event's organizer pages (any event role, or organization owner/admin). */
export async function isOrganizer(eventId: string, attendeeId: string): Promise<boolean> {
  const roles = await organizerRoles(eventId, attendeeId);
  return roles.event !== null || roles.organization === "owner" || roles.organization === "admin";
}

export async function isParticipant(eventId: string, attendeeId: string): Promise<boolean> {
  const { rows } = await query<{ allowed: boolean }>(
    `select exists(
       select 1 from event_participants where event_id = $1 and attendee_id = $2 and revoked_at is null
     ) as allowed`,
    [eventId, attendeeId]
  );
  return rows[0]?.allowed ?? false;
}

export async function hasOrganizationAccess(organizationSlug: string, attendeeId: string): Promise<boolean> {
  const { rows } = await query<{ allowed: boolean }>(
    `select exists(
       select 1 from organization_members m join organizations o on o.id = m.organization_id
        where o.slug = $1 and m.attendee_id = $2
     ) as allowed`, [organizationSlug, attendeeId]
  );
  return rows[0]?.allowed ?? false;
}

export async function participantIds(eventId: string): Promise<string[]> {
  const { rows } = await query<{ attendee_id: string }>(
    `select attendee_id from event_participants
      where event_id = $1 and profile_updated_at is not null and revoked_at is null`, [eventId]
  );
  return rows.map((row) => row.attendee_id);
}

export async function attachRoster(eventId: string, attendeeIds: string[]): Promise<number> {
  if (!attendeeIds.length) return 0;
  const values: unknown[] = [];
  const tuples = attendeeIds.map((id, index) => {
    values.push(eventId, id);
    return `($${index * 2 + 1}, $${index * 2 + 2})`;
  });
  const { rowCount } = await query(
    `insert into event_participants (event_id, attendee_id)
     values ${tuples.join(", ")} on conflict (event_id, attendee_id) do nothing`, values
  );
  return rowCount ?? 0;
}

export async function roster(eventId: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await query(
    `select a.id, a.name, a.email, a.phone,
            coalesce(p.designation, a.designation) as designation,
            coalesce(p.domain, a.domain) as domain,
            p.intent, p.visible, p.profile_updated_at,
            p.invited_at, p.invite_count, p.invite_error, p.claimed_at, p.revoked_at
       from event_participants p join registered_attendees a on a.id = p.attendee_id
      where p.event_id = $1 order by a.name nulls last`, [eventId]
  );
  return rows;
}

export interface InvitationTarget {
  attendee_id: string;
  email: string;
  name: string | null;
}

/**
 * Who an invitation e-mail should go to: one attendee (a resend), or everyone
 * never invited. Never revoked or already-claimed attendees, and a resend only
 * once `resendAfterMinutes` have passed since the last one.
 */
export async function invitationTargets(eventId: string, attendeeId: string | null, resendAfterMinutes: number): Promise<InvitationTarget[]> {
  const { rows } = await query<InvitationTarget>(
    `select a.id as attendee_id, a.email, a.name
       from event_participants p join registered_attendees a on a.id = p.attendee_id
      where p.event_id = $1 and p.revoked_at is null and p.claimed_at is null and a.email is not null
        and ($2::uuid is null and p.invited_at is null
             or a.id = $2::uuid and (p.invited_at is null or p.invited_at < now() - make_interval(mins => $3)))
      order by a.name nulls last`,
    [eventId, attendeeId, resendAfterMinutes]
  );
  return rows;
}

/** Records one delivery attempt; a failure keeps the last successful send time. */
export async function recordInvitation(eventId: string, attendeeId: string, error: string | null): Promise<void> {
  await query(
    `update event_participants
        set invited_at = case when $3::text is null then now() else invited_at end,
            invite_count = invite_count + case when $3::text is null then 1 else 0 end,
            invite_error = $3, updated_at = now()
      where event_id = $1 and attendee_id = $2`,
    [eventId, attendeeId, error]
  );
}

/** The first signed-in visit to the event claims the invitation. */
export async function markClaimed(eventId: string, attendeeId: string): Promise<void> {
  await query(
    `update event_participants set claimed_at = now()
      where event_id = $1 and attendee_id = $2 and claimed_at is null and revoked_at is null`,
    [eventId, attendeeId]
  );
}

/** Removes or restores an attendee's access; returns false when they are not on the roster. */
export async function setRevoked(eventId: string, attendeeId: string, revoked: boolean): Promise<boolean> {
  const { rowCount } = await query(
    `update event_participants
        set revoked_at = case when $3 then coalesce(revoked_at, now()) else null end, updated_at = now()
      where event_id = $1 and attendee_id = $2`,
    [eventId, attendeeId, revoked]
  );
  // Explanations written about or for a removed attendee are not kept.
  if (revoked && rowCount) {
    await query(`delete from pair_explanations where event_id = $1 and (viewer_id = $2 or candidate_id = $2)`, [eventId, attendeeId]);
    await query(`delete from rerank_orders where event_id = $1 and (viewer_id = $2 or $2::uuid = any(candidate_ids))`, [eventId, attendeeId]);
  }
  return (rowCount ?? 0) > 0;
}

/** Whether an attendee is on the roster, and if so whether access was removed. */
export async function rosterState(eventId: string, attendeeId: string): Promise<"active" | "revoked" | null> {
  const { rows } = await query<{ revoked: boolean }>(
    `select revoked_at is not null as revoked from event_participants where event_id = $1 and attendee_id = $2`,
    [eventId, attendeeId]
  );
  if (!rows[0]) return null;
  return rows[0].revoked ? "revoked" : "active";
}

export interface RosterRow {
  name: string | null;
  email: string;
  phone: string | null;
  about_me: string | null;
  designation: string | null;
  domain: string | null;
  self_description: string | null;
  years_of_experience: number | null;
  most_impressive_build: string | null;
}

export interface RosterImportResult {
  /** People not known before this import. */
  created: number;
  /** People newly added to this event (created or already known). */
  attached: number;
  /** People already on this event's roster. */
  alreadyOnRoster: number;
  /** Known people whose existing details differ from the sheet and were kept. */
  keptExisting: number;
  /** New people whose phone already belongs to someone else; imported without it. */
  phoneConflicts: number;
}

const DETAIL_COLUMNS = ["name", "phone", "about_me", "designation", "domain", "self_description", "years_of_experience", "most_impressive_build"] as const;

/**
 * Imports a validated roster in one transaction, so a failure leaves nothing
 * half-applied and retrying the same file is safe.
 *
 * People are identified by e-mail and shared across organizations, so an
 * import never replaces anyone's existing name, phone or details: it only
 * fills fields that are empty. A phone that already belongs to someone else
 * is left off the new person instead of failing the whole import.
 */
export async function importRoster(eventId: string, rows: RosterRow[]): Promise<RosterImportResult> {
  return transaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext('roster-import:' || $1))`, [eventId]);
    const result: RosterImportResult = { created: 0, attached: 0, alreadyOnRoster: 0, keptExisting: 0, phoneConflicts: 0 };
    if (!rows.length) return result;

    const emails = rows.map((row) => row.email);
    const phones = rows.map((row) => row.phone).filter((phone): phone is string => Boolean(phone));
    const { rows: known } = await client.query<RosterRow & { id: string }>(
      `select id, ${DETAIL_COLUMNS.join(", ")}, email from registered_attendees
        where email = any($1::text[]) or phone = any($2::text[])`,
      [emails, phones]
    );
    const byEmail = new Map(known.filter((row) => row.email).map((row) => [row.email, row]));
    const phoneOwner = new Map(known.filter((row) => row.phone).map((row) => [row.phone!, row.email]));

    for (const row of rows) {
      const existing = byEmail.get(row.email);
      if (existing) {
        if (DETAIL_COLUMNS.some((column) => row[column] != null && existing[column] != null && String(row[column]) !== String(existing[column]))) {
          result.keptExisting += 1;
        }
        const freePhone = row.phone && !existing.phone && !phoneOwner.has(row.phone) ? row.phone : null;
        await client.query(
          `update registered_attendees set
             ${DETAIL_COLUMNS.map((column, index) => `${column} = coalesce(${column}, $${index + 2})`).join(", ")},
             updated_at = now()
           where id = $1`,
          [existing.id, ...DETAIL_COLUMNS.map((column) => column === "phone" ? freePhone : row[column])]
        );
        if (freePhone) phoneOwner.set(freePhone, row.email);
        continue;
      }
      const phoneTaken = Boolean(row.phone && phoneOwner.has(row.phone));
      if (phoneTaken) result.phoneConflicts += 1;
      const columns = ["email", ...DETAIL_COLUMNS];
      await client.query(
        `insert into registered_attendees (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
        [row.email, ...DETAIL_COLUMNS.map((column) => column === "phone" && phoneTaken ? null : row[column])]
      );
      if (row.phone && !phoneTaken) phoneOwner.set(row.phone, row.email);
      result.created += 1;
    }

    const { rows: attached } = await client.query<{ attached: boolean }>(
      `insert into event_participants (event_id, attendee_id)
       select $1, a.id from registered_attendees a where a.email = any($2::text[])
       on conflict (event_id, attendee_id) do nothing
       returning true as attached`,
      [eventId, emails]
    );
    result.attached = attached.length;
    result.alreadyOnRoster = new Set(emails).size - attached.length;
    return result;
  });
}
