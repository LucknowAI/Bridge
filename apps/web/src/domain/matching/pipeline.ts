import type { EmbeddingProvider } from "../../application/ports/embedding-provider";
import type { CandidateCache } from "../../application/ports/candidate-cache";
import type { ExplanationCache } from "../../application/ports/explanation-cache";
import { queryContext } from "./explanation-key";
import { computeOnce } from "../../application/shared-computation";
import { createHash } from "node:crypto";
import type { LlmProvider } from "../../application/ports/llm-provider";
import type { MatchRepository } from "../../application/ports/match-repository";
import type { ParticipantRepository } from "../../application/ports/participant-repository";
import { profileText, type ParticipantProfile } from "../participant/participant.entity";
import { NO_FILTERS, queryRelevance, queryTerms, searchScore, type SearchFilters } from "./search-query";
import { ComplementarityScorer } from "./scorers/complementarity.scorer";
import { DomainScorer } from "./scorers/domain.scorer";
import { IntentScorer } from "./scorers/intent.scorer";
import { InterestCoverageScorer } from "./scorers/jaccard.scorer";
import { SCORING_CONFIG } from "./scoring-config";
import { SemanticScorer } from "./scorers/semantic.scorer";
import { SeniorityScorer } from "./scorers/seniority.scorer";
import { IntentFilterStage } from "./stages/intent-filter.stage";
import { LlmRerankStage } from "./stages/llm-rerank.stage";
import { PersistStage } from "./stages/persist.stage";
import { RetrieveStage } from "./stages/retrieve.stage";
import { ScoreStage } from "./stages/score.stage";
import { TopKStage } from "./stages/topk.stage";

export interface MatchingInput {
  eventId: string;
  participantId: string;
  mode: "profile" | "search";
  query?: string;
  filters?: SearchFilters;
  limit?: number;
  /** Profile runs from a background job: save only if the profile is still at this revision. */
  expectedRevision?: number;
}

/**
 * Bump when scorers, weights, or stage behavior change, so persisted matches
 * from an older computation can be recognised and recomputed.
 */
export const MATCHING_PIPELINE_VERSION = `v2.${SCORING_CONFIG.version}`;

/** The profile changed while matching ran; the newer job will publish instead. */
export class StaleRevisionError extends Error {
  constructor() {
    super("Profile changed during matching; the newer job will publish results");
    this.name = "StaleRevisionError";
  }
}

/** The scorers the pipeline combines, weighted by SCORING_CONFIG. */
export function defaultScorers() {
  return [
    new SemanticScorer(),
    new IntentScorer(),
    new DomainScorer(),
    new InterestCoverageScorer(),
    new ComplementarityScorer(),
    new SeniorityScorer(),
  ];
}

/** Same retrieve/filter/score/top-K/rerank pipeline for both entry points. */
export class MatchingPipeline {
  private readonly retrieve: RetrieveStage;
  private readonly filter = new IntentFilterStage();
  private readonly score = new ScoreStage(defaultScorers());
  private readonly topK = new TopKStage();
  private readonly rerank: LlmRerankStage;
  private readonly persist: PersistStage;

  constructor(
    private readonly participants: ParticipantRepository,
    matches: MatchRepository,
    private readonly embeddings: EmbeddingProvider,
    llm: LlmProvider | null,
    private readonly cache: CandidateCache,
    explanations: ExplanationCache | null = null
  ) {
    this.retrieve = new RetrieveStage(participants, cache);
    this.rerank = new LlmRerankStage(llm, explanations);
    this.persist = new PersistStage(matches);
  }

  async run(input: MatchingInput) {
    if (input.mode === "search" && !input.query?.trim()) throw new Error("Enter a search query");
    const storedProfile = await this.participants.findProfile(input.eventId, input.participantId);
    // Hidden viewers may still browse; only a saved profile is required.
    if (!storedProfile?.profileComplete) throw new Error("Complete your event profile before continuing");

    if (input.mode === "search") return this.search(input, storedProfile);

    const embedding = storedProfile.embedding ?? await this.embeddings.embed(profileText(storedProfile), "profile");
    if (embedding && !storedProfile.embedding) {
      await this.participants.setEmbedding(input.eventId, input.participantId, embedding);
    }
    const viewer = { ...storedProfile, embedding: embedding ?? storedProfile.embedding };

    const retrieved = await this.retrieve.execute({
      eventId: input.eventId,
      viewerId: input.participantId,
      embedding,
      limit: 50,
    });
    const compatible = this.filter.execute(viewer, retrieved);
    const scored = this.score.execute(viewer, compatible);
    const top = this.topK.execute(scored, input.limit ?? 12);
    const { candidates: ranked, rankedBy } = await this.rerank.execute(viewer, top);

    const saved = await this.persist.execute(input.eventId, input.participantId, ranked, `${MATCHING_PIPELINE_VERSION}+${rankedBy}`, input.expectedRevision);
    if (saved === false) throw new StaleRevisionError();
    return ranked;
  }

  /**
   * Search: the query embedding (or its words, without embeddings) retrieves
   * and measures relevance; the searcher's own profile measures compatibility.
   * Both feed the score, so the same query ranks differently per person.
   */
  /** Query embeddings are shared across replicas and searches for a day. */
  private embedQuery(query: string): Promise<number[] | null> {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
    const key = createHash("sha256").update(JSON.stringify(["query-embedding", this.embeddings.id, normalized])).digest("hex");
    return computeOnce<number[] | null>({
      cache: this.cache,
      key,
      read: () => this.cache.getVector(key),
      write: (vector) => vector ? this.cache.setVector(key, vector, 24 * 60 * 60) : Promise.resolve(),
      compute: () => this.embeddings.embed(normalized, "query"),
      shouldStore: (vector) => vector !== null,
    });
  }

  private async search(input: MatchingInput, viewer: ParticipantProfile) {
    const query = input.query!.trim();
    const terms = queryTerms(query);
    const queryEmbedding = await this.embedQuery(query);
    const retrieved = await this.retrieve.execute({
      eventId: input.eventId,
      viewerId: input.participantId,
      embedding: queryEmbedding,
      query,
      terms,
      filters: input.filters ?? NO_FILTERS,
      embeddingSpace: this.embeddings.id,
      limit: 50,
    });
    const compatible = this.filter.execute(viewer, retrieved);
    const scored = this.score.execute(viewer, compatible).map((candidate) => {
      const relevance = queryRelevance(terms, queryEmbedding, candidate.participant);
      return {
        ...candidate,
        score: searchScore(relevance, candidate.score),
        scoreBreakdown: { ...candidate.scoreBreakdown, query: relevance, profile: candidate.score / 100 },
      };
    }).sort((a, b) => b.score - a.score);
    const top = this.topK.execute(scored, input.limit ?? 12);
    const { candidates: ranked } = await this.rerank.execute(viewer, top, queryContext(query));
    return ranked;
  }
}
