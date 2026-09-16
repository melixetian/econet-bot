import type { ToolCall, ToolDefinition } from "../../inference/providers/provider.js";
import type { RagService } from "../../rag/service.js";

export const SEARCH_DOCUMENTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_documents",
    description: "Search the current user's uploaded documents for information needed to answer the request.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string", description: "A concise standalone semantic query. Include relevant conversation context; do not send a pronoun-only follow-up." } },
    },
  },
};

export function validateSearchDocumentsToolCall(call: ToolCall): string | null {
  if (call.name !== "search_documents") return "Unknown tool";
  if (typeof call.arguments !== "object" || call.arguments === null || Array.isArray(call.arguments) || Object.keys(call.arguments).length !== 1 || typeof (call.arguments as Record<string, unknown>).query !== "string") return "search_documents requires exactly one query string";
  return (call.arguments as Record<string, string>).query.trim().length === 0 ? "search_documents requires a non-empty query string" : null;
}

export async function executeSearchDocuments(call: ToolCall, userId: string, rag: RagService, signal?: AbortSignal): Promise<string> {
  const validationError = validateSearchDocumentsToolCall(call);
  if (validationError) return JSON.stringify({ status: "error", error: validationError });
  try { return JSON.stringify(await rag.search(userId, (call.arguments as { query: string }).query.trim(), signal)); }
  catch { return JSON.stringify({ status: "error", error: "Document search failed" }); }
}
