import { createHash, randomBytes } from "node:crypto";
import type { ChatMessage, ChatUsage, ToolDefinition } from "../inference/providers/provider.js";
import type { ContextMetrics, PriceRates } from "./types.js";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function utf8Bytes(value: unknown): number { return Buffer.byteLength(canonicalJson(value), "utf8"); }
export function estimateTokens(value: unknown): number { return Math.ceil(utf8Bytes(value) / 4); }

export function estimateCost(usage: ChatUsage | null, rates: PriceRates): number {
  if (!usage) return 0;
  const cached = usage.cachedTokens ?? 0;
  return ((usage.inputTokens - cached) * rates.inputUsdPer1M + cached * rates.cachedInputUsdPer1M + usage.outputTokens * rates.outputUsdPer1M + (usage.reasoningTokens ?? 0) * rates.reasoningUsdPer1M) / 1_000_000;
}

export type ContextCategory = "system" | "history" | "user" | "tool_output";
export interface CategorizedMessage { message: ChatMessage; category: ContextCategory; }

export class ContextTracker {
  private readonly salt = randomBytes(32);
  private readonly seen = new Set<string>();

  measure(messages: readonly CategorizedMessage[], tools: readonly ToolDefinition[]): ContextMetrics {
    const totals = { system: 0, history: 0, user: 0, tool_output: 0 };
    let repeated = 0;
    let fresh = 0;
    const units: Array<{ category: ContextCategory | "tools"; value: unknown }> = [
      ...messages.map(({ category, message }) => ({ category, value: message })),
      ...tools.map((tool) => ({ category: "tools" as const, value: tool })),
    ];
    const hashes: string[] = [];
    let toolsTokens = 0;
    for (const unit of units) {
      const tokens = estimateTokens(unit.value);
      if (unit.category === "tools") toolsTokens += tokens;
      else totals[unit.category] += tokens;
      const hash = createHash("sha256").update(this.salt).update(canonicalJson(unit.value)).digest("hex");
      if (this.seen.has(hash)) repeated += tokens;
      else fresh += tokens;
      hashes.push(hash);
    }
    for (const hash of hashes) this.seen.add(hash);
    return {
      systemTokensEstimated: totals.system,
      toolsTokensEstimated: toolsTokens,
      historyTokensEstimated: totals.history,
      userTokensEstimated: totals.user,
      toolOutputTokensEstimated: totals.tool_output,
      repeatedInputTokensEstimated: repeated,
      newInputTokensEstimated: fresh,
    };
  }
}

