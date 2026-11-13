import type { EmbeddingProvider, ProviderCallOptions } from "../../application/ports/embedding-provider";

/** Adapter for an internal sentence-transformers inference endpoint. */
export class LocalBgeProvider implements EmbeddingProvider {
  readonly id = "local-bge:768";

  async embed(text: string, _task: "profile" | "query" = "profile", options: ProviderCallOptions = {}): Promise<number[] | null> {
    const endpoint = process.env.LOCAL_BGE_URL;
    if (!endpoint) return null;
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, normalize: true }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Local embedding service failed (${response.status})`);
    const result = await response.json() as { embedding?: number[] } | number[];
    const values = Array.isArray(result) ? result : result.embedding;
    if (!values?.length || values.length !== 768 || values.some((value) => !Number.isFinite(value))) {
      throw new Error("Local embedding service must return 768 numbers");
    }
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    return norm ? values.map((value) => value / norm) : null;
  }
}
