import { outbox, query, transaction } from "@match-maker/db";
import type { IntroRepository } from "../../application/ports/intro-repository";
import type { IntroRequest, IntroStatus } from "../../domain/connection/intro-request.entity";

interface IntroRow {
  id: string;
  event_id: string;
  requester_id: string;
  recipient_id: string;
  status: IntroStatus;
  message: string | null;
  created_at: Date;
  responded_at: Date | null;
}

const INTRO_COLUMNS = "id, event_id, requester_id, recipient_id, status, message, created_at, responded_at";
const INTRO_COLUMNS_R = "r.id, r.event_id, r.requester_id, r.recipient_id, r.status, r.message, r.created_at, r.responded_at";

export class PostgresIntroRepository implements IntroRepository {
  async create(input: { eventId: string; requesterId: string; recipientId: string; message?: string | null }): Promise<IntroRequest> {
    if (input.requesterId === input.recipientId) throw new Error("You cannot request an intro to yourself");
    const message = input.message?.trim().slice(0, 500) || null;
    // The request and its notification commit together, so neither is lost.
    const created = await transaction(async (client) => {
      const { rows } = await client.query<IntroRow>(
        `insert into intro_requests (event_id, requester_id, recipient_id, message)
         values ($1, $2, $3, $4)
         on conflict (event_id, requester_id, recipient_id) do nothing
         returning ${INTRO_COLUMNS}`,
        [input.eventId, input.requesterId, input.recipientId, message]
      );
      if (!rows[0]) return null;
      await outbox.enqueue({ eventId: input.eventId, recipientId: input.recipientId, kind: "intro.requested", subjectId: rows[0].id, dedupeKey: `intro.requested:${rows[0].id}` }, client);
      return rows[0];
    });
    if (created) return mapIntro(created);
    throw new Error("An intro request already exists between these participants");
  }

  async findById(eventId: string, introId: string): Promise<IntroRequest | null> {
    const { rows } = await query<IntroRow>(
      `select ${INTRO_COLUMNS} from intro_requests where event_id = $1 and id = $2 limit 1`,
      [eventId, introId]
    );
    return rows[0] ? mapIntro(rows[0]) : null;
  }

  async respond(eventId: string, introId: string, actorId: string, status: Extract<IntroStatus, "accepted" | "declined">): Promise<IntroRequest> {
    const updated = await transaction(async (client) => {
      const { rows } = await client.query<IntroRow>(
        `update intro_requests set status = $4, responded_at = now()
          where event_id = $1 and id = $2 and recipient_id = $3 and status = 'pending'
         returning ${INTRO_COLUMNS}`,
        [eventId, introId, actorId, status]
      );
      if (rows[0]?.status === "accepted") {
        await outbox.enqueue({ eventId, recipientId: rows[0].requester_id, kind: "intro.accepted", subjectId: rows[0].id, dedupeKey: `intro.accepted:${rows[0].id}` }, client);
      }
      return rows[0] ?? null;
    });
    if (!updated) throw new Error("Only the recipient can respond to a pending intro request");
    return mapIntro(updated);
  }

  async findBetween(eventId: string, a: string, b: string): Promise<IntroRequest[]> {
    const { rows } = await query<IntroRow>(
      `select ${INTRO_COLUMNS} from intro_requests
        where event_id = $1 and ((requester_id = $2 and recipient_id = $3) or (requester_id = $3 and recipient_id = $2))`,
      [eventId, a, b]
    );
    return rows.map(mapIntro);
  }

  async countPendingOutgoing(eventId: string, requesterId: string): Promise<number> {
    const { rows } = await query<{ count: number }>(
      `select count(*)::int as count from intro_requests where event_id = $1 and requester_id = $2 and status = 'pending'`,
      [eventId, requesterId]
    );
    return rows[0]?.count ?? 0;
  }

  async listForParticipant(eventId: string, participantId: string): Promise<IntroRequest[]> {
    const { rows } = await query<IntroRow>(
      `select ${INTRO_COLUMNS_R} from intro_requests r
         join event_participants other on other.event_id = r.event_id
          and other.attendee_id = case when r.requester_id = $2 then r.recipient_id else r.requester_id end
        where r.event_id = $1 and (r.requester_id = $2 or r.recipient_id = $2) and other.revoked_at is null
        order by r.created_at desc`,
      [eventId, participantId]
    );
    return rows.map(mapIntro);
  }

  async getRevealedContacts(eventId: string, participantId: string) {
    const { rows } = await query<IntroRow & { contact_id: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; contact_venue_zone: string | null }>(
      `select ${INTRO_COLUMNS_R}, c.id as contact_id, c.name as contact_name, c.email as contact_email, c.phone as contact_phone,
              case when cp.location_updated_at > now() - interval '15 minutes' then cp.venue_zone else null end as contact_venue_zone
         from intro_requests r
         join registered_attendees c on c.id = case when r.requester_id = $2 then r.recipient_id else r.requester_id end
         left join event_participants cp on cp.event_id = r.event_id and cp.attendee_id = c.id
        where r.event_id = $1 and r.status = 'accepted'
          and (r.requester_id = $2 or r.recipient_id = $2)
          -- Someone removed from the event no longer has their contact shown.
          and cp.revoked_at is null
        order by r.responded_at desc`,
      [eventId, participantId]
    );
    return rows.map((row) => ({
      intro: mapIntro(row),
      contact: {
        id: row.contact_id,
        name: row.contact_name ?? "Participant",
        email: row.contact_email,
        phone: row.contact_phone,
        venueZone: row.contact_venue_zone,
      },
    }));
  }
}

function mapIntro(row: IntroRow): IntroRequest {
  return {
    id: row.id,
    eventId: row.event_id,
    requesterId: row.requester_id,
    recipientId: row.recipient_id,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}
