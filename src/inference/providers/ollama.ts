import type { ChatMessage, InferenceProvider, ProviderResponse, ToolCall, ToolDefinition } from "./provider.js";
import { logEvent } from "../../logging.js";
import { ProviderTimeoutError, type UsageIssue } from "./provider.js";
export interface OllamaProviderOptions { baseUrl: string; model: string; timeoutMs?: number; fetch?: typeof fetch; chatOptions?: Readonly<Record<string, number | string | boolean>>; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function nonNegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function durationMilliseconds(value: unknown): number | undefined {
  if (!nonNegativeInteger(value)) return undefined;
  return Math.round(value / 1_000_000);
}
export function ollamaUsageIssue(body: Record<string, unknown>): UsageIssue | undefined {
  if (body.done === false) return "incomplete_provider_response";
  if (body.prompt_eval_count === undefined && body.eval_count === undefined) return "absent_usage_fields";
  if (!nonNegativeInteger(body.prompt_eval_count) || !nonNegativeInteger(body.eval_count)) return "invalid_token_count";
  if (body.prompt_eval_cached_count !== undefined && (!nonNegativeInteger(body.prompt_eval_cached_count) || body.prompt_eval_cached_count > body.prompt_eval_count)) return "invalid_cached_count";
  return undefined;
}
export function parseOllamaUsage(body: Record<string, unknown>): ProviderResponse["usage"] {
  const issue = ollamaUsageIssue(body);
  if (issue) { logEvent("worker", "audit_usage_invalid", { category: issue }); return null; }
  const input = body.prompt_eval_count;
  const output = body.eval_count;
  const cached = body.prompt_eval_cached_count;
  if (input === undefined && output === undefined && cached === undefined) return null;
  if (!nonNegativeInteger(input) || !nonNegativeInteger(output)) { logEvent("worker", "audit_usage_invalid", { category: "invalid_token_count" }); return null; }
  if (cached !== undefined && (!nonNegativeInteger(cached) || cached > input)) { logEvent("worker", "audit_usage_invalid", { category: "invalid_cached_count" }); return null; }
  const providerDurationMs = durationMilliseconds(body.total_duration);
  const generationDurationMs = durationMilliseconds(body.eval_duration);
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens: cached === undefined ? null : cached,
    reasoningTokens: null,
    ...(providerDurationMs === undefined ? {} : { providerDurationMs }),
    ...(generationDurationMs === undefined ? {} : { generationDurationMs }),
  };
}
// Translate the provider-neutral contract only at the transport boundary.
export function ollamaMessages(messages: readonly ChatMessage[]): unknown[] {
  const names = new Map<string, string>();
  return messages.map((message) => {
    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const call of message.toolCalls) names.set(call.id, call.name);
      return { role: message.role, content: message.content, tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.arguments } })) };
    }
    if (message.role === "tool") return { role: "tool", content: message.content, ...(names.has(message.toolCallId) ? { tool_name: names.get(message.toolCallId) } : {}) };
    return { role: message.role, content: message.content };
  });
}
export class OllamaProvider implements InferenceProvider {
  private readonly endpoint: string; private readonly model: string; private readonly timeoutMs: number; private readonly fetchImplementation: typeof fetch; private readonly chatOptions: Readonly<Record<string, number | string | boolean>> | undefined;
  constructor(options: OllamaProviderOptions) { this.endpoint = `${options.baseUrl}/api/chat`; this.model = options.model; this.timeoutMs = options.timeoutMs ?? 60_000; this.fetchImplementation = options.fetch ?? globalThis.fetch; this.chatOptions = options.chatOptions; }
  async chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[], signal?: AbortSignal): Promise<ProviderResponse> {
    let response: Response;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs); const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try { response = await this.fetchImplementation(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, messages: ollamaMessages(messages), tools, stream: false, think: false, ...(this.chatOptions ? { options: this.chatOptions } : {}) }), signal: requestSignal }); }
    catch { if (requestSignal.aborted) throw new ProviderTimeoutError(); throw new Error("Could not connect to Ollama"); }
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    let body: unknown; try { body = await response.json(); } catch { if (requestSignal.aborted) throw new ProviderTimeoutError(); throw new Error("Ollama returned invalid JSON"); }
    if (requestSignal.aborted) throw new ProviderTimeoutError();
    if (!isRecord(body) || !isRecord(body.message)) throw new Error("Ollama returned an invalid response");
    const content = body.message.content; if (content !== undefined && typeof content !== "string") throw new Error("Ollama returned an invalid response");
    const rawCalls = body.message.tool_calls; if (rawCalls !== undefined && !Array.isArray(rawCalls)) throw new Error("Ollama returned an invalid response");
    const toolCalls: ToolCall[] = [];
    for (const [index, raw] of (rawCalls ?? []).entries()) { if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== "string" || !("arguments" in raw.function)) throw new Error("Ollama returned an invalid response"); toolCalls.push({ id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `tool-call-${index + 1}`, name: raw.function.name, arguments: raw.function.arguments }); }
    if ((content ?? "").length === 0 && toolCalls.length === 0) throw new Error("Ollama returned an invalid response");
    const usageIssue = ollamaUsageIssue(body);
    return { content: content ?? "", toolCalls, usage: parseOllamaUsage(body), ...(usageIssue ? { usageIssue } : {}) };
  }
}
