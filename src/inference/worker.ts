import "dotenv/config";
import { createInterface } from "node:readline";
import { Agent } from "../agent/agent.js";
import { loadSkills } from "../agent/skills.js";
import { loadWorkerConfig } from "../config.js";
import { SqliteHistory } from "../history/sqlite-history.js";
import { parseInferenceRequest, type InferenceResponse } from "./protocol.js";
import { createInferenceProvider } from "./providers/factory.js";
function writeResponse(response: InferenceResponse): void { process.stdout.write(`${JSON.stringify(response)}\n`); }
function safeErrorMessage(error: unknown): string { return error instanceof Error ? error.message : "Inference request failed"; }
try {
  const config = loadWorkerConfig(); const history = new SqliteHistory(config.chatDbPath); const agent = new Agent(createInferenceProvider(config), history, loadSkills(config.skillsDir), config); const input = createInterface({ input: process.stdin, crlfDelay: Infinity }); let queue = Promise.resolve();
  input.on("line", (line) => { const request = parseInferenceRequest(line); if (!request) { console.error("Ignored malformed inference worker request"); return; } queue = queue.then(async () => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.agentTimeoutMs); try { if (request.type === "reset") { agent.reset(request.conversationId); writeResponse({ id: request.id, ok: true }); } else writeResponse({ id: request.id, ok: true, text: await agent.chat(request.conversationId, request.prompt, controller.signal) }); } catch (error) { const message = safeErrorMessage(error); console.error(`Inference failed: ${message}`); writeResponse({ id: request.id, ok: false, error: message }); } finally { clearTimeout(timer); } }); });
  process.once("exit", () => history.close());
} catch (error) { console.error(`Inference worker configuration error: ${safeErrorMessage(error)}`); process.exitCode = 1; }
