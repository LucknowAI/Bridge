import type { EmbeddingProvider } from "../../application/ports/embedding-provider";
import type { CandidateCache } from "../../application/ports/candidate-cache";
import type { LlmProvider } from "../../application/ports/llm-provider";
import type { MatchRepository } from "../../application/ports/match-repository";
import type { ParticipantRepository } from "../../application/ports/participant-repository";
import { profileText } from "../participant/participant.entity";
import { ComplementarityScorer } from "./scorers/complementarity.scorer";
import { DomainScorer } from "./scorers/domain.scorer";
import { IntentScorer } from "./scorers/intent.scorer";
import { JaccardScorer } from "./scorers/jaccard.scorer";
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
  limit?: number;
}

/** Same retrieve/filter/score/top-K/rerank pipeline for both entry points. */
export class MatchingPipeline {
  private readonly retrieve: RetrieveStage;
  private readonly filter = new IntentFilterStage();
  private readonly score = new ScoreStage([
    new SemanticScorer(),
    new IntentScorer(),
    new DomainScorer(),
    new JaccardScorer(),
    new ComplementarityScorer(),
    new SeniorityScorer(),
  ]);
  private readonly topK = new TopKStage();
  private readonly rerank: LlmRerankStage;
  private readonly persist: PersistStage;

  constructor(
    private readonly participants: ParticipantRepository,
    matches: MatchRepository,
    private readonly embeddings: EmbeddingProvider,
    llm: LlmProvider | null,
    cache: CandidateCache
  ) {
    this.retrieve = new RetrieveStage(participants, cache);
    this.rerank = new LlmRerankStage(llm);
    this.persist = new PersistStage(matches);
  }

  async run(input: MatchingInput) {
    if (input.mode === "search" && !input.query?.trim()) throw new Error("Enter a search query");
    const storedProfile = await this.participants.findProfile(input.eventId, input.participantId);
    if (!storedProfile) throw new Error("Complete your event profile before continuing");

    const embeddingText = input.mode === "search" ? input.query!.trim() : profileText(storedProfile);
    const embedding = input.mode === "profile" && storedProfile.embedding
      ? storedProfile.embedding
      : await this.embeddings.embed(embeddingText, input.mode === "search" ? "query" : "profile");
    if (input.mode === "profile" && embedding) {
      await this.participants.setEmbedding(input.eventId, input.participantId, embedding);
    }
    const viewer = { ...storedProfile, embedding: embedding ?? storedProfile.embedding };

    const retrieved = await this.retrieve.execute({
      eventId: input.eventId,
      viewerId: input.participantId,
      embedding,
      query: input.mode === "search" ? input.query : undefined,
      limit: 50,
    });
    const compatible = this.filter.execute(viewer, retrieved);
    const scored = this.score.execute(viewer, compatible);
    const top = this.topK.execute(scored, input.limit ?? 12);
    const ranked = await this.rerank.execute(viewer, top);

    if (input.mode === "profile") {
      await this.persist.execute(input.eventId, input.participantId, ranked);
    }
    return ranked;
  }
}
