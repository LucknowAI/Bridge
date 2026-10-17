import { attendees, events, query } from "@match-maker/db";
import type { EventRepository, EventRecord } from "../../application/ports/event-repository";

export class PostgresEventRepository implements EventRepository {
  findBySlug(organizationSlug: string, eventSlug: string) {
    return events.findBySlug(organizationSlug, eventSlug);
  }
  findByEventSlug(eventSlug: string) {
    return events.findByEventSlug(eventSlug);
  }
  findOrganization(slug: string) {
    return events.findOrganization(slug);
  }
  listForOrganization(organizationSlug: string) {
    return events.listForOrganization(organizationSlug);
  }
  hasOrganizationAccess(organizationSlug: string, attendeeId: string) {
    return events.hasOrganizationAccess(organizationSlug, attendeeId);
  }
  isOrganizer(eventId: string, attendeeId: string) {
    return events.isOrganizer(eventId, attendeeId);
  }
  async create(input: { organizationId: string; organizerId: string; name: string; slug: string; description?: string | null }) {
    const created = await events.create(input);
    const resolved = await events.findBySlug(created.organization_slug || "", input.slug);
    return (resolved ?? created) as EventRecord;
  }
  update(input: Parameters<EventRepository["update"]>[0]) {
    return events.update(input);
  }
  roster(eventId: string) {
    return events.roster(eventId);
  }
  attachRoster(eventId: string, attendeeIds: string[]) {
    return events.attachRoster(eventId, attendeeIds);
  }
  participantIds(eventId: string) {
    return events.participantIds(eventId);
  }

  async importRoster(eventId: string, records: Parameters<EventRepository["importRoster"]>[1]) {
    let upserted = 0;
    for (let offset = 0; offset < records.length; offset += 100) {
      upserted += await attendees.upsertMany(records.slice(offset, offset + 100));
    }
    const rows = await attendees.findIdsByEmails(records.map((record) => record.email));
    const attached = await events.attachRoster(eventId, rows.map((row) => row.id));
    return { upserted, attached };
  }

  async analytics(eventId: string) {
    const { rows } = await query<{
      roster: string;
      profiles: string;
      matches: string;
      pending_intros: string;
      accepted_intros: string;
    }>(
      `select
         (select count(*) from event_participants where event_id = $1) as roster,
         (select count(*) from event_participants where event_id = $1 and profile_updated_at is not null) as profiles,
         (select count(*) from event_matches where event_id = $1) as matches,
         (select count(*) from intro_requests where event_id = $1 and status = 'pending') as pending_intros,
         (select count(*) from intro_requests where event_id = $1 and status = 'accepted') as accepted_intros`,
      [eventId]
    );
    return {
      roster: Number(rows[0]?.roster ?? 0),
      profiles: Number(rows[0]?.profiles ?? 0),
      matches: Number(rows[0]?.matches ?? 0),
      pendingIntros: Number(rows[0]?.pending_intros ?? 0),
      acceptedIntros: Number(rows[0]?.accepted_intros ?? 0),
    };
  }
}
