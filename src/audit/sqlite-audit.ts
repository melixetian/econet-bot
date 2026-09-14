import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditProfile, AuditRun, AuditSink, LlmCallMetric, RunStatus, ToolCallMetric } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_runs (
 run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL,
 profile TEXT NOT NULL CHECK(profile IN ('baseline','optimized')), started_at TEXT NOT NULL,
 completed_at TEXT, status TEXT NOT NULL CHECK(status IN ('running','success','error','limit','interrupted')),
 llm_calls INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0,
 input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, reasoning_tokens INTEGER,
 estimated_cost_usd REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS llm_calls (
 id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
 turn_number INTEGER NOT NULL, timestamp TEXT NOT NULL, model TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('success','error')), input_tokens INTEGER, output_tokens INTEGER,
 cached_tokens INTEGER, reasoning_tokens INTEGER, latency_ms INTEGER NOT NULL, provider_duration_ms INTEGER,
 estimated_cost_usd REAL NOT NULL, system_tokens_estimated INTEGER NOT NULL, tools_tokens_estimated INTEGER NOT NULL,
 history_tokens_estimated INTEGER NOT NULL, user_tokens_estimated INTEGER NOT NULL,
 tool_output_tokens_estimated INTEGER NOT NULL, repeated_input_tokens_estimated INTEGER NOT NULL,
 new_input_tokens_estimated INTEGER NOT NULL, UNIQUE(run_id, turn_number)
);
CREATE TABLE IF NOT EXISTS tool_calls (
 id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
 turn_number INTEGER NOT NULL, call_index INTEGER NOT NULL, tool_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('success','error')), input_bytes INTEGER NOT NULL, output_bytes INTEGER NOT NULL,
 input_tokens_estimated INTEGER NOT NULL, output_tokens_estimated INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
 compacted INTEGER NOT NULL CHECK(compacted IN (0,1)), UNIQUE(run_id, turn_number, call_index)
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_profile_started ON agent_runs(profile, started_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_run_turn ON llm_calls(run_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run_turn ON tool_calls(run_id, turn_number, call_index);
CREATE TABLE IF NOT EXISTS benchmark_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, profile TEXT NOT NULL,
 dataset_hash TEXT NOT NULL, model TEXT NOT NULL, settings TEXT NOT NULL, environment TEXT NOT NULL, git_revision TEXT NOT NULL,
 started_at TEXT NOT NULL, completed_at TEXT NOT NULL, case_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS benchmark_cases (
 benchmark_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE, case_id TEXT NOT NULL,
 passed INTEGER NOT NULL CHECK(passed IN (0,1)), status TEXT NOT NULL, audit_run_id TEXT,
 PRIMARY KEY(benchmark_id, case_id)
);
CREATE TABLE IF NOT EXISTS benchmark_case_runs (
 benchmark_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE, case_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, audit_run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
 PRIMARY KEY(benchmark_id, case_id, ordinal)
);
CREATE TABLE IF NOT EXISTS tool_deliveries (
 run_id TEXT NOT NULL REFERENCES agent_runs(run_id), turn_number INTEGER NOT NULL, call_index INTEGER NOT NULL,
 llm_turn INTEGER NOT NULL, receipt INTEGER NOT NULL, output_bytes INTEGER NOT NULL,
 PRIMARY KEY(run_id,turn_number,call_index,llm_turn)
);`;

export class SqliteAudit implements AuditSink {
  private readonly database: Database.Database;
  constructor(path: string, private readonly agentId: string, recoverInterrupted = true) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.pragma("foreign_keys = ON");
    this.database.exec(SCHEMA);
    // Additive migration: keep all v1 audit rows and labels as historical evidence.
    const additions = {
      llm_calls: { usage_issue: "TEXT" },
      benchmark_runs: { format_version: "INTEGER NOT NULL DEFAULT 1", validity: "TEXT NOT NULL DEFAULT 'invalid'", invalid_reasons: "TEXT NOT NULL DEFAULT '[\"legacy_benchmark\"]'" },
      benchmark_cases: { diagnostics: "TEXT NOT NULL DEFAULT '{}'", expected_runs: "INTEGER NOT NULL DEFAULT 1" },
    };
    this.database.transaction(() => {
      for (const [table, columns] of Object.entries(additions)) {
        const present = new Set((this.database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name));
        for (const [column, type] of Object.entries(columns)) if (!present.has(column)) this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    })();
    if (recoverInterrupted) this.database.prepare("UPDATE agent_runs SET status='interrupted', completed_at=? WHERE status='running'").run(new Date().toISOString());
  }

  startRun(taskId: string, profile: AuditProfile): AuditRun {
    const runId = randomUUID();
    this.database.prepare("INSERT INTO agent_runs(run_id,task_id,agent_id,profile,started_at,status) VALUES(?,?,?,?,?,'running')").run(runId, taskId, this.agentId, profile, new Date().toISOString());
    let finished = false;
    return {
      runId,
      recordLlm: (metric) => { if (!finished) this.recordLlm(runId, metric); },
      recordTool: (metric) => { if (!finished) this.recordTool(runId, metric); },
      markToolCompacted: (turnNumber, callIndex) => { if (!finished) this.database.prepare("UPDATE tool_calls SET compacted=1 WHERE run_id=? AND turn_number=? AND call_index=?").run(runId, turnNumber, callIndex); },
      recordDelivery: (metric) => { if (!finished) this.database.prepare("INSERT INTO tool_deliveries VALUES(?,?,?,?,?,?)").run(runId, metric.turnNumber, metric.callIndex, metric.llmTurn, metric.receipt ? 1 : 0, metric.outputBytes); },
      finish: (status) => { if (!finished) { finished = true; this.finish(runId, status); } },
    };
  }

  private recordLlm(runId: string, metric: LlmCallMetric): void {
    const usage = metric.usage;
    this.database.prepare(`INSERT INTO llm_calls(run_id,turn_number,timestamp,model,status,input_tokens,output_tokens,cached_tokens,reasoning_tokens,latency_ms,provider_duration_ms,estimated_cost_usd,system_tokens_estimated,tools_tokens_estimated,history_tokens_estimated,user_tokens_estimated,tool_output_tokens_estimated,repeated_input_tokens_estimated,new_input_tokens_estimated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      runId, metric.turnNumber, metric.timestamp, metric.model, metric.status, usage?.inputTokens ?? null,
      usage?.outputTokens ?? null, usage?.cachedTokens ?? null, usage?.reasoningTokens ?? null, metric.latencyMs,
      usage?.providerDurationMs ?? null, metric.estimatedCostUsd, metric.systemTokensEstimated,
      metric.toolsTokensEstimated, metric.historyTokensEstimated, metric.userTokensEstimated,
      metric.toolOutputTokensEstimated, metric.repeatedInputTokensEstimated, metric.newInputTokensEstimated,
    );
    if (metric.usageIssue) this.database.prepare("UPDATE llm_calls SET usage_issue=? WHERE run_id=? AND turn_number=?").run(metric.usageIssue, runId, metric.turnNumber);
  }

  private recordTool(runId: string, metric: ToolCallMetric): void {
    this.database.prepare(`INSERT INTO tool_calls(run_id,turn_number,call_index,tool_name,status,input_bytes,output_bytes,input_tokens_estimated,output_tokens_estimated,duration_ms,compacted) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      runId, metric.turnNumber, metric.callIndex, metric.toolName, metric.status, metric.inputBytes,
      metric.outputBytes, metric.inputTokensEstimated, metric.outputTokensEstimated, metric.durationMs,
      metric.compacted ? 1 : 0,
    );
  }

  private finish(runId: string, status: RunStatus): void {
    this.database.prepare(`UPDATE agent_runs SET completed_at=?, status=?,
      llm_calls=(SELECT COUNT(*) FROM llm_calls WHERE run_id=?),
      tool_calls=(SELECT COUNT(*) FROM tool_calls WHERE run_id=?),
      input_tokens=(SELECT CASE WHEN COUNT(input_tokens)=COUNT(*) THEN SUM(input_tokens) END FROM llm_calls WHERE run_id=?),
      output_tokens=(SELECT CASE WHEN COUNT(output_tokens)=COUNT(*) THEN SUM(output_tokens) END FROM llm_calls WHERE run_id=?),
      cached_tokens=(SELECT CASE WHEN COUNT(cached_tokens)=COUNT(*) THEN SUM(cached_tokens) END FROM llm_calls WHERE run_id=?),
      reasoning_tokens=(SELECT CASE WHEN COUNT(reasoning_tokens)=COUNT(*) THEN SUM(reasoning_tokens) END FROM llm_calls WHERE run_id=?),
      estimated_cost_usd=(SELECT COALESCE(SUM(estimated_cost_usd),0) FROM llm_calls WHERE run_id=?) WHERE run_id=?`).run(
        new Date().toISOString(), status, runId, runId, runId, runId, runId, runId, runId, runId,
      );
  }

  close(): void { this.database.close(); }
}
