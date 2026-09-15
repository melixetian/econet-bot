import Database from "better-sqlite3";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareBenchmarks, renderComparison } from "../src/audit/comparison.js";
import { renderReport } from "../src/audit/report.js";
import { SqliteAudit } from "../src/audit/sqlite-audit.js";
import { BenchmarkStore, evidenceDirectory, evidenceLog, utcEvidenceId } from "../src/audit/benchmark-store.js";
import type { CaseDiagnostics } from "../src/audit/benchmark-cases.js";

const diagnostics: CaseDiagnostics = { completion: "success", reasons: [], expectedTools: [], observedTools: [], llmCalls: 1, toolCalls: 0, usageComplete: true, contextCompacted: false, toolCompacted: false, fullDelivery: false, receiptDelivery: false, usageIssues: [], toolCountsExpected: true, valuesObserved: true, queryTermsObserved: true, sourceMetadataObserved: true, citationsObserved: true };
function setup() {
  const root = mkdtempSync(join(tmpdir(), "audit-compare-")), path = join(root, "audit.sqlite");
  const storage = new SqliteAudit(path, "agent"), store = new BenchmarkStore(path);
  function record(label: string, profile: "baseline" | "optimized", input: number | null, diag = diagnostics) {
    const run = storage.startRun("opaque", profile);
    run.recordLlm({ turnNumber: 1, timestamp: "2026-01-01T00:00:00Z", model: "model", status: "success", usage: input === null ? null : { inputTokens: input, outputTokens: 0, cachedTokens: null, reasoningTokens: null }, latencyMs: 10, estimatedCostUsd: 0, systemTokensEstimated: 10, toolsTokensEstimated: 5, historyTokensEstimated: 0, userTokensEstimated: 2, toolOutputTokensEstimated: 0, repeatedInputTokensEstimated: 0, newInputTokensEstimated: 17 });
    run.finish(diag.completion === "success" ? "success" : "error");
    const id = store.begin({ label, profile, datasetHash: "synthetic-dataset", model: "model", settings: "settings", environment: "same-cohort", gitRevision: "revision", caseCount: 1 }, false);
    store.saveCase(id, "case", diag, 1, [run.runId]);
    store.finish(id, diag.completion !== "success" || !diag.usageComplete ? diag.reasons : []);
    return id;
  }
  return { root, path, store, storage, record, close() { store.close(); storage.close(); rmSync(root, { recursive: true, force: true }); } };
}
describe("benchmark validity and evidence", () => {
  it("calculates acceptance only for complete compatible exact evidence", () => {
    const state = setup();
    try {
      state.record("before", "baseline", 100); state.record("after", "optimized", 60);
      const result = compareBenchmarks(state.path, "before", "after");
      expect(result).toMatchObject({ accepted: true, tokenReductionPercent: 40, successRateDropPp: 0, costReductionPercent: null });
      expect(renderComparison(result)).toContain("Acceptance: PASS");
      expect(renderReport(result)).toContain("Per-case diagnostics");
    } finally { state.close(); }
  });
  it.each(["timeout", "missing-usage", "incomplete-link", "legacy"] as const)("never compares partial %s totals", (mode) => {
    const state = setup();
    try {
      state.record("before", "baseline", 100);
      const diag: CaseDiagnostics = mode === "timeout" ? { ...diagnostics, completion: "timeout", reasons: ["case_timeout"] } : mode === "missing-usage" ? { ...diagnostics, usageComplete: false, reasons: ["missing_authoritative_usage"] } : diagnostics;
      const id = state.record("after", "optimized", mode === "missing-usage" ? null : 10, diag);
      if (mode === "incomplete-link") state.store.db.prepare("DELETE FROM benchmark_case_runs WHERE benchmark_id=?").run(id);
      if (mode === "legacy") state.store.db.prepare("UPDATE benchmark_runs SET format_version=1 WHERE id=?").run(id);
      const result = compareBenchmarks(state.path, "before", "after");
      expect(result).toMatchObject({ compatible: false, accepted: false, tokenReductionPercent: null, successRateDropPp: null, costReductionPercent: null });
      expect(result.before.grossTokens).toBeNull(); expect(result.after.grossTokens).toBeNull();
      expect(renderComparison(result)).toContain("Gross exact tokens: N/A -> N/A");
      expect(renderReport(result)).not.toContain("40.00%");
    } finally { state.close(); }
  });
  it("keeps completed scoring failures in the quality denominator", () => {
    const state = setup();
    try {
      state.record("before", "baseline", 100);
      state.record("after", "optimized", 60, { ...diagnostics, reasons: ["missing_required_value"] });
      const result = compareBenchmarks(state.path, "before", "after");
      expect(result).toMatchObject({ compatible: true, accepted: false, tokenReductionPercent: 40, successRateDropPp: 100 });
      expect(result.reasons).toContain("quality_guardrail_not_met");
    } finally { state.close(); }
  });
  it("invalidates a failed provider attempt without mislabelling it as missing successful-call usage", () => {
    const state = setup();
    try {
      state.record("before", "baseline", 100); const id = state.record("after", "optimized", 60);
      state.store.db.prepare("UPDATE llm_calls SET status='error', input_tokens=NULL, output_tokens=NULL WHERE run_id=(SELECT audit_run_id FROM benchmark_case_runs WHERE benchmark_id=? LIMIT 1)").run(id);
      const result = compareBenchmarks(state.path, "before", "after");
      expect(result).toMatchObject({ compatible: false, tokenReductionPercent: null, accepted: false });
      expect(result.reasons).toContain("incomplete_case");
      expect(result.reasons).not.toContain("missing_authoritative_usage");
    } finally { state.close(); }
  });
  it.each(["model", "settings", "dataset_hash", "case_count", "environment", "git_revision"] as const)("refuses incompatible %s", (key) => {
    const state = setup();
    try {
      state.record("before", "baseline", 100); const id = state.record("after", "optimized", 10);
      state.store.db.prepare("UPDATE benchmark_runs SET " + key + "=? WHERE id=?").run(key === "case_count" ? 2 : "different", id);
      expect(compareBenchmarks(state.path, "before", "after")).toMatchObject({ compatible: false, tokenReductionPercent: null, accepted: false });
    } finally { state.close(); }
  });
  it("returns a safe missing-result failure rather than partial arithmetic", () => {
    const state = setup();
    try { state.record("before", "baseline", 100); const result = compareBenchmarks(state.path, "before", "missing"); expect(result.reasons).toContain("missing_benchmark_result"); expect(result.tokenReductionPercent).toBeNull(); } finally { state.close(); }
  });
  it("protects labels and archives explicit overwrite without deleting prior audit data", () => {
    const state = setup();
    try {
      state.record("before", "baseline", 100);
      expect(() => state.store.checkLabels(["before"], false)).toThrow("duplicate_label");
      expect(() => state.store.checkLabels(["same", "same"], true)).toThrow();
      state.store.begin({ label: "before", profile: "baseline", datasetHash: "hash", model: "model", settings: "s", environment: "e", gitRevision: "r", caseCount: 1 }, true);
      expect(state.store.db.prepare("SELECT COUNT(*) n FROM agent_runs").get()).toEqual({ n: 1 });
      expect(state.store.db.prepare("SELECT COUNT(*) n FROM benchmark_runs").get()).toEqual({ n: 2 });
      expect(state.store.db.prepare("SELECT COUNT(*) n FROM benchmark_case_runs").get()).toEqual({ n: 1 });
      expect(compareBenchmarks(state.path, "before", "missing").before.invalidReasons).toContain("invalid_or_incomplete_label");
    } finally { state.close(); }
  });
  it("creates distinct execution/comparison files with exclusive creation", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-evidence-"));
    try {
      const a = evidenceLog(root, "baseline", "before"), b = evidenceLog(root, "baseline", "before"), c = evidenceLog(root, "comparison", "before");
      a.write("valid"); b.write("invalid"); c.write("N/A"); a.close(); b.close(); c.close();
      expect(new Set([a.path, b.path, c.path]).size).toBe(3);
      expect(readdirSync(root)).toHaveLength(3);
      expect(readFileSync(a.path, "utf8")).toBe("valid\n");
      expect(() => evidenceLog(root, "baseline", "../unsafe")).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("creates safe timestamp-named evidence directories", () => {
    const root = join(tmpdir(), "audit-root");
    expect(utcEvidenceId(new Date("2026-09-15T18:37:46.123Z"))).toBe("20260915T183746Z");
    expect(evidenceDirectory(root, "20260915T183746Z")).toBe(join(root, "reports", "audit-20260915T183746Z"));
    expect(() => evidenceDirectory(root, "../unsafe")).toThrow("invalid_selector");
  });
});
