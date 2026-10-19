import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeOnce } from "@/src/application/shared-computation";
import type { CandidateCache } from "@/src/application/ports/candidate-cache";

/** An in-memory stand-in for the shared cache and its locks. */
function memoryCache() {
  const values = new Map<string, unknown>();
  const locks = new Map<string, string>();
  let next = 0;
  const cache: CandidateCache = {
    get: vi.fn(async (key) => (values.get(key) as string[]) ?? null),
    set: vi.fn(async (key, ids) => { values.set(key, ids); }),
    getVector: vi.fn(async (key) => (values.get(key) as number[]) ?? null),
    setVector: vi.fn(async (key, vector) => { values.set(key, vector); }),
    acquire: vi.fn(async (key) => {
      if (locks.has(key)) return null;
      const token = `t${next++}`;
      locks.set(key, token);
      return token;
    }),
    release: vi.fn(async (key, token) => { if (locks.get(key) === token) locks.delete(key); }),
  };
  return { cache, values, locks };
}

const slow = <T>(value: T, ms = 50) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("computeOnce", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("computes once for concurrent identical requests and shares the result", async () => {
    const { cache, locks } = memoryCache();
    const compute = vi.fn(() => slow(["a", "b"]));
    const run = () => computeOnce({ cache, key: "k", read: () => cache.get("k"), write: (v) => cache.set("k", v, 60), compute });
    const results = await Promise.all([run(), run(), run()]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(results).toEqual([["a", "b"], ["a", "b"], ["a", "b"]]);
    expect(locks.size).toBe(0);
  });

  it("stops waiting for a stuck computation and computes itself", async () => {
    const { cache, locks } = memoryCache();
    locks.set("compute:k", "someone-else");
    const compute = vi.fn(async () => ["mine"]);
    const result = await computeOnce({ cache, key: "k", read: () => cache.get("k"), write: (v) => cache.set("k", v, 60), compute, waitMs: 150 });
    expect(result).toEqual(["mine"]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("computes directly when the cache cannot be read or locked", async () => {
    const { cache } = memoryCache();
    vi.mocked(cache.acquire).mockRejectedValue(new Error("down"));
    const compute = vi.fn(async () => ["direct"]);
    const result = await computeOnce({ cache, key: "k", read: () => Promise.reject(new Error("down")), write: vi.fn(), compute });
    expect(result).toEqual(["direct"]);
  });

  it("returns but does not share values marked not worth storing", async () => {
    const { cache, values } = memoryCache();
    const result = await computeOnce<number[] | null>({
      cache, key: "q", read: () => cache.getVector("q"), write: (v) => cache.setVector("q", v!, 60),
      compute: async () => null, shouldStore: (v) => v !== null,
    });
    expect(result).toBeNull();
    expect(values.size).toBe(0);
  });
});
