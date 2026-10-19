import { matchingJobs, query, transaction } from "@match-maker/db";
import { lexicalTsQuery, type SearchFilters } from "../../domain/matching/search-query";
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
  profile_form_version?: number;
  profile_revision?: number;
}

const PROFILE_COLUMNS = `p.event_id, a.id as attendee_id, a.name,
  coalesce(p.designation, a.designation) as designation,
  coalesce(p.domain, a.domain) as domain,
  coalesce(p.about_me, a.about_me) as about_me,
  coalesce(p.self_description, a.self_description) as self_description,
  coalesce(p.years_of_experience, a.years_of_experience) as years_of_experience,
  coalesce(p.most_impressive_build, a.most_impressive_build) as most_impressive_build,
  p.intent, p.interests,
  p.venue_zone, p.visible, p.embedding::text as embedding, p.profile_updated_at, p.profile_form_version, p.profile_revision::int as profile_revision`;
const PROFILE_FROM = `from event_participants p
  join registered_attendees a on a.id = p.attendee_id`;
/**
 * Who other participants may see as a candidate: on this event's roster (the
 * join), visible, named, and with a saved event profile. Every results path —
 * fresh retrieval, cached ids, saved matches — applies this same rule.
 */
/** Profile text searched when no embeddings are available. */
const SEARCH_DOCUMENT = `to_tsvector('simple', concat_ws(' ', a.name, p.designation, p.domain, p.about_me,
  p.self_description, p.most_impressive_build, array_to_string(p.interests, ' ')))`;

export const ELIGIBLE_CANDIDATE = `p.visible = true and a.name is not null and p.profile_updated_at is not null and p.revoked_at is null`;

export class PostgresParticipantRepository implements ParticipantRepository {
  async findProfile(eventId: string, attendeeId: string): Promise<ParticipantProfile | null> {
    const { rows } = await query<ProfileRow>(
      `select ${PROFILE_COLUMNS}, a.email, a.phone ${PROFILE_FROM}
        where p.event_id = $1 and a.id = $2 limit 1`,
      [eventId, attendeeId]
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  /**
   * Saves the profile and queues its embedding in one transaction, so a crash
   * cannot keep the change while losing the work that reflects it.
   */
  async saveProfile(input: ParticipantProfileInput): Promise<ParticipantProfile> {
    await transaction(async (client) => {
      const { rows: [updated] } = await client.query<{ profile_revision: string }>(
        `update event_participants set
           intent = $3, interests = $4, venue_zone = $5,
           about_me = $6, designation = $7, domain = $8,
           self_description = $9, years_of_experience = $10,
           most_impressive_build = $11, profile_form_version = $12, visible = coalesce($13, visible),
           embedding = null, profile_updated_at = now(), updated_at = now(), profile_revision = profile_revision + 1
         where event_id = $1 and attendee_id = $2 and revoked_at is null
         returning profile_revision`,
        [input.eventId, input.attendeeId, input.intent, input.interests, input.venueZone,
          input.aboutMe, input.designation, input.domain, input.selfDescription,
          input.yearsOfExperience, input.mostImpressiveBuild, input.formVersion ?? 0, input.visible ?? null]
      );
      if (!updated) throw new Error("This attendee is not on the event roster");
      await matchingJobs.enqueue(input.eventId, input.attendeeId, "embed", { revision: Number(updated.profile_revision) }, client);
    });
    if (input.visible === false) {
      // Hidden profiles are not explained to others any more.
      await query(`delete from pair_explanations where event_id = $1 and candidate_id = $2`, [input.eventId, input.attendeeId]);
    }
    const saved = await this.findProfile(input.eventId, input.attendeeId);
    if (!saved) throw new Error("Could not load the saved profile");
    return saved;
  }

  async listCandidates(input: {
    eventId: string;
    excludeAttendeeId: string | null;
    embedding?: number[] | null;
    terms?: string[];
    filters?: SearchFilters;
    limit?: number;
  }): Promise<ParticipantProfile[]> {
    const vector = toVector(input.embedding ?? null);
    // Lexical retrieval only when there is no query vector to rank by.
    const tsQuery = vector ? null : lexicalTsQuery(input.terms ?? []);
    const { rows } = await query<ProfileRow>(
      `select ${PROFILE_COLUMNS} ${PROFILE_FROM}
        where p.event_id = $1 and ($2::uuid is null or a.id <> $2::uuid) and ${ELIGIBLE_CANDIDATE}
          and ($5::text is null or p.intent = $5)
          and ($6::text is null or lower(p.domain) = lower($6))
          and ($7::text is null or ${SEARCH_DOCUMENT} @@ to_tsquery('simple', $7))
        order by case when $3::vector is not null and p.embedding is not null then 0 else 1 end,
                 p.embedding <=> $3::vector nulls last,
                 case when $7::text is null then 0 else ts_rank(${SEARCH_DOCUMENT}, to_tsquery('simple', $7)) end desc,
                 a.name asc
        limit $4`,
      [input.eventId, input.excludeAttendeeId, vector, Math.max(1, Math.min(100, input.limit ?? 50)),
        input.filters?.intent ?? null, input.filters?.domain ?? null, tsQuery]
    );
    return rows.map(mapProfile);
  }

  async corpusRevision(eventId: string): Promise<number> {
    const { rows } = await query<{ corpus_revision: string }>(`select corpus_revision from events where id = $1`, [eventId]);
    return Number(rows[0]?.corpus_revision ?? 0);
  }

  async listDomains(eventId: string): Promise<string[]> {
    const { rows } = await query<{ domain: string }>(
      // One entry per domain ignoring case, preferring a capitalised spelling.
      `select (array_agg(trim(p.domain) order by trim(p.domain) = lower(trim(p.domain)), trim(p.domain)))[1] as domain ${PROFILE_FROM}
        where p.event_id = $1 and ${ELIGIBLE_CANDIDATE} and coalesce(trim(p.domain), '') <> ''
        group by lower(trim(p.domain)) order by 1`,
      [eventId]
    );
    return rows.map((row) => row.domain.trim());
  }

  async findCandidatesByIds(eventId: string, ids: string[]): Promise<ParticipantProfile[]> {
    if (!ids.length) return [];
    const { rows } = await query<ProfileRow>(
      `select ${PROFILE_COLUMNS} ${PROFILE_FROM}
        where p.event_id = $1 and a.id = any($2::uuid[]) and ${ELIGIBLE_CANDIDATE}
        order by array_position($2::uuid[], a.id)`,
      [eventId, ids]
    );
    return rows.map(mapProfile);
  }

  async setEmbeddingAt(eventId: string, attendeeId: string, embedding: number[], revision: number): Promise<boolean> {
    const { rowCount } = await query(
      `update event_participants set embedding = $3::vector, updated_at = now()
        where event_id = $1 and attendee_id = $2 and profile_revision = $4`,
      [eventId, attendeeId, toVector(embedding), revision]
    );
    return (rowCount ?? 0) > 0;
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
      `select exists(
         select 1 from event_participants where event_id = $1 and attendee_id = $2 and revoked_at is null
       ) as allowed`,
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
    formVersion: row.profile_form_version ?? 0,
    revision: row.profile_revision ?? 0,
    profileRevision: row.profile_updated_at ? new Date(row.profile_updated_at).toISOString() : null,
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
