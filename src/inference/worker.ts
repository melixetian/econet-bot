import "dotenv/config";
import { createInterface } from "node:readline";
import { Agent } from "../agent/agent.js";
import { loadSkills } from "../agent/skills.js";
import { loadWorkerConfig } from "../config.js";
import { SqliteHistory } from "../history/sqlite-history.js";
import { DocumentError } from "../rag/extractors.js";
import { OllamaEmbeddingClient } from "../rag/ollama-embeddings.js";
import { RagService } from "../rag/service.js";
import { SqliteRag } from "../rag/sqlite-rag.js";
import { parseInferenceRequest, type InferenceRequest, type InferenceResponse } from "./protocol.js";
import { createInferenceProvider } from "./providers/factory.js";
import { logEvent } from "../logging.js";

function writeResponse(response: InferenceResponse): void { process.stdout.write(`${JSON.stringify(response)}\n`); }
function failure(request: InferenceRequest, error: unknown): InferenceResponse { if (error instanceof DocumentError) return { id: request.id, ok: false, error: error.message, code: error.code }; return { id: request.id, ok: false, error: request.type === "chat" ? "Inference request failed." : "Document operation failed.", code: request.type === "chat" ? "inference_failed" : "document_operation_failed" }; }

try {
  const config = loadWorkerConfig();
  const history = new SqliteHistory(config.chatDbPath);
  const rag = new RagService(new SqliteRag(config.ragDbPath, config.ollamaEmbeddingModel, config.ragEmbeddingDimension), new OllamaEmbeddingClient({ baseUrl: config.ollamaBaseUrl, model: config.ollamaEmbeddingModel, dimension: config.ragEmbeddingDimension, timeoutMs: config.embeddingTimeoutMs }), config);
  const agent = new Agent(createInferenceProvider(config), history, loadSkills(config.skillsDir), config, rag);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  input.on("line", (line) => {
    const request = parseInferenceRequest(line);
    if (!request) { console.error("Ignored malformed inference worker request"); return; }
    queue = queue.then(async () => {
      const started = Date.now();
      logEvent("worker", "request_started", { request_id: request.id, request_type: request.type });
      const controller = new AbortController(); const timeoutMs = request.type === "chat" || request.type === "reset" ? config.agentTimeoutMs : config.documentTimeoutMs; const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        if (request.type === "chat") writeResponse({ id: request.id, ok: true, type: "chat", text: await agent.chat(request.conversationId, request.userId, request.prompt, controller.signal) });
        else if (request.type === "reset") { agent.reset(request.conversationId); writeResponse({ id: request.id, ok: true, type: "reset" }); }
        else if (request.type === "index_document") writeResponse({ id: request.id, ok: true, type: "index_document", document: await rag.indexDocument(request.userId, request.filename, request.fileType, request.tempPath, controller.signal) });
        else if (request.type === "list_documents") writeResponse({ id: request.id, ok: true, type: "list_documents", documents: rag.listDocuments(request.userId) });
        else { if (!rag.deleteDocument(request.userId, request.filename)) throw new DocumentError("Document not found.", "document_not_found"); writeResponse({ id: request.id, ok: true, type: "delete_document", deleted: true }); }
        logEvent("worker", "request_completed", { request_id: request.id, request_type: request.type, duration_ms: Date.now() - started });
      } catch (error) { const response = failure(request, error); console.error(`Worker request failed: code=${response.ok ? "unknown" : response.code}`); writeResponse(response); }
      finally { clearTimeout(timer); }
    });
  });
  process.once("exit", () => { history.close(); rag.close(); });
} catch { console.error("Inference worker configuration error"); process.exitCode = 1; }
