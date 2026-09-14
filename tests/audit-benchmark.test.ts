import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { loadSkills } from "../src/agent/skills.js";
import { benchmarkSettings, fixturePreflight, fitsContext, preflight, verifyPreflightEvidence } from "../src/audit/benchmark-preflight.js";
import { FixtureRag, execFixture, historyFixture, ragFixture, scoreCase, validCase, normalize, citation, type Dataset, type CaseMetrics } from "../src/audit/benchmark-cases.js";
import { MemoryHistory, runCase } from "../src/audit/benchmark-runner.js";
import { compactExecOutput, compactRagOverlap, selectHistory, compactOldToolResults } from "../src/audit/optimizations.js";
import { estimateTokens } from "../src/audit/metrics.js";
import { SqliteAudit } from "../src/audit/sqlite-audit.js";
import type { AuditSink } from "../src/audit/types.js";
import type { ChatMessage, InferenceProvider, ProviderResponse } from "../src/inference/providers/provider.js";
import { testConfig } from "./test-config.js";

const dataset = JSON.parse(readFileSync(new URL("../benchmarks/token-audit-v2.json", import.meta.url), "utf8")) as Dataset;
const settings = benchmarkSettings(testConfig, {});
const usage = { inputTokens: 100, outputTokens: 10, cachedTokens: null, reasoningTokens: null };
const storage = (): AuditSink => ({ startRun: () => ({ runId: randomUUID(), recordLlm() {}, recordTool() {}, markToolCompacted() {}, recordDelivery() {}, finish() {} }), close() {} });
const final = (content: string): ProviderResponse => ({ content, toolCalls: [], usage });
const byId = (id: string) => dataset.cases.find((item) => item.id === id)!;

describe("v2 fixtures and deterministic preflight", () => {
  it("fits moderate baseline history and bundled Skills within the guarded context window", () => {
    const skills = loadSkills(new URL("../skills/", import.meta.url).pathname);
    expect(fitsContext(fixturePreflight(dataset, skills, settings), settings)).toBe(true);
    const history = historyFixture();
    expect(history.every((message) => message.content.length < 1400)).toBe(true);
    expect(history.reduce((sum, message) => sum + estimateTokens(message), 0)).toBeGreaterThan(2400);
    const selected = selectHistory(history, 1600);
    expect(selected.reduce((sum, message) => sum + estimateTokens(message), 0)).toBeLessThanOrEqual(1600);
    expect(selected.at(-2)?.content).toContain("ORBIT-731");
    const oversized = [...history, { role: "user" as const, content: "large".repeat(5000) }, { role: "assistant" as const, content: "ACK" }];
    expect(selectHistory(oversized, 1600)).toEqual(selected);
  });
  it("uses identical explicit options and accommodates all allowed turns", () => {
    expect(settings.options).toEqual({ temperature: 0, seed: 731, num_ctx: 16384, num_predict: 256 });
    expect(settings.caseTimeoutMs).toBeGreaterThan(settings.agentMaxSteps * settings.llmTimeoutMs);
    expect(() => benchmarkSettings(testConfig, { TOKEN_AUDIT_BENCHMARK_CASE_TIMEOUT_MS: "60000" })).toThrow("invalid_benchmark_limits");
    expect(() => fixturePreflight(dataset, [], { ...settings, options: { ...settings.options, num_ctx: 1024 } })).toThrow("context_window_exceeded");
    expect(() => fixturePreflight({ ...dataset, cases: [dataset.cases[0]!] }, [], settings)).toThrow("invalid_dataset");
  });
  it.each(["ok", "unavailable", "no-usage", "small-context", "unverified-context", "http-error"] as const)("handles %s preflight entirely with mock providers", async (mode) => {
    const digest = "a".repeat(64);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      const body = path.endsWith("/api/tags") ? { models: mode === "unavailable" ? [] : [{ name: "chat", digest }] }
        : path.endsWith("/api/show") ? { model_info: { "model.context_length": mode === "small-context" ? 4096 : 32768 } }
        : path.endsWith("/api/version") ? { version: "0.17.0" }
        : { models: [{ name: "chat", digest, context_length: mode === "unverified-context" ? 4096 : 16384 }] };
      return new Response(JSON.stringify(body), { status: mode === "http-error" ? 503 : 200 });
    });
    const provider: InferenceProvider = { chat: vi.fn().mockResolvedValue({ ...final("ready"), usage: mode === "no-usage" ? null : usage }) };
    const result = preflight(dataset, [], testConfig, settings, provider, fetcher);
    if (mode === "ok") await expect(result).resolves.toMatchObject({ modelDigest: digest, contextWindow: 16384 });
    else await expect(result).rejects.toThrow();
    if (["unavailable", "small-context", "http-error"].includes(mode)) expect(provider.chat).not.toHaveBeenCalled();
  });
  it("compacts large exec output while preserving normalized identifying evidence", () => {
    const content = execFixture({ id: "x", name: "exec", arguments: { command: "audit-large" } });
    const result = compactExecOutput(content, 3000);
    expect(result.content.length).toBeLessThanOrEqual(3000);
    expect(result.content.length).toBeLessThan(content.length / 3);
    const parsed = JSON.parse(result.content);
    expect(parsed.stdout).toContain("BATCH-731"); expect(parsed.stdout).toContain("success");
    expect(parsed).toMatchObject({ ok: true, exitCode: 0, originalChars: content.length, modelOutputCompacted: true });
  });
  it("preserves exec prefix/suffix even when JSON escaping expands the body", () => {
    const content = JSON.stringify({ ok: true, exitCode: 0, timedOut: false, aborted: false, truncated: false, stdout: "PREFIX" + '"'.repeat(12000) + "SUFFIX", stderr: "" });
    const result = compactExecOutput(content, 3000);
    expect(result.content.length).toBeLessThanOrEqual(3000);
    const parsed = JSON.parse(result.content);
    expect(parsed.stdout).toContain("PREFIX"); expect(parsed.stdout).toContain("SUFFIX"); expect(parsed.stdout).toContain("truncated");
  });
  it("invalidates a model change during measurement with read-only postflight", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith("/api/tags")
      ? { models: [{ name: "chat", digest: "changed" }] }
      : String(url).endsWith("/api/ps") ? { models: [{ name: "chat", digest: "original", context_length: 16384 }] } : { version: "0.17.0" })));
    await expect(verifyPreflightEvidence(testConfig, settings, { modelDigest: "original", ollamaVersion: "0.17.0", contextWindow: 16384, largestRequestEstimated: 4000 }, fetcher)).rejects.toThrow("incompatible_environment");
    expect(fetcher.mock.calls.every(([url]) => !String(url).endsWith("/api/chat"))).toBe(true);
  });
  it("removes 300+ exact adjacent overlap with net savings and preserves ranked answer sources", () => {
    const testCase = byId("rag-overlap");
    const original = ragFixture(testCase);
    const compacted = JSON.parse(compactRagOverlap(JSON.stringify(original), 4500).content);
    expect(compacted.results).toHaveLength(2);
    expect(compacted.results[0]).toEqual(original.results[0]);
    expect(compacted.results[1]).toMatchObject({ ...testCase.additionalSource, distance: 0.2 });
    expect(compacted.results[0].text).toContain(testCase.fact);
    expect(compacted.results[1].text).toContain(testCase.secondFact);
    expect(original.results[1]!.text.length - compacted.results[1].text.length).toBeGreaterThan(300);
    expect(compacted.results.reduce((sum: number, row: { text: string }) => sum + row.text.length, 0)).toBeLessThanOrEqual(4500);
    expect(compacted.omittedResults).toBe(2);
  });
  it.each(["different-document", "nonadjacent-same-page", "different-page"] as const)("does not remove overlap across %s", (kind) => {
    const overlap = "exact overlap ".repeat(40);
    const rows = [{ filename: "a", chunkIndex: 1, pageNumber: 2, text: "answer " + overlap },
      { filename: kind === "different-document" ? "b" : "a", chunkIndex: kind === "nonadjacent-same-page" ? 4 : 2, pageNumber: kind === "different-page" ? 3 : 2, text: overlap + " answer" }];
    const content = JSON.stringify({ status: "ok", results: rows });
    expect(compactRagOverlap(content)).toEqual({ content, compacted: false });
  });
  it("isolates fixture owners, histories, cases and profiles without touching runtime databases", async () => {
    const history = new MemoryHistory("a", historyFixture());
    expect(history.recent("b", 20)).toEqual([]);
    history.saveTurn("a", "private", "answer"); history.clear("a");
    expect(history.recent("a", 20)).toEqual([]);
    const fixture = new FixtureRag("a", byId("rag-txt"));
    expect(await fixture.search("b", "launch")).toMatchObject({ status: "no_match" });
    expect(await fixture.search("a", "launch")).toMatchObject({ status: "ok" });
    const seen: readonly ChatMessage[][] = [];
    const provider: InferenceProvider = { async chat(messages) { (seen as ChatMessage[][]).push([...messages]); return final("42"); } };
    await runCase(byId("direct-arithmetic"), "baseline", testConfig, settings, [], provider, storage());
    await runCase(byId("direct-arithmetic"), "optimized", testConfig, settings, [], provider, storage());
    expect(seen).toHaveLength(2); expect(seen[0]).toEqual(seen[1]);
    expect(seen[1]?.length).toBe(2);
  });
});

describe("v2 scoring, instrumentation and lifecycle", () => {
  it("normalizes date ordinals/currency without losing units or exact source locators", () => {
    expect(normalize("17th of November")).toBe(normalize("17 November"));
    expect(normalize("$38")).toBe(normalize("38 dollars"));
    expect(normalize("38 cats")).not.toBe(normalize("$38"));
    expect(citation("Source: delta.md, chunks #0 and #1", { filename: "delta.md", chunkIndex: 1 })).toBe(true);
    expect(citation("Source: delta.md, chunk #10", { filename: "delta.md", chunkIndex: 1 })).toBe(false);
    expect(citation("handbook.pdf, p. 7", { filename: "handbook.pdf", pageNumber: 7, chunkIndex: 12 })).toBe(true);
    expect(citation("Page 7 of handbook.pdf", { filename: "handbook.pdf", pageNumber: 7, chunkIndex: 12 })).toBe(true);
  });
  it.each(["17th of November", "November 17th", "seventeenth November"])("accepts the listed date alternative %s with tool and citation checks", async (date) => {
    let step = 0;
    const provider: InferenceProvider = { async chat() { return step++ === 0 ? { content: "", usage, toolCalls: [{ id: "s", name: "search_documents", arguments: { query: "Cobalt launch" } }] } : final(date + ". Source: launch.txt, chunk #0"); } };
    const result = await runCase(byId("rag-txt"), "optimized", testConfig, settings, [], provider, storage());
    expect(result.diagnostics.reasons).toEqual([]);
  });
  it.each(["success", "succeeded", "successful", "SUCCESSFULLY!"])("accepts the equivalent meaning %s", async (word) => {
    let step = 0;
    const provider: InferenceProvider = { async chat() { return step++ === 0 ? { content: "", usage, toolCalls: [{ id: "x", name: "exec", arguments: { command: "audit-large" } }] } : final("Batch-731 " + word); } };
    const result = await runCase(byId("exec-large"), "optimized", testConfig, settings, [], provider, storage());
    expect(result.diagnostics.reasons).toEqual([]);
  });
  it("reports distinct semantic/tool/source/forbidden reason codes", () => {
    const metrics: CaseMetrics = { runIds: ["opaque"], statuses: ["success"], llm: [{ turnNumber: 1, timestamp: "2026-01-01T00:00:00Z", model: "model", status: "success", usage: null, latencyMs: 1, estimatedCostUsd: 0, systemTokensEstimated: 1, toolsTokensEstimated: 1, historyTokensEstimated: 0, userTokensEstimated: 1, toolOutputTokensEstimated: 0, repeatedInputTokensEstimated: 0, newInputTokensEstimated: 3 }], tools: [], deliveries: [] };
    const result = scoreCase({ ...byId("rag-txt"), forbidden: ["launch cancelled"] }, "launch cancelled", metrics, "success", false, true, "baseline", 1600);
    expect(result.reasons).toEqual(expect.arrayContaining(["missing_authoritative_usage", "missing_required_tool", "unexpected_tool_count", "missing_required_value", "missing_source", "missing_source_metadata", "missing_citation", "forbidden_claim"]));
    expect(validCase(result)).toBe(false);
  });
  it("keeps duplicate weak-model tool calls bounded and scores them as quality failures", async () => {
    let step = 0;
    const provider: InferenceProvider = { async chat() {
      step += 1;
      if (step <= 2) return { content: "", usage, toolCalls: [{ id: `x-${step}`, name: "exec", arguments: { command: "audit-large" } }] };
      return final("BATCH-731 succeeded");
    } };
    const result = await runCase(byId("exec-large"), "baseline", testConfig, settings, [], provider, storage());
    expect(result.diagnostics).toMatchObject({ completion: "success", usageComplete: true, toolCountsExpected: false, valuesObserved: true });
    expect(result.diagnostics.reasons).toEqual(["unexpected_tool_count"]);
    expect(validCase(result.diagnostics)).toBe(true);
  });
  it("does not report missing usage for an attempt rejected before provider completion", () => {
    const metrics: CaseMetrics = { runIds: ["opaque"], statuses: ["error"], llm: [{ turnNumber: 1, timestamp: "2026-01-01T00:00:00Z", model: "model", status: "error", usage: null, latencyMs: 1, estimatedCostUsd: 0, systemTokensEstimated: 1, toolsTokensEstimated: 1, historyTokensEstimated: 0, userTokensEstimated: 1, toolOutputTokensEstimated: 0, repeatedInputTokensEstimated: 0, newInputTokensEstimated: 3 }], tools: [], deliveries: [] };
    const result = scoreCase(byId("direct-arithmetic"), "", metrics, "error", false, true, "baseline", 1600);
    expect(result.reasons).not.toContain("missing_authoritative_usage");
    expect(result.reasons).toContain("incomplete_case");
  });
  it.each(["baseline", "optimized"] as const)("verifies both sequential tool rounds, full first delivery and later receipts in %s", async (profile) => {
    const root = mkdtempSync(join(tmpdir(), "audit-sequential-")), path = join(root, "audit.sqlite");
    const audit = new SqliteAudit(path, "agent");
    const seen: ChatMessage[][] = [];
    const provider: InferenceProvider = { async chat(messages) {
      seen.push(structuredClone([...messages]));
      if (seen.length === 1) return { content: "", usage, toolCalls: [{ id: "same", name: "exec", arguments: { command: "audit-ticket" } }] };
      if (seen.length === 2) return { content: "", usage, toolCalls: [{ id: "same", name: "search_documents", arguments: { query: "TICKET-731 desk" } }] };
      return final("TICKET-731: desk 6. Source: tickets.md, chunk #0");
    } };
    try {
      const result = await runCase(byId("sequential-tools"), profile, testConfig, settings, [], provider, audit);
      expect(result.diagnostics).toMatchObject({ completion: "success", reasons: [], llmCalls: 3, toolCalls: 2, usageComplete: true, fullDelivery: true, receiptDelivery: profile === "optimized" });
      expect(seen[1]!.find((m) => m.role === "tool")!.content).toContain("Routine ticket receipt");
      const older = seen[2]!.find((m) => m.role === "tool")!;
      expect(older.content.includes("full output seen previously")).toBe(profile === "optimized");
      expect(seen[2]!.at(-1)!.content).toContain("desk");
      audit.close();
      const bytes = readFileSync(path).toString("utf8");
      for (const forbidden of ["TICKET-731", "tickets.md", "audit-ticket", "Routine ticket receipt", "desk 6"]) expect(bytes).not.toContain(forbidden);
    } finally { try { audit.close(); } catch {} rmSync(root, { recursive: true, force: true }); }
  });
  it("never discards unique old evidence just because another round occurred", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "exec", arguments: {} }] },
      { role: "tool", toolCallId: "a", content: JSON.stringify({ ok: true, stdout: "unique".repeat(100) }) },
      { role: "assistant", content: "", toolCalls: [{ id: "b", name: "exec", arguments: {} }] },
      { role: "tool", toolCallId: "b", content: JSON.stringify({ ok: true, stdout: "different" }) },
    ];
    expect(compactOldToolResults(messages)).toEqual(messages);
  });
  it("invalidates completed calls without authoritative usage", async () => {
    const provider: InferenceProvider = { async chat() { return { ...final("42"), usage: null, usageIssue: "absent_usage_fields" }; } };
    const result = await runCase(byId("direct-arithmetic"), "baseline", testConfig, settings, [], provider, storage());
    expect(result.diagnostics.reasons).toContain("missing_authoritative_usage"); expect(validCase(result.diagnostics)).toBe(false);
    expect(result.diagnostics.usageIssues).toEqual(["absent_usage_fields"]);
  });
  it("invalidates storage failures while the underlying agent still returns", async () => {
    const bad: AuditSink = { startRun() { throw new Error("secret storage exception"); }, close() {} };
    const result = await runCase(byId("direct-arithmetic"), "baseline", testConfig, settings, [], { chat: async () => final("42") }, bad);
    expect(result.diagnostics.reasons).toContain("audit_storage_error"); expect(validCase(result.diagnostics)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret storage exception");
  });
  it("aborts and settles a timed-out case before the next isolated case", async () => {
    vi.useFakeTimers();
    try {
      let pending = false;
      const provider: InferenceProvider = { chat: async (_m, _t, signal) => {
        pending = true;
        return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => { pending = false; reject(new Error("aborted")); }, { once: true }));
      } };
      const run = runCase(byId("direct-arithmetic"), "baseline", testConfig, { ...settings, caseTimeoutMs: 20 }, [], provider, storage());
      await vi.advanceTimersByTimeAsync(21);
      const result = await run;
      expect(pending).toBe(false); expect(result.diagnostics.reasons).toContain("case_timeout"); expect(validCase(result.diagnostics)).toBe(false);
      const next = await runCase(byId("direct-arithmetic"), "optimized", testConfig, settings, [], { chat: async () => final("42") }, storage());
      expect(next.diagnostics.reasons).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
