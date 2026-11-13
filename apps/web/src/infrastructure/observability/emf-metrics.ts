import type { Metrics } from "../../application/ports/metrics";
import type { ModelUsageLog } from "../../application/ports/model-usage";

/**
 * Writes metrics as CloudWatch Embedded Metric Format: one JSON log line that
 * CloudWatch Logs turns into metrics, so no agent or extra service is needed.
 * Without METRICS_NAMESPACE (local runs) nothing is written.
 */
export class EmfMetrics implements Metrics {
  constructor(
    private readonly namespace: string | null = process.env.METRICS_NAMESPACE || null,
    private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)
  ) {}

  record(values: Parameters<Metrics["record"]>[0], dimensions: Record<string, string> = {}): void {
    if (!this.namespace || !values.length) return;
    try {
      this.write(JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [{
            Namespace: this.namespace,
            Dimensions: [Object.keys(dimensions)],
            Metrics: values.map((metric) => ({ Name: metric.name, Unit: metric.unit })),
          }],
        },
        ...dimensions,
        ...Object.fromEntries(values.map((metric) => [metric.name, metric.value])),
      }));
    } catch {
      // Metrics are best effort.
    }
  }
}

/** Adds call counts, failures and latency per operation to an existing usage log. */
export class MeteredModelUsageLog implements ModelUsageLog {
  constructor(private readonly inner: ModelUsageLog, private readonly metrics: Metrics) {}

  record(entry: Parameters<ModelUsageLog["record"]>[0]): void {
    this.inner.record(entry);
    this.metrics.record([
      { name: "ModelCalls", value: 1, unit: "Count" },
      { name: "ModelCallFailures", value: entry.outcome === "ok" ? 0 : 1, unit: "Count" },
      { name: "ModelCallLatencyMs", value: entry.latencyMs, unit: "Milliseconds" },
    ], { Operation: entry.operation });
  }
}
