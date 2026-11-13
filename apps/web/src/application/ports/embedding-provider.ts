/** Limits a caller can put on one provider call. */
export interface ProviderCallOptions {
  /** The most time this call may take, including retries. */
  timeoutMs?: number;
  /** Aborts the underlying request when the caller gives up. */
  signal?: AbortSignal;
}

export interface EmbeddingProvider {
  /** Provider and model; vectors from different ids are different spaces and never mixed. */
  readonly id: string;
  embed(text: string, task: "profile" | "query", options?: ProviderCallOptions): Promise<number[] | null>;
}
