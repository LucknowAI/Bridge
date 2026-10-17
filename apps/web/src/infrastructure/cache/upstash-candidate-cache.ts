import type { CandidateCache } from "../../application/ports/candidate-cache";

/** Redis REST adapter. Falls back to the local PostgreSQL cache when unset. */
export class UpstashCandidateCache implements CandidateCache {
  constructor(private readonly fallback: CandidateCache) {}

  async get(key: string): Promise<string[] | null> {
    if (!this.configured()) return this.fallback.get(key);
    try {
      const result = await this.command(["GET", key]);
      if (typeof result !== "string") return null;
      const parsed: unknown = JSON.parse(result);
      return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
    } catch (error) {
      console.warn("[cache] Redis GET failed; using PostgreSQL cache", error);
      return this.fallback.get(key);
    }
  }

  async set(key: string, candidateIds: string[], ttlSeconds: number): Promise<void> {
    if (!this.configured()) return this.fallback.set(key, candidateIds, ttlSeconds);
    try {
      await this.command(["SET", key, JSON.stringify(candidateIds), "EX", String(ttlSeconds)]);
    } catch (error) {
      console.warn("[cache] Redis SET failed; using PostgreSQL cache", error);
      await this.fallback.set(key, candidateIds, ttlSeconds);
    }
  }

  private configured(): boolean {
    return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  }

  private async command(command: string[]): Promise<unknown> {
    const url = process.env.UPSTASH_REDIS_REST_URL!.replace(/\/$/, "");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`Redis REST returned ${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: string };
    if (payload.error) throw new Error(payload.error);
    return payload.result;
  }
}
