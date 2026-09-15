import type { Comparison, BenchmarkSummary } from "./comparison.js";
import { renderComparison } from "./comparison.js";

const cell = (value: unknown) => String(value ?? "N/A").replace(/[|\r\n]/g, " ");
export function renderReport(comparison: Comparison): string {
  const runs = [comparison.before, comparison.after];
  const metrics: Array<[string, (run: BenchmarkSummary) => unknown]> = [
    ["Label validity", (r) => r.valid ? "valid" : "invalid: " + r.invalidReasons.join(", ")],
    ["Success (descriptive, not a guardrail claim)", (r) => r.passedCases + "/" + r.case_count],
    ["Authoritative usage complete", (r) => r.exactUsageComplete],
    ["Input tokens", (r) => r.inputTokens], ["Output tokens", (r) => r.outputTokens],
    ["Cached subset", (r) => r.cachedTokens], ["Reasoning (separate counter)", (r) => r.reasoningTokens],
    ["Gross exact tokens", (r) => r.grossTokens], ["Hypothetical cost USD", (r) => r.cost?.toFixed(6)],
    ["LLM calls", (r) => r.llmCalls], ["Tool calls", (r) => r.toolCalls], ["LLM latency ms", (r) => r.latencyMs],
    ["Agent runs (prescribed conversation turns)", (r) => r.agentRuns],
    ["Average exact gross tokens/run", (r) => r.grossTokens !== null && r.agentRuns ? (r.grossTokens / r.agentRuns).toFixed(2) : null],
    ["Average LLM calls/run", (r) => r.agentRuns ? (r.llmCalls / r.agentRuns).toFixed(2) : null],
    ["Average tool calls/run", (r) => r.agentRuns ? (r.toolCalls / r.agentRuns).toFixed(2) : null],
    ["Average LLM latency ms/call", (r) => r.llmCalls ? (r.latencyMs / r.llmCalls).toFixed(2) : null],
    ["Provider cache hit rate", (r) => r.cachedTokens !== null && r.inputTokens ? (100 * r.cachedTokens / r.inputTokens).toFixed(2) + "%" : null],
    ["Estimated repeated input share", (r) => r.repeatedEstimated + r.newEstimated ? (100 * r.repeatedEstimated / (r.repeatedEstimated + r.newEstimated)).toFixed(2) + "%" : null],
    ["Initial model-visible tool bytes", (r) => r.toolOutputBytes],
    ["Repeated input estimated", (r) => r.repeatedEstimated], ["New input estimated", (r) => r.newEstimated],
    ...(["system", "tools", "history", "user", "toolOutput"] as const).map((name): [string, (r: BenchmarkSummary) => unknown] => ["Context " + name + " estimated", (r) => r.contextEstimated[name]]),
  ];
  const metadata = (["label", "profile", "git_revision", "model", "dataset_hash", "settings", "environment", "started_at", "completed_at"] as const).map((key) => "| " + key + " | " + runs.map((r) => cell(r[key])).join(" | ") + " |");
  const perCase = runs.flatMap((run) => run.cases.map((item) => {
    const d = item.diagnostics;
    return "| " + [run.profile, item.id, item.status, item.passed ? "PASS" : "FAIL", d.reasons?.join(", ") || (run.valid ? "none" : "legacy_or_incomplete"), d.expectedTools?.join(", "), d.observedTools?.join(", "), d.llmCalls, d.toolCalls, d.usageComplete, d.toolCountsExpected, d.valuesObserved, d.queryTermsObserved, d.sourceMetadataObserved, d.citationsObserved, d.contextCompacted, d.toolCompacted, d.fullDelivery, d.receiptDelivery, d.usageIssues?.join(", ") || "none"].map(cell).join(" | ") + " |";
  }));
  return [
    "# Econet Bot Token Audit v2", "", "Generated: " + new Date().toISOString(), "",
    "## Acceptance", "", "```text", renderComparison(comparison), "```", "",
    "Invalid or incompatible labels suppress exact totals and all reduction/guardrail calculations. Earlier invalid audits remain evidence of neither success nor regression.", "",
    "## Environment and workload", "", "| Field | Baseline | Optimized |", "| --- | --- | --- |", ...metadata, "",
    "## Metrics", "", "| Metric | Baseline | Optimized |", "| --- | ---: | ---: |",
    ...metrics.map(([label, get]) => "| " + label + " | " + runs.map((run) => cell(get(run))).join(" | ") + " |"), "",
    "Gross tokens are authoritative prompt_eval_count + eval_count with think=false; cached input is a subset, never added twice. No separate reasoning counter is exposed. Context categories, repetition and tool tokens use ceil(UTF-8 bytes/4), not the model tokenizer. Repetition is run-local and is not an Ollama cache-hit measurement. Incomplete estimates describe recorded events only.", "",
    "Cost uses the recorded USD/1M rates: uncached input × input rate + cached input × cached rate + output × output rate (+ separate reasoning if supported). Unavailable cache counters use full input at the input rate. Default local Ollama API cost is zero; non-zero prices are hypothetical, not a bill. Zero-to-zero cost reduction is N/A.", "",
    "## Per-case diagnostics", "",
    "| Profile | Case | Completion | Score | Reason codes | Expected tools | Observed tools | LLM | Tools | Usage complete | Tool counts exact | Values | Query terms | Source metadata | Citations | History compacted | Tool compacted | Initial full delivery | Later receipt | Usage issues |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...perCase, "",
    "## Hotspots", "", "| Profile | Opaque run | Turn | Exact tokens | Latency ms |", "| --- | --- | ---: | ---: | ---: |",
    ...runs.flatMap((run) => run.topTurns.map((row) => "| " + [run.profile, row.runId, row.turn, row.exactTokens, row.latencyMs].map(cell).join(" | ") + " |")), "",
    "| Profile | Tool | Initial output tokens estimated | Initial output bytes | Duration ms |", "| --- | --- | ---: | ---: | ---: |",
    ...runs.flatMap((run) => run.topTools.map((row) => "| " + [run.profile, row.name, row.outputEstimated, row.outputBytes, row.durationMs].map(cell).join(" | ") + " |")), "",
    "## Optimizations and tradeoffs", "",
    "1. History: newest complete exchanges fitting 1,600 estimated tokens; oversized exchanges are skipped, never exempted. Older relevant facts may be lost.",
    "2. Exec: approximately 3,000 model-visible JSON characters, retaining prefix/suffix, status, original sizes and compaction marker. The real executor's 32 KiB capture bound is unchanged.",
    "3. Old transient results: receipt only after an intervening LLM call saw the full initial result, and only when text evidence remains verbatim in newer results. Unique old evidence is preserved. Newest results are never receipts.",
    "4. RAG: exact overlap removal only between consecutive chunks of the same document/page when the marker is shorter; metadata and retrieval order remain unchanged.",
    "5. RAG: retain complete highest-ranked results under a 4,500-character text budget. An oversized first result is kept whole under the existing 8,000-character retrieval hard bound to avoid silently severing evidence; v2 fixtures never need this exception.",
    "6. Repeated tools: an exact later-round call is suppressed only after the model received its successful result. Corrected calls, failed-call retries and calls requested together still execute. Every request remains instrumented and unexpected counts fail case scoring.", "",
    "Baseline retains original history and tool contexts. Shared compact correctness instructions, duplicate-loop protection, native tool transport, model, deterministic options, Skills, fixtures, scoring and limits are identical. No dynamic Skill selection is used.", "",
    "## Reproducibility and privacy", "",
    "Use the paired command: both profiles share one in-memory code/dataset/bundled-Skills snapshot and an opaque random cohort. Separate single-profile runs are diagnostic only and deliberately not comparable. Fixture history and owner-scoped RAG are recreated per case/profile; full expected fixture results are single-use, with bounded feedback for later duplicates or unexpected arguments. These attempts remain instrumented quality failures. No real documents, history, shell execution, embeddings or Telegram calls are involved. Real Ollama chat calls are required for measured evidence. Preflight/warmup calls are unmeasured.",
    "No prompts, responses, commands, queries, document text, tool contents, source filenames, Telegram IDs, secrets or reusable runtime-content hashes are persisted. Source/citation/value assertions run in memory; only fixed case IDs, predefined tool names, counters, booleans and reason codes remain. The static synthetic dataset SHA-256 and provider model digest identify benchmark artifacts, not user content.", "",
    "## Limitations", "",
    "Temperature 0 and seed 731 reduce sampling variance but do not guarantee bitwise repeatability across hardware/backend versions. Context preflight conservatively reserves all permitted tool/LLM rounds and applies a per-request guard, but remains an estimate rather than a tokenizer proof. A saturated authoritative prompt invalidates the case. RAG fixtures test agent context handling, not embedding/retrieval quality; run the existing RAG evaluation separately. With 13 cases, one lost success is 7.69 percentage points. The 30% token target and 2-point guardrail require new valid compatible local Ollama output.", "",
  ].join("\n");
}
