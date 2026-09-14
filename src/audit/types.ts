import type { ChatUsage } from "../inference/providers/provider.js";

export type AuditProfile = "baseline" | "optimized";
export type RunStatus = "success" | "error" | "limit";
export type CallStatus = "success" | "error";

export interface PriceRates {
  inputUsdPer1M: number;
  cachedInputUsdPer1M: number;
  outputUsdPer1M: number;
  reasoningUsdPer1M: number;
}

export interface ContextMetrics {
  systemTokensEstimated: number;
  toolsTokensEstimated: number;
  historyTokensEstimated: number;
  userTokensEstimated: number;
  toolOutputTokensEstimated: number;
  repeatedInputTokensEstimated: number;
  newInputTokensEstimated: number;
}

export interface LlmCallMetric extends ContextMetrics {
  turnNumber: number;
  timestamp: string;
  model: string;
  status: CallStatus;
  usage: ChatUsage | null;
  latencyMs: number;
  estimatedCostUsd: number;
  usageIssue?: import("../inference/providers/provider.js").UsageIssue;
}

export interface ToolCallMetric {
  turnNumber: number;
  callIndex: number;
  toolName: "exec" | "search_documents" | "unknown";
  status: CallStatus;
  inputBytes: number;
  outputBytes: number;
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  durationMs: number;
  compacted: boolean;
}

export interface AuditRun {
  readonly runId: string;
  recordLlm(metric: LlmCallMetric): void;
  recordTool(metric: ToolCallMetric): void;
  markToolCompacted(turnNumber: number, callIndex: number): void;
  recordDelivery?(metric: { turnNumber: number; callIndex: number; llmTurn: number; receipt: boolean; outputBytes: number }): void;
  finish(status: RunStatus): void;
}

export interface AuditSink {
  startRun(taskId: string, profile: AuditProfile): AuditRun;
  close(): void;
}
