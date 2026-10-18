import { createHash } from "node:crypto";
import type { ParticipantProfile } from "../participant/participant.entity";
import { SCORING_CONFIG } from "./scoring-config";

/** Reasons are reused for a week at most, and earlier when anything in the key changes. */
export const EXPLANATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Identifies one directional explanation: why `candidate` suits `viewer`, at
 * these profile revisions, from this model and prompt, under this scoring
 * configuration, for this context ("profile" or a normalized search query).
 */
export function explanationKey(input: {
  eventId: string;
  viewer: ParticipantProfile;
  candidate: ParticipantProfile;
  model: string;
  promptVersion: string;
  context: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.eventId,
    input.viewer.attendeeId, input.viewer.profileRevision ?? null,
    input.candidate.attendeeId, input.candidate.profileRevision ?? null,
    input.model, input.promptVersion, SCORING_CONFIG.version, input.context,
  ])).digest("hex");
}

/** The context for search explanations: the normalized query. */
export function queryContext(query: string): string {
  return `query:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
