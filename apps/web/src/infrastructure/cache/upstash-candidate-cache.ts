import { randomUUID } from "node:crypto";
import type { CandidateCache } from "../../application/ports/candidate-cache";

/** Deletes the lock only when it still holds this owner's token. */
const RELEASE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

/** Redis REST adapter. Falls back to the local PostgreSQL cache when unset or unreachable. */
export class UpstashCandidateCache implements CandidateCache {
  constructor(private readonly fallback: CandidateCache) {}

  async get(key: string): Promise<string[] | null> {
    const parsed = await this.readJson(key, () => this.fallback.get(key));
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  }

  async set(key: string, candidateIds: string[], ttlSeconds: number): Promise<void> {
    await this.writeJson(key, candidateIds, ttlSeconds, () => this.fallback.set(key, candidateIds, ttlSeconds));
  }

  async getVector(key: string): Promise<number[] | null> {
    const parsed = await this.readJson(key, () => this.fallback.getVector(key));
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((n) => typeof n === "number") ? parsed : null;
  }

  async setVector(key: string, vector: number[], ttlSeconds: number): Promise<void> {
    await this.writeJson(key, vector, ttlSeconds, () => this.fallback.setVector(key, vector, ttlSeconds));
  }

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    if (!this.configured()) return this.fallback.acquire(key, ttlMs);
    try {
      const token = randomUUID();
      return await this.command(["SET", `lock:${key}`, token, "NX", "PX", String(ttlMs)]) === "OK" ? token : null;
    } catch (error) {
      console.warn("[cache] Redis lock failed; using PostgreSQL lock", error);
      return this.fallback.acquire(key, ttlMs);
    }
  }

  async release(key: string, token: string): Promise<void> {
    if (!this.configured()) return this.fallback.release(key, token);
    try {
      await this.command(["EVAL", RELEASE_SCRIPT, "1", `lock:${key}`, token]);
    } catch (error) {
      // The lock expires on its own; releasing early is only an optimisation.
      console.warn("[cache] Redis unlock failed", error);
      await this.fallback.release(key, token).catch(() => {});
    }
  }

  private async readJson(key: string, fallback: () => Promise<unknown>): Promise<unknown> {
    if (!this.configured()) return fallback();
    try {
      const result = await this.command(["GET", key]);
      return typeof result === "string" ? JSON.parse(result) : null;
    } catch (error) {
      console.warn("[cache] Redis GET failed; using PostgreSQL cache", error);
      return fallback();
    }
  }

  private async writeJson(key: string, value: unknown, ttlSeconds: number, fallback: () => Promise<void>): Promise<void> {
    if (!this.configured()) return fallback();
    try {
      await this.command(["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)]);
    } catch (error) {
      console.warn("[cache] Redis SET failed; using PostgreSQL cache", error);
      await fallback();
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
