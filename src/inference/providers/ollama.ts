import type { ChatMessage, InferenceProvider, ProviderResponse, ToolCall, ToolDefinition } from "./provider.js";
export interface OllamaProviderOptions { baseUrl: string; model: string; timeoutMs?: number; fetch?: typeof fetch; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
export class OllamaProvider implements InferenceProvider {
  private readonly endpoint: string; private readonly model: string; private readonly timeoutMs: number; private readonly fetchImplementation: typeof fetch;
  constructor(options: OllamaProviderOptions) { this.endpoint = `${options.baseUrl}/api/chat`; this.model = options.model; this.timeoutMs = options.timeoutMs ?? 60_000; this.fetchImplementation = options.fetch ?? globalThis.fetch; }
  async chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[], signal?: AbortSignal): Promise<ProviderResponse> {
    let response: Response;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs); const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try { response = await this.fetchImplementation(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, messages, tools, stream: false, think: false }), signal: requestSignal }); }
    catch { if (signal?.aborted) throw new Error("Ollama request timed out"); throw new Error("Could not connect to Ollama"); }
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    let body: unknown; try { body = await response.json(); } catch { throw new Error("Ollama returned invalid JSON"); }
    if (!isRecord(body) || !isRecord(body.message)) throw new Error("Ollama returned an invalid response");
    const content = body.message.content; if (content !== undefined && typeof content !== "string") throw new Error("Ollama returned an invalid response");
    const rawCalls = body.message.tool_calls; if (rawCalls !== undefined && !Array.isArray(rawCalls)) throw new Error("Ollama returned an invalid response");
    const toolCalls: ToolCall[] = [];
    for (const [index, raw] of (rawCalls ?? []).entries()) { if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== "string" || !("arguments" in raw.function)) throw new Error("Ollama returned an invalid response"); toolCalls.push({ id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `tool-call-${index + 1}`, name: raw.function.name, arguments: raw.function.arguments }); }
    if ((content ?? "").length === 0 && toolCalls.length === 0) throw new Error("Ollama returned an invalid response");
    return { content: content ?? "", toolCalls };
  }
}
