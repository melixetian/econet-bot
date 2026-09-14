import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import { FailOpenAudit } from "../src/audit/fail-open.js";
import { renderDashboard } from "../src/audit/read.js";
import { SqliteAudit } from "../src/audit/sqlite-audit.js";
import type { AuditSink } from "../src/audit/types.js";
import type { SqliteHistory } from "../src/history/sqlite-history.js";
import type { InferenceProvider, ProviderResponse } from "../src/inference/providers/provider.js";
import type { RagService } from "../src/rag/service.js";
import { testConfig } from "./test-config.js";

class History { turns: string[][] = []; recent() { return []; } saveTurn(_id: string, user: string, assistant: string) { this.turns.push([user, assistant]); } clear() {} }
class Provider implements InferenceProvider { index = 0; constructor(private readonly responses: ProviderResponse[]) {} async chat(): Promise<ProviderResponse> { return this.responses[this.index++]!; } }
class Rag { constructor(private readonly fails = false) {} async search() { if (this.fails) throw new Error("private failure"); return { status: "ok", results: [{ text: "private document text", filename: "secret-source.txt", chunkIndex: 0, distance: 0.1 }], omittedResults: 0 }; } }
const usage = { inputTokens: 100, outputTokens: 20, cachedTokens: 30, reasoningTokens: null };

function setup() {
  const root = mkdtempSync(join(tmpdir(), "audit-test-"));
  const path = join(root, "audit.sqlite");
  const storage = new SqliteAudit(path, "test-agent");
  return { root, path, storage, config: { ...testConfig, tokenAuditEnabled: true, tokenAuditDbPath: path } };
}

describe("agent audit persistence", () => {
  it("preserves prior audit records and running statuses on benchmark-only startup", () => {
    const state = setup();
    const old = state.storage.startRun("old-opaque-task", "baseline");
    state.storage.close();
    const benchmark = new SqliteAudit(state.path, "benchmark-agent", false);
    try {
      const database = new Database(state.path, { readonly: true });
      try { expect(database.prepare("SELECT run_id,status FROM agent_runs").all()).toEqual([{ run_id: old.runId, status: "running" }]); }
      finally { database.close(); }
    } finally { benchmark.close(); rmSync(state.root, { recursive: true, force: true }); }
  });
  it("finalizes history failures without persisting exception content", async () => {
    const state = setup();
    try {
      const history = { recent() { throw new Error("private history failure"); }, saveTurn() {}, clear() {} };
      await expect(new Agent(new Provider([]), history as unknown as SqliteHistory, [], state.config, new Rag() as unknown as RagService, state.storage).chat("c", "u", "private prompt", new AbortController().signal)).rejects.toThrow();
      const database = new Database(state.path, { readonly: true });
      try { expect(database.prepare("SELECT status FROM agent_runs").get()).toEqual({ status: "error" }); }
      finally { database.close(); }
      expect(readFileSync(state.path).toString("utf8")).not.toContain("private history failure");
    } finally { state.storage.close(); rmSync(state.root, { recursive: true, force: true }); }
  });
  it("records exactly one metric per successful LLM call and normalized tool metadata without raw content", async () => {
    const state = setup();
    try {
      const provider = new Provider([{ content: "", toolCalls: [{ id: "s", name: "search_documents", arguments: { query: "private query" } }], usage }, { content: "private response", toolCalls: [], usage }]);
      const agent = new Agent(provider, new History() as unknown as SqliteHistory, [], state.config, new Rag() as unknown as RagService, new FailOpenAudit(state.storage));
      await agent.chat("private-chat-id", "private-user-id", "private prompt", new AbortController().signal, "opaque-task");
      const database = new Database(state.path, { readonly: true });
      let runId = "";
      try {
        const run = database.prepare("SELECT run_id,status,llm_calls,tool_calls,input_tokens,output_tokens,cached_tokens FROM agent_runs").get() as Record<string, string | number>;
        runId = String(run.run_id);
        expect(run).toMatchObject({ status: "success", llm_calls: 2, tool_calls: 1, input_tokens: 200, output_tokens: 40, cached_tokens: 60 });
        expect(database.prepare("SELECT tool_name,status FROM tool_calls").get()).toEqual({ tool_name: "search_documents", status: "success" });
      } finally { database.close(); }
      state.storage.close();
      const bytes = readFileSync(state.path).toString("utf8");
      for (const forbidden of ["private prompt", "private query", "private response", "private document text", "secret-source.txt", "private-user-id", "private-chat-id"]) expect(bytes).not.toContain(forbidden);
      const dashboard = renderDashboard(state.path, {}, { inputUsdPer1M: 0, cachedInputUsdPer1M: 0, outputUsdPer1M: 0, reasoningUsdPer1M: 0 });
      expect(renderDashboard(state.path, { runId }, { inputUsdPer1M: 0, cachedInputUsdPer1M: 0, outputUsdPer1M: 0, reasoningUsdPer1M: 0 })).toContain("turn 1 LLM success");
      for (const forbidden of ["private prompt", "private query", "private response", "secret-source.txt", "private-user-id", "private-chat-id"]) expect(dashboard).not.toContain(forbidden);
    } finally { try { state.storage.close(); } catch {} rmSync(state.root, { recursive: true, force: true }); }
  });

  it("records failed LLM calls and finalizes error and step-limit runs", async () => {
    const state = setup();
    try {
      const throwing: InferenceProvider = { chat: async () => { throw new Error("private provider body"); } };
      await expect(new Agent(throwing, new History() as unknown as SqliteHistory, [], state.config, new Rag() as unknown as RagService, new FailOpenAudit(state.storage)).chat("c", "u", "p", new AbortController().signal, "error-task")).rejects.toThrow();
      const limitProvider = new Provider([{ content: "", toolCalls: [{ id: "x", name: "exec", arguments: { command: "never executed" } }], usage }]);
      await new Agent(limitProvider, new History() as unknown as SqliteHistory, [], { ...state.config, agentMaxSteps: 1 }, new Rag() as unknown as RagService, new FailOpenAudit(state.storage)).chat("c", "u", "p", new AbortController().signal, "limit-task");
      const database = new Database(state.path, { readonly: true });
      try { expect(database.prepare("SELECT status FROM agent_runs ORDER BY started_at, rowid").all()).toEqual([{ status: "error" }, { status: "limit" }]); expect(database.prepare("SELECT status FROM llm_calls ORDER BY id").all()).toEqual([{ status: "error" }, { status: "success" }]); }
      finally { database.close(); }
    } finally { state.storage.close(); rmSync(state.root, { recursive: true, force: true }); }
  });

  it("normalizes invalid tools and search failures", async () => {
    const state = setup();
    try {
      const provider = new Provider([{ content: "", toolCalls: [{ id: "x", name: "attacker-private-name", arguments: { secret: "private" } }, { id: "s", name: "search_documents", arguments: { query: "private" } }], usage }, { content: "done", toolCalls: [], usage }]);
      await new Agent(provider, new History() as unknown as SqliteHistory, [], state.config, new Rag(true) as unknown as RagService, new FailOpenAudit(state.storage)).chat("c", "u", "p", new AbortController().signal, "tools-task");
      const database = new Database(state.path, { readonly: true });
      try { expect(database.prepare("SELECT tool_name,status FROM tool_calls ORDER BY call_index").all()).toEqual([{ tool_name: "unknown", status: "error" }, { tool_name: "search_documents", status: "error" }]); }
      finally { database.close(); }
    } finally { state.storage.close(); rmSync(state.root, { recursive: true, force: true }); }
  });

  it("fails open when audit startup is unavailable", async () => {
    const badSink: AuditSink = { startRun() { throw new Error("unavailable"); }, close() {} };
    const history = new History();
    const answer = await new Agent(new Provider([{ content: "answer", toolCalls: [], usage }]), history as unknown as SqliteHistory, [], { ...testConfig, tokenAuditEnabled: true }, new Rag() as unknown as RagService, badSink).chat("c", "u", "p", new AbortController().signal);
    expect(answer).toBe("answer"); expect(history.turns).toEqual([["p", "answer"]]);
  });
});
