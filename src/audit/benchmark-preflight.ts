import type { WorkerConfig } from "../config.js";
import type { InferenceProvider, ChatMessage, ToolDefinition } from "../inference/providers/provider.js";
import { systemPrompt } from "../agent/agent.js";
import { EXEC_TOOL } from "../agent/tools/exec.js";
import { SEARCH_DOCUMENTS_TOOL } from "../agent/tools/search-documents.js";
import { estimateTokens, canonicalJson } from "./metrics.js";
import { historyFixture, execFixture, ragFixture, expectedExecCommand, DUPLICATE_EXEC_FIXTURE, DUPLICATE_SEARCH_FIXTURE, UNEXPECTED_EXEC_FIXTURE, type Dataset } from "./benchmark-cases.js";

export class BenchmarkError extends Error { constructor(public readonly code: string) { super(code); } }
export interface BenchmarkSettings {
  version: 2; options: { temperature: 0; seed: 731; num_ctx: number; num_predict: 256 };
  llmTimeoutMs: number; caseTimeoutMs: number; agentMaxSteps: number;
  historyMessages: 20; historyBudget: 1600; execMaxChars: 3000; ragModelMaxChars: 4500;
  ragTopK: 5; ragMaxContextChars: 8000; ragMaxDistance: number;
  prices: number[]; fixtureVersion: 2; contextSafetyFactor: 3;
  stream: false; think: false; execTimeoutMs: number; execCaptureBytes: 32768;
}
export function benchmarkSettings(config: WorkerConfig, env: NodeJS.ProcessEnv = process.env): BenchmarkSettings {
  const positive = (name: string, fallback: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new BenchmarkError("invalid_benchmark_limits");
    return value;
  };
  const llmTimeoutMs = positive("TOKEN_AUDIT_BENCHMARK_LLM_TIMEOUT_MS", 180_000);
  const minCase = config.agentMaxSteps * (llmTimeoutMs + 1_000) + 10_000;
  const caseTimeoutMs = positive("TOKEN_AUDIT_BENCHMARK_CASE_TIMEOUT_MS", minCase);
  if (caseTimeoutMs < minCase || caseTimeoutMs > 2_147_483_647 || llmTimeoutMs > 2_147_483_647 || config.agentMaxSteps < 3) throw new BenchmarkError("invalid_benchmark_limits");
  return {
    version: 2, options: { temperature: 0, seed: 731, num_ctx: positive("TOKEN_AUDIT_BENCHMARK_NUM_CTX", 16_384), num_predict: 256 },
    llmTimeoutMs, caseTimeoutMs, agentMaxSteps: config.agentMaxSteps,
    historyMessages: 20, historyBudget: 1600, execMaxChars: 3000, ragModelMaxChars: 4500,
    ragTopK: 5, ragMaxContextChars: 8000, ragMaxDistance: config.ragMaxDistance,
    prices: [config.tokenAuditInputUsdPer1M, config.tokenAuditCachedInputUsdPer1M, config.tokenAuditOutputUsdPer1M, config.tokenAuditReasoningUsdPer1M],
    fixtureVersion: 2, contextSafetyFactor: 3,
    stream: false, think: false, execTimeoutMs: config.execTimeoutMs, execCaptureBytes: 32768,
  };
}
export function effectiveConfig(config: WorkerConfig, settings: BenchmarkSettings): WorkerConfig {
  return { ...config, tokenAuditEnabled: true, llmTimeoutMs: settings.llmTimeoutMs, agentTimeoutMs: settings.caseTimeoutMs,
    chatHistoryMessages: settings.historyMessages, chatHistoryTokenBudget: settings.historyBudget, execModelOutputMaxChars: settings.execMaxChars,
    ragModelContextMaxChars: settings.ragModelMaxChars, ragTopK: settings.ragTopK, ragMaxContextChars: settings.ragMaxContextChars };
}
export function requestEstimate(messages: readonly ChatMessage[], tools: readonly ToolDefinition[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0) + tools.reduce((sum, tool) => sum + estimateTokens(tool), 0);
}
export function fitsContext(estimated: number, settings: BenchmarkSettings): boolean {
  return estimated * settings.contextSafetyFactor + settings.options.num_predict + 512 <= settings.options.num_ctx;
}
export function fixturePreflight(dataset: Dataset, skills: readonly string[], settings: BenchmarkSettings): number {
  if (dataset.version !== 2 || dataset.cases.length < 10 || new Set(dataset.cases.map((item) => item.id)).size !== dataset.cases.length) throw new BenchmarkError("invalid_dataset");
  let largest = 0;
  for (const testCase of dataset.cases) {
    if (!/^[a-z0-9-]{1,64}$/.test(testCase.id) || !Array.isArray(testCase.prompts) || !testCase.prompts.length || testCase.prompts.some((prompt) => typeof prompt !== "string" || !prompt.trim()) || !Array.isArray(testCase.tools) || testCase.tools.some((tool) => tool !== "exec" && tool !== "search_documents") || !Array.isArray(testCase.values) || testCase.values.some((values) => !Array.isArray(values) || !values.length || values.some((value) => typeof value !== "string" || !value.trim()))) throw new BenchmarkError("invalid_dataset");
    if (testCase.prompts.length * settings.caseTimeoutMs > 2_147_483_647) throw new BenchmarkError("invalid_benchmark_limits");
    const rag = ragFixture(testCase);
    if (rag.results.length > settings.ragTopK || rag.results.some((row) => row.distance > settings.ragMaxDistance) || rag.results.reduce((sum, row) => sum + row.text.length, 0) > settings.ragMaxContextChars) throw new BenchmarkError("fixture_initialization_failed");
    const base: ChatMessage[] = [{ role: "system", content: systemPrompt(skills) }, ...(testCase.history ? historyFixture() : [])];
    for (const prompt of testCase.prompts) base.push({ role: "user", content: prompt });
    // Model every executable tool round. Each case fixture returns its one
    // full expected result at most once; repeats/unexpected calls are bounded
    // feedback and remain observable scoring failures.
    let estimate = requestEstimate(base, [EXEC_TOOL, SEARCH_DOCUMENTS_TOOL]) + (testCase.prompts.length - 1) * settings.options.num_predict;
    const fullResults = [
      ...(testCase.exec ? [execFixture({ id: "fixture", name: "exec", arguments: { command: expectedExecCommand(testCase)! } })] : []),
      ...(testCase.source || testCase.noMatch ? [JSON.stringify(rag)] : []),
    ];
    const executedRounds = settings.agentMaxSteps - 1;
    const boundedFeedback = Math.max(estimateTokens(DUPLICATE_EXEC_FIXTURE), estimateTokens(DUPLICATE_SEARCH_FIXTURE), estimateTokens(UNEXPECTED_EXEC_FIXTURE));
    estimate += fullResults.reduce((sum, result) => sum + estimateTokens(result), 0);
    estimate += Math.max(0, executedRounds - fullResults.length) * boundedFeedback;
    estimate += executedRounds * settings.options.num_predict;
    largest = Math.max(largest, estimate);
  }
  if (!fitsContext(largest, settings)) throw new BenchmarkError("context_window_exceeded");
  if (historyFixture().reduce((sum, message) => sum + estimateTokens(message), 0) <= settings.historyBudget * 1.5) throw new BenchmarkError("insufficient_history_workload");
  return largest;
}
export interface PreflightEvidence { modelDigest: string; ollamaVersion: string; contextWindow: number; largestRequestEstimated: number }
export async function preflight(dataset: Dataset, skills: readonly string[], config: WorkerConfig, settings: BenchmarkSettings, provider: InferenceProvider, fetcher: typeof fetch = fetch): Promise<PreflightEvidence> {
  const endpoint = new URL(config.ollamaBaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new BenchmarkError("local_ollama_required");
  const largestRequestEstimated = fixturePreflight(dataset, skills, settings);
  const get = async (path: string, body?: object): Promise<Record<string, unknown>> => {
    try {
      const response = await fetcher(config.ollamaBaseUrl + path, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(settings.llmTimeoutMs) });
      if (!response.ok) throw new Error();
      return await response.json() as Record<string, unknown>;
    } catch { throw new BenchmarkError("ollama_preflight_failed"); }
  };
  const tags = await get("/api/tags");
  const names = [config.ollamaModel, config.ollamaModel.includes(":") ? config.ollamaModel : config.ollamaModel + ":latest"];
  const tag = Array.isArray(tags.models) ? tags.models.find((item) => item && names.includes(item.name)) as { digest?: string } | undefined : undefined;
  if (!tag || typeof tag.digest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/i.test(tag.digest)) throw new BenchmarkError("model_unavailable");
  const show = await get("/api/show", { model: config.ollamaModel });
  const info = show.model_info as Record<string, unknown> | undefined;
  const maxContext = Math.max(0, ...Object.entries(info ?? {}).filter(([key, value]) => key.endsWith(".context_length") && typeof value === "number").map(([, value]) => Number(value)));
  if (maxContext < settings.options.num_ctx) throw new BenchmarkError("context_window_unsupported");
  const version = await get("/api/version");
  if (typeof version.version !== "string" || !/^[0-9][0-9A-Za-z.+-]{0,63}$/.test(version.version)) throw new BenchmarkError("ollama_version_unavailable");
  const warm = await provider.chat([{ role: "user", content: "Reply with the word ready." }], [EXEC_TOOL, SEARCH_DOCUMENTS_TOOL], AbortSignal.timeout(settings.llmTimeoutMs));
  if (!warm.usage) throw new BenchmarkError("missing_authoritative_usage");
  const ps = await get("/api/ps");
  const loaded = Array.isArray(ps.models) ? ps.models.find((item) => item && (item.digest === tag.digest || names.includes(item.name))) : undefined;
  if (!loaded || loaded.context_length !== settings.options.num_ctx) throw new BenchmarkError("effective_context_unverified");
  return { modelDigest: tag.digest, ollamaVersion: version.version, contextWindow: settings.options.num_ctx, largestRequestEstimated };
}
export function compatibleSettings(before: unknown, after: unknown): boolean { return canonicalJson(before) === canonicalJson(after); }

// Read-only postflight catches a changed model/server/context during a profile.
// It does not warm the model or add measured/inference calls.
export async function verifyPreflightEvidence(config: WorkerConfig, settings: BenchmarkSettings, expected: PreflightEvidence, fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const get = async (path: string) => {
      const response = await fetcher(config.ollamaBaseUrl + path, { signal: AbortSignal.timeout(settings.llmTimeoutMs) });
      if (!response.ok) throw new Error();
      return await response.json() as Record<string, unknown>;
    };
    const tags = await get("/api/tags"), ps = await get("/api/ps"), version = await get("/api/version");
    const names = [config.ollamaModel, config.ollamaModel.includes(":") ? config.ollamaModel : config.ollamaModel + ":latest"];
    const tag = Array.isArray(tags.models) ? tags.models.find((item) => names.includes(item?.name)) : undefined;
    const loaded = Array.isArray(ps.models) ? ps.models.find((item) => item?.digest === expected.modelDigest) : undefined;
    if (tag?.digest !== expected.modelDigest || loaded?.context_length !== expected.contextWindow || version.version !== expected.ollamaVersion) throw new Error();
  } catch { throw new BenchmarkError("incompatible_environment"); }
}
