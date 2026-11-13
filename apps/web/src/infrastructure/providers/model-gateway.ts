import type { EmbeddingProvider, ProviderCallOptions } from "../../application/ports/embedding-provider";
import type { LlmProvider } from "../../application/ports/llm-provider";
import type { ModelUsageLog } from "../../application/ports/model-usage";
import type { MatchCandidate } from "../../domain/matching/match-strategy";
import type { ParticipantProfile } from "../../domain/participant/participant.entity";
import { Bulkhead, BulkheadFullError } from "../resilience/bulkhead";
import { CircuitBreaker, CircuitOpenError } from "../resilience/circuit-breaker";

/** Per-operation limits: a time budget for the whole call and how many quick retries fit in it. */
export interface GatewayPolicy {
  timeoutMs: number;
  retries: number;
}

export const POLICIES = {
  embedQuery: { timeoutMs: 2_500, retries: 1 },
  embedProfile: { timeoutMs: 15_000, retries: 2 },
  rerank: { timeoutMs: 20_000, retries: 1 },
} satisfies Record<string, GatewayPolicy>;

/** Rate limits, server errors, timeouts and network failures are worth one more try. */
export function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\((429|5\d\d)\)|timeout|aborted|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

interface Guards {
  breaker: CircuitBreaker;
  bulkhead: Bulkhead;
  usage: ModelUsageLog | null;
}

/**
 * Runs one provider call under the gateway's rules: a concurrency limit, a
 * circuit breaker, a time budget for the whole call (including retries), and
 * a couple of jittered retries for transient errors. Every attempt is
 * recorded for usage and cost reports. Provider retries stay separate from
 * background job retries, which take over when this gives up.
 */
export async function guardedCall<T>(input: {
  provider: string;
  operation: string;
  inputChars: number;
  policy: GatewayPolicy;
  budgetMs?: number;
  guards: Guards;
  call: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const deadline = Date.now() + Math.min(input.policy.timeoutMs, input.budgetMs ?? Infinity);
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 50) throw new Error(`${input.provider} ${input.operation} timeout: no time left in the budget`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${input.provider} ${input.operation} timeout`)), remaining);
    const started = Date.now();
    try {
      const result = await input.guards.bulkhead.run(() => input.guards.breaker.execute(() => input.call(controller.signal)));
      input.guards.usage?.record({ provider: input.provider, operation: input.operation, outcome: "ok", latencyMs: Date.now() - started, inputChars: input.inputChars });
      return result;
    } catch (error) {
      const rejected = error instanceof CircuitOpenError || error instanceof BulkheadFullError;
      const outcome = rejected ? "rejected" : controller.signal.aborted ? "timeout" : "error";
      input.guards.usage?.record({ provider: input.provider, operation: input.operation, outcome, latencyMs: Date.now() - started, inputChars: input.inputChars });
      const retryable = !rejected && (controller.signal.aborted ? false : isTransient(error));
      if (!retryable || attempt >= input.policy.retries) throw error;
      const backoff = Math.min(100 * 2 ** attempt + Math.random() * 100, deadline - Date.now() - 100);
      if (backoff <= 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Embedding calls through the gateway. A failed query embedding returns null,
 * so search falls back to its word-matching path; a failed profile embedding
 * throws, so the background job retries later.
 */
export class GatewayEmbeddingProvider implements EmbeddingProvider {
  private readonly guards: Guards;

  constructor(private readonly inner: EmbeddingProvider, usage: ModelUsageLog | null) {
    this.guards = {
      breaker: new CircuitBreaker(`embeddings:${inner.id}`),
      bulkhead: new Bulkhead(`embeddings:${inner.id}`, { maxConcurrent: 8, maxQueue: 32, queueTimeoutMs: 2_000 }),
      usage,
    };
  }

  get id(): string {
    return this.inner.id;
  }

  async embed(text: string, task: "profile" | "query", options: ProviderCallOptions = {}): Promise<number[] | null> {
    try {
      return await guardedCall({
        provider: this.inner.id,
        operation: `embed:${task}`,
        inputChars: text.length,
        policy: task === "query" ? POLICIES.embedQuery : POLICIES.embedProfile,
        budgetMs: options.timeoutMs,
        guards: this.guards,
        call: (signal) => this.inner.embed(text, task, { ...options, signal }),
      });
    } catch (error) {
      if (task === "query") {
        console.warn("[gateway] query embedding unavailable; searching by words", (error as Error).message);
        return null;
      }
      throw error;
    }
  }
}

/** Rerank calls through the gateway; failures surface so the stage keeps the scored order. */
export class GatewayLlmProvider implements LlmProvider {
  private readonly guards: Guards;

  constructor(private readonly inner: LlmProvider, usage: ModelUsageLog | null) {
    this.guards = {
      breaker: new CircuitBreaker(`llm:${inner.id}`),
      bulkhead: new Bulkhead(`llm:${inner.id}`, { maxConcurrent: 4, maxQueue: 16, queueTimeoutMs: 2_000 }),
      usage,
    };
  }

  get id(): string {
    return this.inner.id;
  }

  get promptVersion(): string {
    return this.inner.promptVersion;
  }

  rerank(viewer: ParticipantProfile, candidates: MatchCandidate[], options: ProviderCallOptions = {}): Promise<MatchCandidate[]> {
    return guardedCall({
      provider: this.inner.id,
      operation: "rerank",
      inputChars: JSON.stringify(candidates.map((candidate) => candidate.participant.aboutMe ?? "")).length,
      policy: POLICIES.rerank,
      budgetMs: options.timeoutMs,
      guards: this.guards,
      call: (signal) => this.inner.rerank(viewer, candidates, { ...options, signal }),
    });
  }
}
