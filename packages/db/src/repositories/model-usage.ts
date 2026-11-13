import { query } from "../client";

/** Usage rows are kept this long, then swept. */
export const USAGE_RETENTION_DAYS = 90;

export async function record(entry: {
  provider: string;
  operation: string;
  outcome: "ok" | "error" | "timeout" | "rejected";
  latencyMs: number;
  inputChars: number;
}): Promise<void> {
  await query(
    `insert into model_usage (provider, operation, outcome, latency_ms, input_chars) values ($1, $2, $3, $4, $5)`,
    [entry.provider, entry.operation, entry.outcome, Math.round(entry.latencyMs), entry.inputChars]
  );
}

export interface UsageSummary {
  provider: string;
  operation: string;
  calls: number;
  failures: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  /** Rough token estimate (characters / 4). */
  approx_tokens: number;
}

export async function summary(hours = 24): Promise<UsageSummary[]> {
  const { rows } = await query<UsageSummary>(
    `select provider, operation, count(*)::int as calls,
            count(*) filter (where outcome <> 'ok')::int as failures,
            round(avg(latency_ms))::int as avg_latency_ms,
            round(percentile_cont(0.95) within group (order by latency_ms))::int as p95_latency_ms,
            (sum(input_chars) / 4)::int as approx_tokens
       from model_usage where created_at > now() - make_interval(hours => $1)
      group by provider, operation order by provider, operation`,
    [hours]
  );
  return rows;
}
