import type { EmbeddingProvider, ProviderCallOptions } from "../../application/ports/embedding-provider";

const DIMENSIONS = 768;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id = `gemini:gemini-embedding-001:${DIMENSIONS}`;

  async embed(text: string, task: "profile" | "query", options: ProviderCallOptions = {}): Promise<number[] | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !text.trim()) return null;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        content: { parts: [{ text: text.slice(0, 7000) }] },
        taskType: task === "profile" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY",
        outputDimensionality: DIMENSIONS,
      }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Gemini embedding failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as { embedding?: { values?: number[] } };
    const values = payload.embedding?.values;
    if (!values || values.length !== DIMENSIONS || values.some((value) => !Number.isFinite(value))) {
      throw new Error("Gemini returned an invalid embedding vector");
    }
    // gemini-embedding-001 recommends normalising output_dimensionality values
    // below 3072 before they are used for retrieval.
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    return norm ? values.map((value) => value / norm) : null;
  }
}
