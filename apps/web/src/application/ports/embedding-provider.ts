export interface EmbeddingProvider {
  embed(text: string, task: "profile" | "query"): Promise<number[] | null>;
}
