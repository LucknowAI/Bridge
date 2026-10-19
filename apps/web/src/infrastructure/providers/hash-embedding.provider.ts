import type { EmbeddingProvider } from "../../application/ports/embedding-provider";

const DIMENSIONS = 768;

/**
 * Words hashed into a unit vector: similar texts give similar vectors, with
 * no network call and no cost. For capacity tests and staging rehearsals
 * only (EMBEDDING_PROVIDER=hash); production refuses it.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "hash:768";

  async embed(text: string): Promise<number[] | null> {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 0;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % DIMENSIONS;
      vector[hash] += 1;
    }
    const norm = Math.hypot(...vector);
    return norm ? vector.map((value) => value / norm) : null;
  }
}
