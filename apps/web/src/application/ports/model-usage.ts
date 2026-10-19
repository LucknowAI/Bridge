/** Records each model provider call for usage, cost and reliability reports. Never blocks the call. */
export interface ModelUsageLog {
  record(entry: {
    provider: string;
    operation: string;
    outcome: "ok" | "error" | "timeout" | "rejected";
    latencyMs: number;
    inputChars: number;
  }): void;
}
