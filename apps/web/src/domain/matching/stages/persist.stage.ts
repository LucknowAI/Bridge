import type { MatchRepository } from "../../../application/ports/match-repository";
import type { MatchCandidate } from "../match-strategy";

export class PersistStage {
  constructor(private readonly matches: MatchRepository) {}
  execute(eventId: string, participantId: string, candidates: MatchCandidate[], computationVersion: string, expectedRevision?: number): Promise<boolean> {
    return this.matches.save(eventId, participantId, candidates, computationVersion, expectedRevision);
  }
}
