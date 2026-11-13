/**
 * A small run of the capacity check against a real Postgres with the free
 * hash embedding: every attendee gets matches, searches succeed, and the
 * throwaway event and people are removed afterwards. Skipped without DATABASE_URL.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => {
  const saved = { EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER, GEMINI_API_KEY: process.env.GEMINI_API_KEY, MATCH_REFRESH_DELAY_SECONDS: process.env.MATCH_REFRESH_DELAY_SECONDS };
  process.env.EMBEDDING_PROVIDER = "hash";
  process.env.GEMINI_API_KEY = "";
  process.env.MATCH_REFRESH_DELAY_SECONDS = "0";
  delete (globalThis as { __matchMakerContainer?: unknown }).__matchMakerContainer;
  return saved;
});

import { closePool, query } from "@match-maker/db";
import { migrate } from "../../packages/db/src/migrate";
import { budgetFailures, runCapacityCheck } from "../../tools/capacity-check";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("capacity check", () => {
  afterAll(async () => {
    await closePool();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete (globalThis as { __matchMakerContainer?: unknown }).__matchMakerContainer;
  });

  it("measures a small event and cleans up after itself", async () => {
    await migrate();
    const throwaway = async () => (await query(`select 1 from organizations where slug like 'capacity-%'`)).rows.length;
    const before = await throwaway();
    const report = await runCapacityCheck({ attendees: 12, searches: 6, concurrency: 3, workers: 1 });
    expect(report).toMatchObject({ attendees: 12, searches: 6, attendeesWithoutMatches: 0 });
    expect(report.search.failures).toBe(0);
    expect(report.search.p95Ms).toBeGreaterThan(0);
    expect(budgetFailures(report)).toEqual([]);
    expect(await throwaway()).toBe(before);
  });
});
