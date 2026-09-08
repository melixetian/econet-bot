export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };
export interface ToolCall { id: string; name: string; arguments: unknown; }
export interface ToolDefinition { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> }; }
export interface ProviderResponse { content: string; toolCalls: ToolCall[]; }
export interface InferenceProvider { chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[], signal?: AbortSignal): Promise<ProviderResponse>; }
