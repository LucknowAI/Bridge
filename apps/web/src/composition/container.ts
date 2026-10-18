import { matchingJobs } from "@match-maker/db";
import { PostgresIntroRepository } from "../infrastructure/postgres/intro.repo";
import { PostgresMatchRepository } from "../infrastructure/postgres/match.repo";
import { PostgresParticipantRepository } from "../infrastructure/postgres/participant.repo";
import { PostgresRateLimiter } from "../infrastructure/cache/postgres-rate-limiter";
import { PostgresEventRepository } from "../infrastructure/postgres/event.repo";
import { PostgresAuditLog } from "../infrastructure/postgres/audit.repo";
import { PostgresMatchQueue } from "../infrastructure/postgres/match-queue.repo";
import { PostgresCandidateCache } from "../infrastructure/cache/postgres-candidate-cache";
import { PostgresExplanationCache } from "../infrastructure/cache/postgres-explanation-cache";
import { UpstashCandidateCache } from "../infrastructure/cache/upstash-candidate-cache";
import { RealtimeNotifier } from "../infrastructure/notifications/realtime.notifier";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { MatchingPipeline } from "../domain/matching/pipeline";

const globalContainer = globalThis as typeof globalThis & { __matchMakerContainer?: ReturnType<typeof buildContainer> };

function buildContainer() {
  const participants = new PostgresParticipantRepository();
  const matches = new PostgresMatchRepository();
  const intros = new PostgresIntroRepository();
  const events = new PostgresEventRepository();
  const embeddings = ProviderRegistry.embedding();
  const llm = ProviderRegistry.llm();
  const candidateCache = new UpstashCandidateCache(new PostgresCandidateCache());
  return {
    participants,
    matches,
    intros,
    events,
    embeddings,
    llm,
    candidateCache,
    matchQueue: new PostgresMatchQueue(),
    audit: new PostgresAuditLog(),
    notifications: new RealtimeNotifier(),
    limiter: new PostgresRateLimiter(),
    pipeline: new MatchingPipeline(participants, matches, embeddings, llm, candidateCache, new PostgresExplanationCache()),
    enqueueMatching: matchingJobs.enqueue,
    enqueueEmbedding: (eventId: string, participantId: string) => matchingJobs.enqueue(eventId, participantId, "embed"),
  };
}

export function getContainer() {
  return globalContainer.__matchMakerContainer ??= buildContainer();
}
