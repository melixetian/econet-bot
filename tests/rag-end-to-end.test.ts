import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import type { SqliteHistory } from "../src/history/sqlite-history.js";
import type { ChatMessage, InferenceProvider, ProviderResponse, ToolDefinition } from "../src/inference/providers/provider.js";
import { RagService } from "../src/rag/service.js";
import { SqliteRag } from "../src/rag/sqlite-rag.js";
import { testConfig } from "./test-config.js";

class History { turns: string[][] = []; recent() { return []; } saveTurn(_id: string, user: string, assistant: string) { this.turns.push([user, assistant]); } clear() {} }
class RetrievalProvider implements InferenceProvider {
  calls = 0;
  async chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[]): Promise<ProviderResponse> {
    expect(tools.map((tool) => tool.function.name)).toEqual(["exec", "search_documents"]);
    if (this.calls++ === 0) return { content: "", toolCalls: [{ id: "rag", name: "search_documents", arguments: { query: "launch date" } }], usage: null };
    const result = JSON.parse(messages.at(-1)!.content) as { results: Array<{ text: string; filename: string }> };
    expect(result.results[0]).toMatchObject({ filename: "launch.txt" });
    return { content: "The launch is 17 November.\n\nSource: launch.txt, chunk #0", toolCalls: [], usage: null };
  }
}

describe("mocked document-to-answer flow", () => {
  it("indexes, retrieves, and produces a source-grounded final answer", async () => { const root = mkdtempSync(join(tmpdir(), "rag-e2e-")); const file = join(root, "upload"); writeFileSync(file, "Project Cobalt launches on 17 November."); const ragIndex = new SqliteRag(join(root, "rag.sqlite"), "fake", 3); const config = { ...testConfig, documentTempDir: root, ragDbPath: join(root, "rag.sqlite"), ragMaxDistance: 0.8 }; const rag = new RagService(ragIndex, { embed: async (inputs: string[]) => inputs.map(() => [1, 0, 0]) }, config); const history = new History(); try { await rag.indexDocument("alice", "launch.txt", "txt", file); const answer = await new Agent(new RetrievalProvider(), history as unknown as SqliteHistory, [], config, rag).chat("chat", "alice", "When is launch?", new AbortController().signal); expect(answer).toContain("Source: launch.txt, chunk #0"); expect(history.turns).toEqual([["When is launch?", answer]]); } finally { rag.close(); rmSync(root, { recursive: true, force: true }); } });
});
