import type { AuditProfile, AuditRun, AuditSink, RunStatus } from "./types.js";
import { logEvent } from "../logging.js";

const NOOP_RUN: AuditRun = { runId: "unavailable", recordLlm() {}, recordTool() {}, markToolCompacted() {}, finish() {} };

export class FailOpenAudit implements AuditSink {
  constructor(private readonly inner: AuditSink | null) {}
  startRun(taskId: string, profile: AuditProfile): AuditRun {
    if (!this.inner) return NOOP_RUN;
    try {
      const run = this.inner.startRun(taskId, profile);
      return {
        runId: run.runId,
        recordLlm: (metric) => this.safe(() => run.recordLlm(metric)),
        recordTool: (metric) => this.safe(() => run.recordTool(metric)),
        markToolCompacted: (turnNumber, callIndex) => this.safe(() => run.markToolCompacted(turnNumber, callIndex)),
        recordDelivery: (metric) => this.safe(() => run.recordDelivery?.(metric)),
        finish: (status: RunStatus) => this.safe(() => run.finish(status)),
      };
    } catch { this.error(); return NOOP_RUN; }
  }
  close(): void { this.safe(() => this.inner?.close()); }
  private safe(action: () => void): void { try { action(); } catch { this.error(); } }
  private error(): void { logEvent("worker", "audit_error", { category: "storage_unavailable" }); }
}
