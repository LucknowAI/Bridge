import type { EmbeddingProvider } from "../../application/ports/embedding-provider";
import type { LlmProvider } from "../../application/ports/llm-provider";
import { GeminiEmbeddingProvider } from "./gemini-embedding.provider";
import { GeminiLlmProvider } from "./gemini-llm.provider";
import { LocalBgeProvider } from "./local-bge.provider";

export class ProviderRegistry {
  static embedding(): EmbeddingProvider {
    if (process.env.EMBEDDING_PROVIDER === "local" && process.env.LOCAL_BGE_URL) {
      return new LocalBgeProvider();
    }
    return new GeminiEmbeddingProvider();
  }

  static llm(): LlmProvider | null {
    return process.env.GEMINI_API_KEY ? new GeminiLlmProvider() : null;
  }
}
