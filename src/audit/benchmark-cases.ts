import type { StoredMessage } from "../history/sqlite-history.js";
import type { SearchResponse, SearchResult } from "../rag/types.js";
import type { ToolCall } from "../inference/providers/provider.js";
import type { AuditProfile, LlmCallMetric, ToolCallMetric } from "./types.js";
import { estimateTokens } from "./metrics.js";

export type SafeTool = "exec" | "search_documents" | "unknown";
export type Reason = "case_timeout" | "incomplete_case" | "missing_authoritative_usage" | "missing_required_tool" | "unexpected_tool_count" | "missing_required_value" | "missing_query_term" | "missing_source" | "missing_source_metadata" | "missing_citation" | "forbidden_claim" | "unexpected_status" | "missing_tool_round" | "missing_compaction" | "missing_full_delivery" | "context_window_exceeded" | "audit_storage_error";
export interface Source { filename: string; chunkIndex: number; pageNumber?: number }
export interface BenchmarkCase {
  id: string; prompts: string[]; values: string[][]; tools: SafeTool[];
  source?: Source; additionalSource?: Source; fact?: string; secondFact?: string;
  history?: boolean; noMatch?: boolean; overlap?: boolean; sequential?: boolean;
  queryTerms?: string[]; forbidden?: string[]; exec?: "large" | "failure" | "ticket";
}
export interface Dataset { version: number; cases: BenchmarkCase[] }
export interface Delivery { turnNumber: number; callIndex: number; llmTurn: number; receipt: boolean; outputBytes: number }
export interface CaseMetrics {
  runIds: string[]; statuses: string[]; llm: LlmCallMetric[]; tools: ToolCallMetric[]; deliveries: Delivery[];
}
export interface CaseDiagnostics {
  completion: "success" | "error" | "timeout" | "incomplete";
  reasons: Reason[]; expectedTools: SafeTool[]; observedTools: SafeTool[];
  llmCalls: number; toolCalls: number; usageComplete: boolean;
  contextCompacted: boolean; toolCompacted: boolean; fullDelivery: boolean; receiptDelivery: boolean;
  usageIssues: string[]; toolCountsExpected: boolean; valuesObserved: boolean;
  queryTermsObserved: boolean; sourceMetadataObserved: boolean; citationsObserved: boolean;
}

export function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/\$(\d+)/g, "$1 dollars")
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/\b(\d+)\s+of\s+(november)\b/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function phrase(answer: string, value: string): boolean { return (" " + normalize(answer) + " ").includes(" " + normalize(value) + " "); }
export function citation(answer: string, source: Source): boolean {
  // Require the exact filename and locator, but accept normal citation layouts
  // such as "filename, page 7", "page 7 of filename", or "p. 7".
  const normalized = normalize(answer);
  const escapedFilename = normalize(source.filename).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const kind = source.pageNumber === undefined ? "chunk" : "page";
  const expected = source.pageNumber ?? source.chunkIndex;
  const locator = kind === "page" ? "(?:page|p)" : "chunks?";
  const number = String(expected);
  const afterFilename = new RegExp(`(?:source )?${escapedFilename}(?: source)? ${locator} (?:number )?${number}\\b`);
  const beforeFilename = new RegExp(`${locator} (?:number )?${number}(?: of| in| from)? ${escapedFilename}\\b`);
  if (afterFilename.test(normalized) || beforeFilename.test(normalized)) return true;
  // One citation may list adjacent chunk locators together.
  if (kind !== "chunk") return false;
  const suffix = normalized.split(new RegExp(`(?:source )?${escapedFilename} chunks? `)).slice(1);
  return suffix.some((text) => text.split(/\s+/).slice(0, 5).includes(number));
}
export function historyFixture(): StoredMessage[] {
  const history: StoredMessage[] = [];
  for (let index = 0; index < 8; index += 1) {
    history.push({ role: "user", content: ("Archived routine planning note " + (index + 1) + ". The room was checked and routine supplies were counted. ").repeat(13) });
    history.push({ role: "assistant", content: "Acknowledged. This archived planning note has no reservation code." });
  }
  history.push({ role: "user", content: "My recent synthetic reservation code is ORBIT-731." }, { role: "assistant", content: "Your reservation code is ORBIT-731." });
  return history;
}
const ticket = "TICKET-731. " + "Routine ticket receipt. No desk assignment is present in this receipt. ".repeat(9);
const padding = (length: number) => "Routine archived note. Inventory checked. ".repeat(Math.ceil(length / 41)).slice(0, length);
export function execFixture(call: ToolCall): string {
  const args = call.arguments;
  const command = typeof args === "object" && args !== null && !Array.isArray(args) && Object.keys(args).length === 1 ? (args as Record<string, unknown>).command : null;
  const base = { timedOut: false, aborted: false, truncated: false, stderr: "" };
  if (call.name !== "exec" || typeof command !== "string") return JSON.stringify({ ok: false, error: "Invalid fixture command" });
  if (command.trim() === "audit-failure") return JSON.stringify({ ...base, ok: false, exitCode: 1, stdout: "" });
  if (command.trim() === "audit-large") return JSON.stringify({ ...base, ok: true, exitCode: 0, stdout: "Result BATCH-731.\n" + padding(12_000) + "\nResult BATCH-731: success." });
  if (command.trim() === "audit-ticket") return JSON.stringify({ ...base, ok: true, exitCode: 0, stdout: ticket });
  return JSON.stringify({ ok: false, error: "Unknown fixture command" });
}
export const DUPLICATE_EXEC_FIXTURE = JSON.stringify({ ok: false, error: "Duplicate benchmark tool call; use the result already returned." });
export const UNEXPECTED_EXEC_FIXTURE = JSON.stringify({ ok: false, error: "Command is not available in this benchmark case." });
export const DUPLICATE_SEARCH_FIXTURE: SearchResponse = { status: "no_match", results: [] };
export function expectedExecCommand(testCase: BenchmarkCase): string | undefined {
  return testCase.exec === "large" ? "audit-large" : testCase.exec === "ticket" ? "audit-ticket" : testCase.exec === "failure" ? "audit-failure" : undefined;
}
export function ragFixture(testCase: BenchmarkCase): SearchResponse {
  if (testCase.noMatch || !testCase.source) return { status: "no_match", results: [] };
  const first: SearchResult = { ...testCase.source, text: testCase.fact ?? "", distance: 0.1 };
  if (testCase.sequential) first.text = ticket + "\n" + first.text;
  if (!testCase.overlap) return { status: "ok", results: [first], omittedResults: 0 };
  const overlap = padding(640);
  first.text += "\n" + padding(1200) + overlap;
  const second: SearchResult = { ...testCase.additionalSource!, text: overlap + "\n" + testCase.secondFact + padding(1200), distance: 0.2 };
  const results = [first, second, { ...first, chunkIndex: 4, text: padding(1700), distance: 0.3 }, { ...first, chunkIndex: 6, text: padding(1700), distance: 0.4 }];
  return { status: "ok", results, omittedResults: 0 };
}

// Fixtures are scoped to a fresh owner per case and never touch runtime RAG.
export class FixtureRag {
  sourceObserved = false;
  queryValid = true;
  calls = 0;
  constructor(private readonly owner: string, private readonly testCase: BenchmarkCase) {}
  async search(owner: string, query: string, signal?: AbortSignal): Promise<SearchResponse> {
    signal?.throwIfAborted();
    if (owner !== this.owner) return { status: "no_match", results: [] };
    this.calls += 1;
    if (this.calls > 1) return DUPLICATE_SEARCH_FIXTURE;
    this.queryValid &&= (this.testCase.queryTerms ?? []).every((term) => phrase(query, term));
    const response = ragFixture(this.testCase);
    const expected = [this.testCase.source, this.testCase.additionalSource].filter((source): source is Source => !!source);
    this.sourceObserved ||= expected.every((source) => response.results.some((result) => result.filename === source.filename && result.chunkIndex === source.chunkIndex && result.pageNumber === source.pageNumber));
    return response;
  }
}
export function scoreCase(testCase: BenchmarkCase, answer: string, metrics: CaseMetrics, completion: CaseDiagnostics["completion"], sourceObserved: boolean, queryValid: boolean, profile: AuditProfile, historyBudget: number): CaseDiagnostics {
  const reasons: Reason[] = [];
  const observed = metrics.tools.map((tool) => tool.toolName);
  if (completion === "timeout") reasons.push("case_timeout");
  else if (completion !== "success" || metrics.runIds.length !== testCase.prompts.length) reasons.push("incomplete_case");
  if (metrics.statuses.some((status) => status !== "success")) reasons.push("unexpected_status");
  const completedLlmCalls = metrics.llm.filter((call) => call.status === "success");
  const usageComplete = completedLlmCalls.every((call) => call.usage !== null);
  if (!usageComplete) reasons.push("missing_authoritative_usage");
  if (!testCase.tools.every((name) => observed.includes(name))) reasons.push("missing_required_tool");
  if (observed.some((name) => !testCase.tools.includes(name))) reasons.push("unexpected_status");
  const toolCountsExpected = observed.length === testCase.tools.length && testCase.tools.every((name) => observed.filter((item) => item === name).length === testCase.tools.filter((item) => item === name).length);
  if (!toolCountsExpected) reasons.push("unexpected_tool_count");
  const valuesObserved = testCase.values.every((alternatives) => alternatives.some((value) => phrase(answer, value)));
  const queryTermsObserved = queryValid;
  if (!valuesObserved) reasons.push("missing_required_value");
  if (!queryTermsObserved) reasons.push("missing_query_term");
  const sources = [testCase.source, testCase.additionalSource].filter((source): source is Source => !!source);
  const sourceMetadataObserved = sources.length === 0 || sourceObserved;
  const citationsObserved = sources.every((source) => citation(answer, source));
  if (!sourceMetadataObserved) reasons.push("missing_source", "missing_source_metadata");
  if (!citationsObserved) reasons.push("missing_source", "missing_citation");
  if ((testCase.forbidden ?? []).some((claim) => phrase(answer, claim))) reasons.push("forbidden_claim");
  if (testCase.exec === "failure" && !metrics.tools.some((call) => call.toolName === "exec" && call.status === "error")) reasons.push("unexpected_status");
  if (testCase.exec && testCase.exec !== "failure" && !metrics.tools.some((call) => call.toolName === "exec" && call.status === "success")) reasons.push("unexpected_status");
  const fullDelivery = metrics.tools.length > 0 && metrics.tools.every((tool) => metrics.deliveries.some((delivery) => delivery.turnNumber === tool.turnNumber && delivery.callIndex === tool.callIndex && delivery.llmTurn === tool.turnNumber + 1 && !delivery.receipt));
  const receiptDelivery = metrics.deliveries.some((delivery) => delivery.receipt && delivery.llmTurn > delivery.turnNumber + 1);
  if (testCase.sequential) {
    const first = metrics.tools.find((call) => call.toolName === "exec");
    const second = metrics.tools.find((call) => call.toolName === "search_documents");
    if (!first || !second || first.turnNumber >= second.turnNumber) reasons.push("missing_tool_round");
    if (!fullDelivery) reasons.push("missing_full_delivery");
    if (profile === "optimized" && !receiptDelivery) reasons.push("missing_compaction");
  }
  const contextCompacted = profile === "optimized" && !!testCase.history && metrics.llm.some((call) => call.historyTokensEstimated < historyFixture().reduce((sum, message) => sum + estimateTokens(message), 0));
  if (profile === "optimized" && testCase.history && metrics.llm.some((call) => call.historyTokensEstimated > historyBudget)) reasons.push("unexpected_status");
  return { completion, reasons: [...new Set(reasons)], expectedTools: testCase.tools, observedTools: observed, llmCalls: metrics.llm.length, toolCalls: metrics.tools.length, usageComplete, contextCompacted, toolCompacted: metrics.tools.some((tool) => tool.compacted) || receiptDelivery, fullDelivery, receiptDelivery, usageIssues: [...new Set(completedLlmCalls.flatMap((call) => call.usageIssue ? [call.usageIssue] : []))], toolCountsExpected, valuesObserved, queryTermsObserved, sourceMetadataObserved, citationsObserved };
}
export const INVALID_REASONS: readonly Reason[] = ["case_timeout", "incomplete_case", "missing_authoritative_usage", "context_window_exceeded", "audit_storage_error"];
export function validCase(diagnostics: CaseDiagnostics): boolean {
  return diagnostics.completion === "success" && diagnostics.usageComplete && !diagnostics.reasons.some((code) => INVALID_REASONS.includes(code));
}
