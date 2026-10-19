import { modelUsage } from "@match-maker/db";
import type { ModelUsageLog } from "../../application/ports/model-usage";

export class PostgresModelUsageLog implements ModelUsageLog {
  record(entry: Parameters<ModelUsageLog["record"]>[0]): void {
    // Fire and forget: accounting must never slow down or fail a model call.
    modelUsage.record(entry).catch((error) => console.warn("[usage] could not record", error));
  }
}
