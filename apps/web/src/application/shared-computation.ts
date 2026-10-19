import type { CandidateCache } from "./ports/candidate-cache";

/** How long a computation may hold its lock, and how long others wait for its result. */
export const SHARED_LOCK_MS = 10_000;
export const SHARED_WAIT_MS = 2_000;
const POLL_MS = 100;

/**
 * Returns a cached value, or computes it once across replicas: the first
 * caller takes the lock and computes; the others wait briefly for its result
 * and then compute themselves. Any cache or lock failure falls back to
 * computing directly, so a cache outage costs work but never fails a search.
 */
export async function computeOnce<T>(input: {
  cache: CandidateCache;
  key: string;
  read: () => Promise<T | null>;
  write: (value: T) => Promise<void>;
  compute: () => Promise<T>;
  /** Values not worth sharing (e.g. a missing embedding) are returned but not written. */
  shouldStore?: (value: T) => boolean;
  waitMs?: number;
}): Promise<T> {
  const read = () => input.read().catch((error) => {
    console.warn("[cache] read failed; computing directly", error);
    return null;
  });
  const store = async (value: T) => {
    if (input.shouldStore && !input.shouldStore(value)) return;
    await input.write(value).catch((error) => console.warn("[cache] write failed", error));
  };

  const cached = await read();
  if (cached !== null) return cached;

  const token = await input.cache.acquire(`compute:${input.key}`, SHARED_LOCK_MS).catch((error) => {
    console.warn("[cache] lock unavailable; computing directly", error);
    return undefined;
  });
  if (token === undefined) return input.compute();

  if (token) {
    try {
      const raced = await read();
      if (raced !== null) return raced;
      const value = await input.compute();
      await store(value);
      return value;
    } finally {
      await input.cache.release(`compute:${input.key}`, token).catch(() => {});
    }
  }

  // Someone else is computing: wait for their result, then stop waiting.
  const deadline = Date.now() + (input.waitMs ?? SHARED_WAIT_MS);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const shared = await read();
    if (shared !== null) return shared;
  }
  const value = await input.compute();
  await store(value);
  return value;
}
