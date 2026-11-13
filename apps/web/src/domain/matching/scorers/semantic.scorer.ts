import { SCORING_CONFIG } from "../scoring-config";
import type { ParticipantProfile } from "../../participant/participant.entity";
import { cosineSimilarity, tokenize, type Scorer } from "./scorer";

export class SemanticScorer implements Scorer {
  readonly name = "semantic";
  readonly weight = SCORING_CONFIG.weights.semantic;

  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number {
    // Vectors from different models are not comparable; use the text fallback instead.
    const sameSpace = viewer.embeddingModel === undefined || candidate.embeddingModel === undefined || viewer.embeddingModel === candidate.embeddingModel;
    const vectorScore = sameSpace ? cosineSimilarity(viewer.embedding, candidate.embedding) : 0;
    if (vectorScore > 0) return vectorScore;
    const left = tokenize([viewer.aboutMe, viewer.selfDescription, viewer.mostImpressiveBuild].join(" "));
    const right = tokenize([candidate.aboutMe, candidate.selfDescription, candidate.mostImpressiveBuild].join(" "));
    if (!left.size || !right.size) return 0.25;
    let shared = 0;
    for (const word of left) if (right.has(word)) shared++;
    return shared / Math.sqrt(left.size * right.size);
  }
}
