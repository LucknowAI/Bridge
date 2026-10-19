export interface EmbeddingProvider {
  /** Provider and model; vectors from different ids are different spaces and never mixed. */
  readonly id: string;
  embed(text: string, task: "profile" | "query"): Promise<number[] | null>;
}
