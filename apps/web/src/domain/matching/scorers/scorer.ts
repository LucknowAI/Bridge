import type { ParticipantProfile } from "../../participant/participant.entity";

export interface Scorer {
  readonly name: string;
  readonly weight: number;
  score(viewer: ParticipantProfile, candidate: ParticipantProfile): number;
}

export function tokenize(value: string | null | undefined): Set<string> {
  return new Set((value ?? "").toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? []);
}

export function cosineSimilarity(left: number[] | null | undefined, right: number[] | null | undefined): number {
  if (!left?.length || !right?.length || left.length !== right.length) return 0;
  let dot = 0;
  let l2 = 0;
  let r2 = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    l2 += left[i] * left[i];
    r2 += right[i] * right[i];
  }
  if (!l2 || !r2) return 0;
  return Math.max(0, Math.min(1, (dot / Math.sqrt(l2 * r2) + 1) / 2));
}
