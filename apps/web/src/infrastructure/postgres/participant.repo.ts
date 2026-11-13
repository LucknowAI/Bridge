import { query } from "@match-maker/db";
import type { ParticipantRepository } from "../../application/ports/participant-repository";
import { Intent } from "../../domain/participant/intent";
import type { ParticipantProfile, ParticipantProfileInput } from "../../domain/participant/participant.entity";

interface ProfileRow {
  event_id: string;
  attendee_id: string;
  name: string | null;
  email?: string | null;
  phone?: string | null;
  designation: string | null;
  domain: string | null;
  about_me: string | null;
  self_description: string | null;
  years_of_experience: number | null;
  most_impressive_build: string | null;
  intent: string;
  interests: string[] | null;
  venue_zone: string | null;
  visible: boolean;
  embedding: string | number[] | null;
  profile_updated_at?: Date | null;
}

const PROFILE_COLUMNS = `p.event_id, a.id as attendee_id, a.name,
  coalesce(p.designation, a.designation) as designation,
  coalesce(p.domain, a.domain) as domain,
  coalesce(p.about_me, a.about_me) as about_me,
  coalesce(p.self_description, a.self_description) as self_description,
  coalesce(p.years_of_experience, a.years_of_experience) as years_of_experience,
  coalesce(p.most_impressive_build, a.most_impressive_build) as most_impressive_build,
  p.intent, p.interests,
  p.venue_zone, p.visible, p.embedding::text as embedding, p.profile_updated_at`;
const PROFILE_FROM = `from event_participants p
  join registered_attendees a on a.id = p.attendee_id`;

export class PostgresParticipantRepository implements ParticipantRepository {
  async findProfile(eventId: string, attendeeId: string): Promise<ParticipantProfile | null> {
    const { rows } = await query<ProfileRow>(
      `select ${PROFILE_COLUMNS}, a.email, a.phone ${PROFILE_FROM}
        where p.event_id = $1 and a.id = $2 limit 1`,
      [eventId, attendeeId]
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  async saveProfile(input: ParticipantProfileInput): Promise<ParticipantProfile> {
    const { rowCount } = await query(
      `update event_participants set
         intent = $3, interests = $4, venue_zone = $5,
         about_me = $6, designation = $7, domain = $8,
         self_description = $9, years_of_experience = $10,
         most_impressive_build = $11, embedding = null, profile_updated_at = now(), updated_at = now()
       where event_id = $1 and attendee_id = $2`,
      [input.eventId, input.attendeeId, input.intent, input.interests, input.venueZone,
        input.aboutMe, input.designation, input.domain, input.selfDescription,
        input.yearsOfExperience, input.mostImpressiveBuild]
    );
    if (!rowCount) throw new Error("This attendee is not on the event roster");
    const saved = await this.findProfile(input.eventId, input.attendeeId);
    if (!saved) throw new Error("Could not load the saved profile");
    return saved;
  }

  async listCandidates(input: {
    eventId: string;
    excludeAttendeeId: string | null;
    embedding?: number[] | null;
    limit?: number;
  }): Promise<ParticipantProfile[]> {
    const vector = toVector(input.embedding ?? null);
    const { rows } = await query<ProfileRow>(
      `select ${PROFILE_COLUMNS} ${PROFILE_FROM}
        where p.event_id = $1 and ($2::uuid is null or a.id <> $2::uuid) and p.visible = true and a.name is not null
        order by case when $3::vector is not null and p.embedding is not null then 0 else 1 end,
                 p.embedding <=> $3::vector nulls last, a.name asc
        limit $4`,
      [input.eventId, input.excludeAttendeeId, vector, Math.max(1, Math.min(100, input.limit ?? 50))]
    );
    return rows.map(mapProfile);
  }

  async findCandidatesByIds(eventId: string, ids: string[]): Promise<ParticipantProfile[]> {
    if (!ids.length) return [];
    const { rows } = await query<ProfileRow>(
      `select ${PROFILE_COLUMNS} ${PROFILE_FROM}
        where p.event_id = $1 and a.id = any($2::uuid[]) and p.visible = true
        order by array_position($2::uuid[], a.id)`,
      [eventId, ids]
    );
    return rows.map(mapProfile);
  }

  async setEmbedding(eventId: string, attendeeId: string, embedding: number[]): Promise<void> {
    const vector = toVector(embedding);
    await query(
      `update event_participants set embedding = $3::vector, updated_at = now()
        where event_id = $1 and attendee_id = $2`,
      [eventId, attendeeId, vector]
    );
  }

  async shareVenueZone(eventId: string, attendeeId: string, zone: string): Promise<void> {
    const { rowCount } = await query(
      `update event_participants set venue_zone = $3, location_updated_at = now(), updated_at = now()
        where event_id = $1 and attendee_id = $2`,
      [eventId, attendeeId, zone]
    );
    if (!rowCount) throw new Error("You are not registered for this event");
  }

  async hasEventAccess(eventId: string, attendeeId: string): Promise<boolean> {
    const { rows } = await query<{ allowed: boolean }>(
      `select exists(select 1 from event_participants where event_id = $1 and attendee_id = $2) as allowed`,
      [eventId, attendeeId]
    );
    return rows[0]?.allowed ?? false;
  }
}

function mapProfile(row: ProfileRow): ParticipantProfile {
  const intent = Object.values(Intent).includes(row.intent as Intent)
    ? row.intent as Intent
    : Intent.NETWORKING;
  return {
    eventId: row.event_id,
    attendeeId: row.attendee_id,
    name: row.name ?? "Participant",
    email: row.email ?? null,
    phone: row.phone ?? null,
    designation: row.designation,
    domain: row.domain,
    aboutMe: row.about_me,
    selfDescription: row.self_description,
    yearsOfExperience: row.years_of_experience == null ? null : Number(row.years_of_experience),
    mostImpressiveBuild: row.most_impressive_build,
    intent,
    interests: Array.isArray(row.interests) ? row.interests : [],
    venueZone: row.venue_zone,
    visible: row.visible,
    profileComplete: Boolean(row.profile_updated_at),
    embedding: parseEmbedding(row.embedding),
  };
}

function toVector(vector: number[] | null): string | null {
  if (!vector?.length) return null;
  if (vector.length !== 768 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding must contain 768 finite values");
  }
  return `[${vector.join(",")}]`;
}

function parseEmbedding(value: ProfileRow["embedding"]): number[] | null {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value !== "string" || value.length < 2) return null;
  return value.slice(1, -1).split(",").map(Number).filter(Number.isFinite);
}
