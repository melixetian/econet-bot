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

export async function executeSearchDocuments(call: ToolCall, userId: string, rag: RagService, signal?: AbortSignal): Promise<string> {
  if (call.name !== "search_documents") return JSON.stringify({ status: "error", error: "Unknown tool" });
  if (typeof call.arguments !== "object" || call.arguments === null || Array.isArray(call.arguments) || Object.keys(call.arguments).length !== 1 || typeof (call.arguments as Record<string, unknown>).query !== "string") return JSON.stringify({ status: "error", error: "search_documents requires exactly one query string" });
  try { return JSON.stringify(await rag.search(userId, (call.arguments as { query: string }).query, signal)); }
  catch { return JSON.stringify({ status: "error", error: "Document search failed" }); }
}
