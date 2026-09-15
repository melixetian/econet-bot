import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import type { PriceRates } from "./types.js";
import { loadSummary } from "./comparison.js";

type Row = Record<string, number | string | null>;
function value(value: number | string | null | undefined): string { return value === null || value === undefined ? "N/A" : String(value); }
function percent(numerator: number | null, denominator: number | null): string { return numerator === null || denominator === null || denominator === 0 ? "N/A" : `${(numerator / denominator * 100).toFixed(2)}%`; }
function money(amount: number): string { return `$${amount.toFixed(6)}`; }

export function renderDashboard(path: string, selectors: { profile?: string; runId?: string }, rates: PriceRates): string {
  if (!existsSync(path)) return "No token audit database exists yet.";
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (selectors.runId) return renderRun(database, selectors.runId);
    const where = selectors.profile ? "WHERE profile = ?" : "";
    const params = selectors.profile ? [selectors.profile] : [];
    const totals = database.prepare(`SELECT COUNT(*) runs, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) completed, SUM(CASE WHEN status IN ('error','limit','interrupted') THEN 1 ELSE 0 END) failed, CASE WHEN COUNT(input_tokens)=COUNT(*) THEN SUM(input_tokens) END input_tokens, CASE WHEN COUNT(cached_tokens)=COUNT(*) THEN SUM(cached_tokens) END cached_tokens, CASE WHEN COUNT(output_tokens)=COUNT(*) THEN SUM(output_tokens) END output_tokens, CASE WHEN COUNT(reasoning_tokens)=COUNT(*) THEN SUM(reasoning_tokens) END reasoning_tokens, SUM(estimated_cost_usd) cost, AVG(llm_calls) turns, AVG(tool_calls) tools FROM agent_runs ${where}`).get(...params) as Row;
    const labels = database.prepare("SELECT label FROM benchmark_runs ORDER BY id DESC").all() as { label: string }[];
    const benchmarkLines = labels.map(({ label }) => loadSummary(database, label)).filter((run) => !selectors.profile || run.profile === selectors.profile).map((run) => `  ${run.label}: ${run.valid ? "valid" : "INVALID"}; gross=${run.grossTokens ?? "N/A"}; reasons=${run.invalidReasons.join(",") || "none"}`);
    if (Number(totals.runs) === 0) return ["Token audit database is empty for this selection.", "Benchmark labels:", ...benchmarkLines].join("\n");
    const complete = totals.runs === totals.completed && totals.input_tokens !== null && totals.output_tokens !== null;
    if (!complete) for (const key of ["input_tokens", "output_tokens", "cached_tokens", "reasoning_tokens", "cost"]) totals[key] = null;
    const llm = database.prepare(`SELECT SUM(l.input_tokens) input_tokens, CASE WHEN COUNT(l.cached_tokens)=COUNT(*) THEN SUM(l.cached_tokens) END cached_tokens, SUM(l.repeated_input_tokens_estimated) repeated, SUM(l.new_input_tokens_estimated) fresh, AVG(l.latency_ms) latency, SUM(l.system_tokens_estimated) system_est, SUM(l.tools_tokens_estimated) tools_est, SUM(l.history_tokens_estimated) history_est, SUM(l.user_tokens_estimated) user_est, SUM(l.tool_output_tokens_estimated) tool_output_est FROM llm_calls l JOIN agent_runs r ON r.run_id=l.run_id ${selectors.profile ? "WHERE r.profile=?" : ""}`).get(...params) as Row;
    const toolRows = database.prepare(`SELECT t.tool_name, SUM(t.output_tokens_estimated) output_tokens_estimated, SUM(t.output_bytes) output_bytes, SUM(t.duration_ms) duration_ms FROM tool_calls t JOIN agent_runs r ON r.run_id=t.run_id ${selectors.profile ? "WHERE r.profile=?" : ""} GROUP BY t.tool_name ORDER BY output_tokens_estimated DESC`).all(...params) as Row[];
    const growth = database.prepare(`SELECT l.turn_number, AVG(l.system_tokens_estimated+l.tools_tokens_estimated+l.history_tokens_estimated+l.user_tokens_estimated+l.tool_output_tokens_estimated) input_estimated FROM llm_calls l JOIN agent_runs r ON r.run_id=l.run_id ${selectors.profile ? "WHERE r.profile=?" : ""} GROUP BY l.turn_number ORDER BY l.turn_number`).all(...params) as Row[];
    const lines = [
      `Token audit aggregate${selectors.profile ? ` (profile: ${selectors.profile})` : ""}`,
      `Runs: ${value(totals.runs)} | completed: ${value(totals.completed)} | failed/limited/interrupted: ${value(totals.failed)}`,
      `Exact tokens — input: ${value(totals.input_tokens)} | output: ${value(totals.output_tokens)} | cached: ${value(totals.cached_tokens)} | reasoning: ${value(totals.reasoning_tokens)}`,
      `Aggregate coverage: ${complete ? "complete" : "incomplete; exact totals and cost N/A"}`,
      `Estimated cost: ${totals.cost === null ? "N/A" : money(Number(totals.cost))}`,
      `Current price settings USD/1M (historical cost uses rates at capture time) — input: ${rates.inputUsdPer1M} | cached input: ${rates.cachedInputUsdPer1M} | output: ${rates.outputUsdPer1M} | reasoning: ${rates.reasoningUsdPer1M}`,
      `Averages/run — exact total tokens: ${totals.input_tokens === null || totals.output_tokens === null ? "N/A" : ((Number(totals.input_tokens) + Number(totals.output_tokens) + Number(totals.reasoning_tokens ?? 0)) / Number(totals.runs)).toFixed(2)} | turns: ${Number(totals.turns).toFixed(2)} | tool calls: ${Number(totals.tools).toFixed(2)} | LLM latency ms: ${llm.latency === null ? "N/A" : Number(llm.latency).toFixed(2)}`,
      `Provider cache hit rate: ${complete ? percent(llm.cached_tokens as number | null, llm.input_tokens as number | null) : "N/A"}`,
      `Estimated repeated/new input: ${value(llm.repeated)} / ${value(llm.fresh)} | repeated share: ${percent(llm.repeated as number | null, Number(llm.repeated ?? 0) + Number(llm.fresh ?? 0))}`,
      `Estimated context tokens — system: ${value(llm.system_est)} | tools: ${value(llm.tools_est)} | history: ${value(llm.history_est)} | user: ${value(llm.user_est)} | tool output: ${value(llm.tool_output_est)}`,
      `Estimated context growth by turn: ${growth.map((row) => `${row.turn_number}:${Number(row.input_estimated).toFixed(1)}`).join(" | ") || "N/A"}`,
      "Tools (model-visible output):",
      ...(toolRows.length ? toolRows.map((row) => `  ${row.tool_name}: estimated tokens=${row.output_tokens_estimated}, bytes=${row.output_bytes}, duration_ms=${row.duration_ms}`) : ["  none"]),
      "Benchmark labels (legacy/incomplete evidence cannot support comparisons):", ...benchmarkLines,
    ];
    return lines.join("\n");
  } finally { database.close(); }
}

function renderRun(database: Database.Database, runId: string): string {
  const run = database.prepare("SELECT run_id,profile,status,started_at,completed_at,llm_calls,tool_calls,input_tokens,output_tokens,cached_tokens,reasoning_tokens,estimated_cost_usd FROM agent_runs WHERE run_id=?").get(runId) as Row | undefined;
  if (!run) return "No audit run matched that opaque run ID.";
  const complete = run.status === "success" && run.input_tokens !== null && run.output_tokens !== null;
  if (!complete) for (const key of ["input_tokens", "output_tokens", "cached_tokens", "reasoning_tokens", "estimated_cost_usd"]) run[key] = null;
  const llm = database.prepare("SELECT * FROM llm_calls WHERE run_id=? ORDER BY turn_number").all(runId) as Row[];
  const tools = database.prepare("SELECT turn_number,call_index,tool_name,status,input_tokens_estimated,output_tokens_estimated,input_bytes,output_bytes,duration_ms,compacted FROM tool_calls WHERE run_id=? ORDER BY turn_number,call_index").all(runId) as Row[];
  const lines = [
    `Token audit run ${run.run_id}`,
    `Profile: ${run.profile} | status: ${run.status} | started: ${run.started_at} | completed: ${value(run.completed_at)}`,
    `Exact totals — input: ${value(run.input_tokens)} | output: ${value(run.output_tokens)} | cached: ${value(run.cached_tokens)} | reasoning: ${value(run.reasoning_tokens)} | cost: ${complete ? money(Number(run.estimated_cost_usd)) : "N/A"}`,
    "Timeline:",
  ];
  for (const call of llm) {
    lines.push(`  turn ${call.turn_number} LLM ${call.status}: input=${value(call.input_tokens)}, output=${value(call.output_tokens)}, cached=${value(call.cached_tokens)}, reasoning=${value(call.reasoning_tokens)}, latency_ms=${call.latency_ms}, cost=${call.input_tokens === null || call.output_tokens === null ? "N/A" : money(Number(call.estimated_cost_usd))}, usage_issue=${value(call.usage_issue)}, repeated_est=${call.repeated_input_tokens_estimated}, new_est=${call.new_input_tokens_estimated}`);
    for (const tool of tools.filter((item) => item.turn_number === call.turn_number)) lines.push(`    tool ${tool.call_index} ${tool.tool_name} ${tool.status}: input_est=${tool.input_tokens_estimated}, output_est=${tool.output_tokens_estimated}, input_bytes=${tool.input_bytes}, output_bytes=${tool.output_bytes}, duration_ms=${tool.duration_ms}, compacted=${Boolean(tool.compacted)}`);
  }
  return lines.join("\n");
}
