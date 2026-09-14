import { randomUUID } from "node:crypto";
import { Agent } from "../agent/agent.js";
import type { SqliteHistory, StoredMessage } from "../history/sqlite-history.js";
import type { RagService } from "../rag/service.js";
import type { WorkerConfig } from "../config.js";
import { ProviderTimeoutError, type InferenceProvider } from "../inference/providers/provider.js";
import type { AuditRun, AuditSink, AuditProfile } from "./types.js";
import { BenchmarkError, fitsContext, requestEstimate, effectiveConfig, type BenchmarkSettings } from "./benchmark-preflight.js";
import { FixtureRag, execFixture, expectedExecCommand, DUPLICATE_EXEC_FIXTURE, UNEXPECTED_EXEC_FIXTURE, historyFixture, scoreCase, INVALID_REASONS, type BenchmarkCase, type CaseMetrics, type CaseDiagnostics, type Reason } from "./benchmark-cases.js";

export class MemoryHistory {
  private messages: StoredMessage[];
  constructor(private readonly owner: string, seed: StoredMessage[] = []) { this.messages = structuredClone(seed); }
  recent(id: string, limit: number): StoredMessage[] { return id === this.owner ? this.messages.slice(-limit) : []; }
  saveTurn(id: string, user: string, assistant: string): void {
    if (id !== this.owner) throw new BenchmarkError("fixture_initialization_failed");
    this.messages.push({ role: "user", content: user }, { role: "assistant", content: assistant });
  }
  clear(id: string): void { if (id === this.owner) this.messages = []; }
}

// Production auditing stays fail-open; benchmark evidence must be fail-closed.
// This adapter retains only counters/statuses, never request or answer bodies.
export class CaseAudit implements AuditSink {
  readonly metrics: CaseMetrics = { runIds: [], statuses: [], llm: [], tools: [], deliveries: [] };
  failed = false;
  constructor(private readonly storage: AuditSink) {}
  private persist(action: () => void): void { try { action(); } catch { this.failed = true; } }
  startRun(taskId: string, profile: AuditProfile): AuditRun {
    let inner: AuditRun;
    try { inner = this.storage.startRun(taskId, profile); }
    catch { this.failed = true; throw new BenchmarkError("audit_storage_error"); }
    this.metrics.runIds.push(inner.runId);
    const toolOffset = this.metrics.tools.length;
    return {
      runId: inner.runId,
      recordLlm: (metric) => { this.metrics.llm.push(metric); this.persist(() => inner.recordLlm(metric)); },
      recordTool: (metric) => { this.metrics.tools.push({ ...metric }); this.persist(() => inner.recordTool(metric)); },
      markToolCompacted: (turn, index) => {
        const tool = this.metrics.tools.slice(toolOffset).find((item) => item.turnNumber === turn && item.callIndex === index);
        if (tool) tool.compacted = true;
        this.persist(() => inner.markToolCompacted(turn, index));
      },
      recordDelivery: (metric) => { this.metrics.deliveries.push(metric); this.persist(() => { if (!inner.recordDelivery) throw new Error(); inner.recordDelivery(metric); }); },
      finish: (status) => { this.metrics.statuses.push(status); this.persist(() => inner.finish(status)); },
    };
  }
  close(): void { /* owns no storage handle */ }
}

export async function runCase(testCase: BenchmarkCase, profile: AuditProfile, base: WorkerConfig, settings: BenchmarkSettings, skills: readonly string[], provider: InferenceProvider, storage: AuditSink): Promise<{ diagnostics: CaseDiagnostics; runIds: string[] }> {
  const owner = randomUUID(), conversation = randomUUID();
  const history = new MemoryHistory(conversation, testCase.history ? historyFixture() : []);
  const rag = new FixtureRag(owner, testCase);
  const audit = new CaseAudit(storage);
  const controller = new AbortController();
  // Budget covers every allowed LLM turn of every prescribed conversation turn.
  const duration = settings.caseTimeoutMs * testCase.prompts.length;
  if (duration > 2_147_483_647) throw new BenchmarkError("invalid_benchmark_limits");
  const timer = setTimeout(() => controller.abort(), duration);
  let completion: CaseDiagnostics["completion"] = "success";
  let failure: Reason | undefined;
  let execResultReturned = false;
  const guarded: InferenceProvider = {
    async chat(messages, tools, signal) {
      if (!fitsContext(requestEstimate(messages, tools), settings)) throw new BenchmarkError("context_window_exceeded");
      const response = await provider.chat(messages, tools, signal);
      // An observed near-window prompt is invalid even if the estimate was low.
      // Never substitute estimates for missing provider counters.
      if (response.usage && response.usage.inputTokens + settings.options.num_predict + 512 > settings.options.num_ctx) failure = "context_window_exceeded";
      return response;
    },
  };
  const expectedCommand = expectedExecCommand(testCase);
  const agent = new Agent(guarded, history as unknown as SqliteHistory, skills, { ...effectiveConfig(base, settings), tokenAuditProfile: profile }, rag as unknown as RagService, audit, async (call, _workspace, _timeout, signal) => {
    signal?.throwIfAborted();
    const args = typeof call.arguments === "object" && call.arguments !== null && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : {};
    if (call.name !== "exec" || typeof args.command !== "string" || args.command.trim() !== expectedCommand) return UNEXPECTED_EXEC_FIXTURE;
    if (execResultReturned) return DUPLICATE_EXEC_FIXTURE;
    execResultReturned = true;
    return execFixture(call);
  });
  let answer = "";
  try {
    for (const prompt of testCase.prompts) {
      controller.signal.throwIfAborted();
      answer = await agent.chat(conversation, owner, prompt, controller.signal, randomUUID());
      if (audit.metrics.statuses.at(-1) !== "success" || failure) { completion = "incomplete"; break; }
    }
  } catch (error) {
    completion = controller.signal.aborted || error instanceof ProviderTimeoutError ? "timeout" : "error";
    if (error instanceof BenchmarkError && INVALID_REASONS.includes(error.code as Reason)) failure = error.code as Reason;
  } finally {
    // Awaited aborted fetch/body settlement above: no background case races.
    clearTimeout(timer); controller.abort(); history.clear(conversation);
  }
  const diagnostics = scoreCase(testCase, answer, audit.metrics, completion, rag.sourceObserved, rag.queryValid, profile, settings.historyBudget);
  answer = "";
  if (failure) diagnostics.reasons.push(failure);
  if (audit.failed) diagnostics.reasons.push("audit_storage_error");
  diagnostics.reasons = [...new Set(diagnostics.reasons)];
  return { diagnostics, runIds: audit.metrics.runIds };
}
