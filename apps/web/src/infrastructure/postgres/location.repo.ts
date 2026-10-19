import { outbox, query, transaction } from "@match-maker/db";
import type { LocationRepository } from "../../application/ports/location-repository";
import { currentStatus, LOCATION_RULES, type LocationRequestView } from "../../domain/connection/location.rules";

interface RequestRow {
  id: string;
  intro_id: string;
  requester_id: string;
  status: "pending" | "answered" | "declined";
  zone: string | null;
  created_at: Date;
  expires_at: Date;
  zone_expires_at: Date | null;
}

export class PostgresLocationRepository implements LocationRepository {
  async create(input: { eventId: string; introId: string; requesterId: string; recipientId: string }): Promise<{ id: string } | null> {
    return transaction(async (client) => {
      // A pending request that has run out of time no longer blocks a new one.
      await client.query(
        `update location_requests set status = 'declined' where intro_id = $1 and requester_id = $2 and status = 'pending' and expires_at < now()`,
        [input.introId, input.requesterId]
      );
      const { rows } = await client.query<{ id: string }>(
        `insert into location_requests (event_id, intro_id, requester_id, recipient_id, expires_at)
         values ($1, $2, $3, $4, now() + make_interval(mins => $5))
         on conflict (intro_id, requester_id) where status = 'pending' do nothing
         returning id`,
        [input.eventId, input.introId, input.requesterId, input.recipientId, LOCATION_RULES.requestExpiresMinutes]
      );
      if (!rows[0]) return null;
      await outbox.enqueue({ eventId: input.eventId, recipientId: input.recipientId, kind: "location.requested", subjectId: rows[0].id, dedupeKey: `location.requested:${rows[0].id}` }, client);
      return rows[0];
    });
  }

  async answer(input: { eventId: string; requestId: string; recipientId: string; zone: string | null }): Promise<boolean> {
    return transaction(async (client) => {
      const { rows } = await client.query<{ requester_id: string }>(
        `update location_requests
            set status = case when $4::text is null then 'declined' else 'answered' end,
                zone = $4, answered_at = now(),
                zone_expires_at = case when $4::text is null then null else now() + make_interval(mins => $5) end
          where id = $1 and event_id = $2 and recipient_id = $3 and status = 'pending' and expires_at > now()
          returning requester_id`,
        [input.requestId, input.eventId, input.recipientId, input.zone, LOCATION_RULES.replyVisibleMinutes]
      );
      if (!rows[0]) return false;
      await outbox.enqueue({ eventId: input.eventId, recipientId: rows[0].requester_id, kind: "location.answered", subjectId: input.requestId, dedupeKey: `location.answered:${input.requestId}` }, client);
      return true;
    });
  }

  async forParticipant(eventId: string, participantId: string): Promise<LocationRequestView[]> {
    const { rows } = await query<RequestRow>(
      `select distinct on (intro_id, requester_id) id, intro_id, requester_id, status, zone, created_at, expires_at, zone_expires_at
         from location_requests
        where event_id = $1 and (requester_id = $2 or recipient_id = $2)
        order by intro_id, requester_id, created_at desc`,
      [eventId, participantId]
    );
    return rows.map((row) => {
      const outgoing = row.requester_id === participantId;
      const status = currentStatus({ status: row.status, expiresAt: row.expires_at, zoneExpiresAt: row.zone_expires_at });
      return {
        id: row.id,
        introId: row.intro_id,
        direction: outgoing ? "outgoing" : "incoming",
        status,
        // The zone is the asker's to see, and only while it is fresh.
        zone: outgoing && status === "answered" ? row.zone : null,
        createdAt: row.created_at,
        zoneExpiresAt: row.zone_expires_at,
      };
    });
  }
}
