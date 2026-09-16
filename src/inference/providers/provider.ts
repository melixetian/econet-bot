export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };
export interface ToolCall { id: string; name: string; arguments: unknown; }
export interface ToolDefinition { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> }; }
export interface ChatUsage { inputTokens: number; outputTokens: number; cachedTokens: number | null; reasoningTokens: number | null; providerDurationMs?: number; generationDurationMs?: number; }
export type UsageIssue = "absent_usage_fields" | "invalid_token_count" | "invalid_cached_count" | "incomplete_provider_response";
export interface ProviderResponse { content: string; toolCalls: ToolCall[]; usage: ChatUsage | null; usageIssue?: UsageIssue; }
export class ProviderTimeoutError extends Error { constructor() { super("Ollama request timed out"); } }
export interface InferenceProvider { chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[], signal?: AbortSignal): Promise<ProviderResponse>; }
