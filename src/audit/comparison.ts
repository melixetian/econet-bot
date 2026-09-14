import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { safeLabel } from "./benchmark-store.js";
import type { CaseDiagnostics } from "./benchmark-cases.js";

type Row = Record<string, string | number | null>;
type BenchmarkRow = { id: number; label: string; profile: string; dataset_hash: string; model: string; settings: string; environment: string; git_revision: string; started_at: string; completed_at: string; case_count: number; format_version?: number; validity?: string; invalid_reasons?: string };
export type BenchmarkSummary = BenchmarkRow & {
  valid: boolean; invalidReasons: string[]; passedCases: number; exactUsageComplete: boolean;
  inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; reasoningTokens: number | null; grossTokens: number | null; cost: number | null;
  llmCalls: number; toolCalls: number; latencyMs: number; repeatedEstimated: number; newEstimated: number; toolOutputBytes: number;
  cases: Array<{ id: string; passed: boolean; status: string; diagnostics: Partial<CaseDiagnostics> }>;
  contextEstimated: { system: number; tools: number; history: number; user: number; toolOutput: number };
  topTurns: Array<{ runId: string; turn: number; exactTokens: number | null; latencyMs: number }>;
  topTools: Array<{ name: string; outputEstimated: number; outputBytes: number; durationMs: number }>;
  linkedCases: number; agentRuns: number;
};
export type Comparison = { before: BenchmarkSummary; after: BenchmarkSummary; tokenReductionPercent: number | null; successRateDropPp: number | null; costReductionPercent: number | null; compatible: boolean; reasons: string[]; accepted: boolean };
function unavailable(label: string): BenchmarkSummary {
  return { id: 0, label, profile: "", dataset_hash: "", model: "", settings: "", environment: "", git_revision: "", started_at: "", completed_at: "", case_count: 0,
    valid: false, invalidReasons: ["missing_benchmark_result"], passedCases: 0, exactUsageComplete: false, inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, grossTokens: null, cost: null,
    llmCalls: 0, toolCalls: 0, latencyMs: 0, repeatedEstimated: 0, newEstimated: 0, toolOutputBytes: 0, cases: [], contextEstimated: { system: 0, tools: 0, history: 0, user: 0, toolOutput: 0 }, topTurns: [], topTools: [], linkedCases: 0, agentRuns: 0 };
}
function parse<T>(text: string | undefined, fallback: T): T { try { return JSON.parse(text ?? "") as T; } catch { return fallback; } }
function suppress(summary: BenchmarkSummary): void {
  summary.inputTokens = summary.outputTokens = summary.cachedTokens = summary.reasoningTokens = summary.grossTokens = summary.cost = null;
  summary.topTurns = summary.topTurns.map((row) => ({ ...row, exactTokens: null }));
}
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
export function loadSummary(database: Database.Database, label: string): BenchmarkSummary {
  const run = database.prepare("SELECT * FROM benchmark_runs WHERE label=?").get(label) as BenchmarkRow | undefined;
  if (!run) return unavailable(label);
  const rawCases = database.prepare("SELECT * FROM benchmark_cases WHERE benchmark_id=? ORDER BY case_id").all(run.id) as Array<{ case_id: string; passed: number; status: string; diagnostics?: string; expected_runs?: number }>;
  const cases = rawCases.map((row) => ({ id: row.case_id, passed: Boolean(row.passed), status: row.status, diagnostics: parse<Partial<CaseDiagnostics>>(row.diagnostics, {}) }));
  const links = database.prepare("SELECT case_id,audit_run_id,ordinal FROM benchmark_case_runs WHERE benchmark_id=? ORDER BY case_id,ordinal").all(run.id) as Array<{ case_id: string; audit_run_id: string; ordinal: number }>;
  const joined = (table: string) => database.prepare("SELECT t.* FROM benchmark_case_runs b JOIN " + table + " t ON t.run_id=b.audit_run_id WHERE b.benchmark_id=?").all(run.id) as Row[];
  const llm = joined("llm_calls"), tools = joined("tool_calls"), runs = joined("agent_runs");
  const deliveries = database.prepare("SELECT 1 FROM sqlite_master WHERE name='tool_deliveries'").get() ? joined("tool_deliveries") : [];
  const storedReasons = parse<unknown>(run.invalid_reasons, []);
  const reasons: string[] = Array.isArray(storedReasons) ? storedReasons.filter((code) => ["case_timeout", "incomplete_case", "missing_authoritative_usage", "context_window_exceeded", "audit_storage_error", "legacy_benchmark", "incompatible_environment"].includes(code)) : ["audit_storage_error"];
  if (run.format_version !== 2) reasons.push("legacy_benchmark");
  if (run.validity !== "valid" || !run.completed_at) reasons.push("invalid_or_incomplete_label");
  if (!run.case_count || cases.length !== run.case_count) reasons.push("incomplete_case");
  if (new Set(links.map((row) => row.audit_run_id)).size !== links.length || runs.length !== links.length) reasons.push("audit_storage_error");
  for (const row of rawCases) {
    const linked = links.filter((link) => link.case_id === row.case_id);
    if (linked.length !== row.expected_runs || !linked.length || linked.some((link, index) => link.ordinal !== index)) reasons.push("incomplete_case");
    const diagnostic = parse<Partial<CaseDiagnostics>>(row.diagnostics, {});
    if (row.status === "timeout" || diagnostic.reasons?.includes("case_timeout")) reasons.push("case_timeout");
    if (row.status !== "success" || diagnostic.completion !== "success") reasons.push("incomplete_case");
    if (diagnostic.usageComplete !== true) reasons.push("missing_authoritative_usage");
    for (const code of ["context_window_exceeded", "audit_storage_error"] as const) if (diagnostic.reasons?.includes(code)) reasons.push(code);
    const ids = linked.map((link) => link.audit_run_id);
    const caseTools = tools.filter((call) => ids.includes(String(call.run_id)));
    const caseDeliveries = deliveries.filter((call) => ids.includes(String(call.run_id)));
    if (diagnostic.llmCalls !== llm.filter((call) => ids.includes(String(call.run_id))).length || diagnostic.toolCalls !== caseTools.length) reasons.push("audit_storage_error");
    const full = caseTools.length > 0 && caseTools.every((tool) => caseDeliveries.some((delivery) => delivery.run_id === tool.run_id && delivery.turn_number === tool.turn_number && delivery.call_index === tool.call_index && delivery.llm_turn === Number(tool.turn_number) + 1 && delivery.receipt === 0));
    const receipt = caseDeliveries.some((delivery) => delivery.receipt === 1 && Number(delivery.llm_turn) > Number(delivery.turn_number) + 1);
    if (diagnostic.fullDelivery !== full || diagnostic.receiptDelivery !== receipt || diagnostic.toolCompacted !== (receipt || caseTools.some((tool) => tool.compacted === 1))) reasons.push("audit_storage_error");
    if (!Array.isArray(diagnostic.reasons) || Boolean(row.passed) !== (diagnostic.reasons.length === 0)) reasons.push("audit_storage_error");
  }
  if (runs.some((row) => row.status !== "success" || !row.completed_at)) reasons.push("incomplete_case");
  if (llm.some((row) => row.status !== "success")) reasons.push("incomplete_case");
  if (runs.some((row) => Number(row.llm_calls) < 1 || llm.filter((call) => call.run_id === row.run_id).length !== row.llm_calls || tools.filter((call) => call.run_id === row.run_id).length !== row.tool_calls)) reasons.push("audit_storage_error");
  const completedLlm = llm.filter((call) => call.status === "success");
  const exactUsageComplete = completedLlm.every((call) => count(call.input_tokens) && count(call.output_tokens) && (call.cached_tokens === null || (count(call.cached_tokens) && Number(call.cached_tokens) <= Number(call.input_tokens))));
  if (!exactUsageComplete) reasons.push("missing_authoritative_usage");
  const sum = (key: string) => llm.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const nullableSum = (key: string) => llm.length && llm.every((row) => row[key] !== null) ? sum(key) : null;
  const topTools = ["exec", "search_documents", "unknown"].map((name) => {
    const selected = tools.filter((row) => row.tool_name === name);
    return { name, outputEstimated: selected.reduce((s, r) => s + Number(r.output_tokens_estimated), 0), outputBytes: selected.reduce((s, r) => s + Number(r.output_bytes), 0), durationMs: selected.reduce((s, r) => s + Number(r.duration_ms), 0) };
  }).filter((row) => row.outputBytes > 0).sort((a, b) => b.outputEstimated - a.outputEstimated);
  const summary: BenchmarkSummary = { ...run, valid: reasons.length === 0, invalidReasons: [...new Set(reasons)], passedCases: cases.filter((row) => row.passed).length, exactUsageComplete,
    inputTokens: sum("input_tokens"), outputTokens: sum("output_tokens"), cachedTokens: nullableSum("cached_tokens"), reasoningTokens: nullableSum("reasoning_tokens"), grossTokens: sum("input_tokens") + sum("output_tokens") + sum("reasoning_tokens"), cost: sum("estimated_cost_usd"),
    llmCalls: llm.length, toolCalls: tools.length, latencyMs: sum("latency_ms"), repeatedEstimated: sum("repeated_input_tokens_estimated"), newEstimated: sum("new_input_tokens_estimated"),
    toolOutputBytes: tools.reduce((total, row) => total + Number(row.output_bytes), 0), cases,
    contextEstimated: { system: sum("system_tokens_estimated"), tools: sum("tools_tokens_estimated"), history: sum("history_tokens_estimated"), user: sum("user_tokens_estimated"), toolOutput: sum("tool_output_tokens_estimated") },
    topTurns: llm.map((row) => ({ runId: String(row.run_id), turn: Number(row.turn_number), exactTokens: count(row.input_tokens) && count(row.output_tokens) ? Number(row.input_tokens) + Number(row.output_tokens) + Number(row.reasoning_tokens ?? 0) : null, latencyMs: Number(row.latency_ms) })).sort((a, b) => (b.exactTokens ?? 0) - (a.exactTokens ?? 0)).slice(0, 5),
    topTools, linkedCases: new Set(links.map((row) => row.case_id)).size, agentRuns: runs.length };
  if (!summary.valid) suppress(summary);
  return summary;
}
export function compareBenchmarks(path: string, beforeLabel: string, afterLabel: string): Comparison {
  if (!safeLabel(beforeLabel) || !safeLabel(afterLabel)) throw new Error("invalid_selector");
  let before = unavailable(beforeLabel), after = unavailable(afterLabel);
  if (existsSync(path)) {
    const database = new Database(path, { readonly: true, fileMustExist: true });
    try {
      if (database.prepare("SELECT 1 FROM sqlite_master WHERE name='benchmark_runs'").get()) {
        before = loadSummary(database, beforeLabel); after = loadSummary(database, afterLabel);
      }
    } finally { database.close(); }
  }
  const reasons = [...before.invalidReasons, ...after.invalidReasons];
  for (const [key, code] of [["dataset_hash", "incompatible_dataset"], ["model", "incompatible_model"], ["settings", "incompatible_options_limits_pricing"], ["environment", "incompatible_environment"], ["git_revision", "incompatible_implementation"], ["case_count", "incompatible_case_count"]] as const) if (before[key] !== after[key]) reasons.push(code);
  if (before.cases.map((row) => row.id).join("|") !== after.cases.map((row) => row.id).join("|")) reasons.push("incompatible_cases");
  if (before.profile !== "baseline" || after.profile !== "optimized") reasons.push("incompatible_profiles");
  const compatible = before.valid && after.valid && reasons.length === 0;
  if (!compatible) { suppress(before); suppress(after); }
  const tokenReductionPercent = compatible && before.grossTokens! > 0 ? (before.grossTokens! - after.grossTokens!) / before.grossTokens! * 100 : null;
  const successRateDropPp = compatible ? (before.passedCases / before.case_count - after.passedCases / after.case_count) * 100 : null;
  const costReductionPercent = compatible && before.cost! > 0 ? (before.cost! - after.cost!) / before.cost! * 100 : null;
  if (compatible && (tokenReductionPercent === null || tokenReductionPercent < 30)) reasons.push("token_target_not_met");
  if (compatible && successRateDropPp! > 2) reasons.push("quality_guardrail_not_met");
  return { before, after, compatible, tokenReductionPercent, successRateDropPp, costReductionPercent, reasons: [...new Set(reasons)], accepted: compatible && reasons.length === 0 };
}
export function renderComparison(result: Comparison): string {
  const pct = (value: number | null) => value === null ? "N/A" : value.toFixed(2) + "%";
  const money = (value: number | null) => value === null ? "N/A" : "$" + value.toFixed(6);
  return [
    "Compatibility: " + (result.compatible ? "compatible" : "INVALID"),
    ...[result.before, result.after].map((run) => run.label + ": " + (run.valid ? "valid" : "invalid") + " | success " + run.passedCases + "/" + run.case_count + " | usage complete " + run.exactUsageComplete),
    "Gross exact tokens: " + (result.before.grossTokens ?? "N/A") + " -> " + (result.after.grossTokens ?? "N/A") + " | reduction " + pct(result.tokenReductionPercent),
    "Success-rate drop pp: " + (result.successRateDropPp?.toFixed(2) ?? "N/A"),
    "Hypothetical cost: " + money(result.before.cost) + " -> " + money(result.after.cost) + " | reduction " + pct(result.costReductionPercent),
    "Acceptance: " + (result.compatible ? result.accepted ? "PASS" : "FAIL" : "INVALID; thresholds not evaluated"),
    ...result.reasons.map((reason) => "- " + reason),
  ].join("\n");
}
