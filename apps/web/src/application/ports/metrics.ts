export type MetricUnit = "Count" | "Milliseconds" | "Seconds";

/** Operational measurements for dashboards and alarms. Never blocks or fails the caller. */
export interface Metrics {
  record(values: Array<{ name: string; value: number; unit: MetricUnit }>, dimensions?: Record<string, string>): void;
}
