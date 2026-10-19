/**
 * Capacity and latency check for one event of a chosen size, against the
 * configured database:
 *
 *   npm run capacity:check -- --attendees 300 --searches 60 --concurrency 15 --workers 2
 *
 * It creates a throwaway organization and event with synthetic attendees,
 * saves every profile (as people would), runs the real embed and match
 * workers until the queue is quiet, then runs concurrent searches through
 * the real use case. It reports matching throughput, search latency and
 * model calls, compares them with the budgets in docs/OPERATIONS.md, and
 * deletes everything it created (unless --keep). Exits 1 when a budget fails.
 *
 * Models: by default a free deterministic embedding and no rerank, which
 * measures the system itself. `--providers configured` uses the deployment's
 * real providers and costs money; run it on staging, not in CI. With
 * `--workers 0` the deployment's workers do the matching and the check only
 * waits; otherwise stop other workers first, or they share this event's jobs.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { isMainModule } from "../packages/db/src/is-main";

export interface CapacityReport {
  attendees: number;
  searches: number;
  /** Seconds until every attendee had a stored match list. */
  firstListsSeconds: number;
  /** Seconds until no job was left, refreshes included. */
  quietSeconds: number;
  attendeesWithoutMatches: number;
  search: { p50Ms: number; p95Ms: number; maxMs: number; failures: number };
  modelCalls: { perAttendee: number; perSearch: number; approxTokens: number; failures: number };
}

export interface Budgets {
  searchP95Ms: number;
  firstListsSeconds: number;
  quietSeconds: number;
  modelCallsPerAttendee: number;
  modelCallsPerSearch: number;
}

/** Defaults agreed in docs/OPERATIONS.md for a 300-attendee event. */
export const DEFAULT_BUDGETS: Budgets = {
  searchP95Ms: 6000,
  firstListsSeconds: 600,
  quietSeconds: 1800,
  modelCallsPerAttendee: 6,
  modelCallsPerSearch: 2,
};

/** One message per budget the report misses; empty when all pass. */
export function budgetFailures(report: CapacityReport, budgets: Budgets = DEFAULT_BUDGETS): string[] {
  const failures: string[] = [];
  const over = (label: string, actual: number, limit: number, unit: string) => {
    if (actual > limit) failures.push(`${label} ${actual}${unit} is over the budget of ${limit}${unit}`);
  };
  over("search p95", report.search.p95Ms, budgets.searchP95Ms, " ms");
  over("time to first match lists", report.firstListsSeconds, budgets.firstListsSeconds, " s");
  over("time until the queue is quiet", report.quietSeconds, budgets.quietSeconds, " s");
  over("model calls per attendee", report.modelCalls.perAttendee, budgets.modelCallsPerAttendee, "");
  over("model calls per search", report.modelCalls.perSearch, budgets.modelCallsPerSearch, "");
  if (report.search.failures) failures.push(`${report.search.failures} search(es) failed`);
  if (report.attendeesWithoutMatches) failures.push(`${report.attendeesWithoutMatches} attendee(s) have no matches`);
  return failures;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const WORDS = ["retrieval", "search", "climate", "health", "design", "rust", "compilers", "graph", "databases", "fintech", "payments",
  "robotics", "vision", "education", "hiring", "mentoring", "startups", "security", "privacy", "mobile", "frontend", "data", "pipelines", "evaluation"];
const DOMAINS = ["Artificial Intelligence", "Design", "Finance", "Healthcare", "Education", "Security"];
const pick = (index: number, salt: number) => WORDS[(index * 7 + salt * 13) % WORDS.length];

export async function runCapacityCheck(options: { attendees: number; searches: number; concurrency: number; workers: number; keep?: boolean }): Promise<CapacityReport> {
  // Imported late so provider choices made from the arguments apply.
  const { attendees, events, query } = await import("@match-maker/db");
  const { processEmbedJob } = await import("../packages/db/workers/embed.worker");
  const { processMatchJob } = await import("../packages/db/workers/match.worker");
  const { getContainer } = await import("../apps/web/src/composition/container");
  const { searchParticipants } = await import("../apps/web/src/application/use-cases/search-participants");
  const { Intent } = await import("../apps/web/src/domain/participant/intent");
  const container = getContainer();

  const run = `capacity-${Date.now().toString(36)}`;
  const emailOf = (i: number) => `${run}-${i}@example.com`;
  const started = new Date();
  const { rows: [org] } = await query<{ id: string }>(`insert into organizations (name, slug) values ($1, $1) returning id`, [run]);
  const eventId = (await query<{ id: string }>(
    `insert into events (organization_id, name, slug, status) values ($1, $2, $2, 'open') returning id`, [org.id, run])).rows[0].id;
  try {
    const people = Array.from({ length: options.attendees }, (_, i) => ({ name: `Capacity ${i}`, email: emailOf(i) }));
    await attendees.upsertMany(people);
    const { rows } = await query<{ id: string }>(`select id from registered_attendees where email like $1 order by email`, [`${run}-%`]);
    const ids = rows.map((row) => row.id);
    await events.attachRoster(eventId, ids);
    const intents = [Intent.NETWORKING, Intent.HIRING, Intent.MENTORING];

    const savedAt = Date.now();
    for (const [i, attendeeId] of ids.entries()) {
      await container.participants.saveProfile({
        eventId, attendeeId, designation: "Engineer", domain: DOMAINS[i % DOMAINS.length],
        aboutMe: `Works on ${pick(i, 1)} and ${pick(i, 2)} for ${pick(i, 3)} teams`, selfDescription: null,
        yearsOfExperience: (i % 15) + 1, mostImpressiveBuild: null, intent: intents[i % intents.length],
        interests: [pick(i, 4), pick(i, 5)], venueZone: null,
      });
    }

    const listed = async () => Number((await query<{ count: string }>(
      `select count(distinct participant_id) from event_matches where event_id = $1`, [eventId])).rows[0].count);
    let firstListsSeconds = -1;
    // With --workers 0 the deployment's own workers do the matching; this only waits.
    const worker = async (processing: boolean) => {
      for (;;) {
        const worked = processing && ((await processEmbedJob(eventId)) || (await processMatchJob(eventId)));
        if (worked) continue;
        const open = await query(`select 1 from matching_jobs where event_id = $1 and status in ('pending', 'running') limit 1`, [eventId]);
        if (!open.rows.length) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    const watcher = setInterval(async () => {
      if (firstListsSeconds < 0 && await listed() >= ids.length) firstListsSeconds = Math.round((Date.now() - savedAt) / 1000);
    }, 1000);
    await Promise.all(options.workers > 0 ? Array.from({ length: options.workers }, () => worker(true)) : [worker(false)]);
    clearInterval(watcher);
    const quietSeconds = Math.round((Date.now() - savedAt) / 1000);
    const withLists = await listed();
    if (firstListsSeconds < 0) firstListsSeconds = quietSeconds;

    const latencies: number[] = [];
    let failures = 0;
    let next = 0;
    const searcher = async () => {
      while (next < options.searches) {
        const i = next++;
        const begin = Date.now();
        try {
          await searchParticipants({ eventId, participantId: ids[i % ids.length], query: `${pick(i, 6)} ${pick(i, 7)}`, eventIntents: intents },
            { pipeline: container.pipeline, participants: container.participants });
        } catch {
          failures++;
        }
        latencies.push(Date.now() - begin);
      }
    };
    await Promise.all(Array.from({ length: options.concurrency }, searcher));

    const usage = (await query<{ operation: string; calls: string; failures: string; chars: string }>(
      `select operation, count(*) as calls, count(*) filter (where outcome <> 'ok') as failures, coalesce(sum(input_chars), 0) as chars
         from model_usage where created_at >= $1 group by operation`, [started])).rows;
    const callsOf = (prefix: string[]) => usage.filter((row) => prefix.includes(row.operation)).reduce((sum, row) => sum + Number(row.calls), 0);
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      attendees: ids.length,
      searches: options.searches,
      firstListsSeconds,
      quietSeconds,
      attendeesWithoutMatches: ids.length - withLists,
      search: { p50Ms: percentile(latencies, 50), p95Ms: percentile(latencies, 95), maxMs: Math.max(0, ...latencies), failures },
      modelCalls: {
        perAttendee: round(callsOf(["embed:profile", "rerank"]) / Math.max(1, ids.length)),
        perSearch: round(callsOf(["embed:query"]) / Math.max(1, options.searches)),
        approxTokens: Math.round(usage.reduce((sum, row) => sum + Number(row.chars), 0) / 4),
        failures: usage.reduce((sum, row) => sum + Number(row.failures), 0),
      },
    };
  } finally {
    if (!options.keep) {
      await query(`delete from organizations where id = $1`, [org.id]);
      await query(`delete from registered_attendees where email like $1`, [`${run}-%`]);
    }
  }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      attendees: { type: "string", default: "300" },
      searches: { type: "string", default: "60" },
      concurrency: { type: "string", default: "15" },
      workers: { type: "string", default: "2" },
      providers: { type: "string", default: "fake" },
      keep: { type: "boolean", default: false },
    },
  });
  if (values.providers === "fake") {
    process.env.EMBEDDING_PROVIDER = "hash";
    process.env.GEMINI_API_KEY = "";
  } else if (values.providers !== "configured") {
    console.error("--providers must be fake or configured");
    process.exit(2);
  }
  process.env.MATCH_REFRESH_DELAY_SECONDS ??= "0";
  const { closePool } = await import("@match-maker/db");
  try {
    const report = await runCapacityCheck({
      attendees: Number(values.attendees), searches: Number(values.searches),
      concurrency: Number(values.concurrency), workers: Number(values.workers), keep: values.keep,
    });
    console.info(JSON.stringify({ providers: values.providers, ...report }, null, 2));
    const failures = budgetFailures(report);
    for (const failure of failures) console.error(`[capacity] FAIL ${failure}`);
    if (!failures.length) console.info("[capacity] every budget met");
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    await closePool();
  }
}
