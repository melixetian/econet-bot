import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import type { SqliteHistory } from "../src/history/sqlite-history.js";
import type { InferenceProvider, ProviderResponse } from "../src/inference/providers/provider.js";
import type { RagService } from "../src/rag/service.js";
import { testConfig } from "./test-config.js";

class MemoryHistory { turns: string[][] = []; recent() { return []; } saveTurn(_conversation: string, user: string, assistant: string) { this.turns.push([user, assistant]); } clear() {} }
class SequenceProvider implements InferenceProvider { calls = 0; constructor(private readonly responses: ProviderResponse[]) {} async chat() { return this.responses[this.calls++]!; } }
class FakeRag { searches: string[][] = []; async search(userId: string, query: string) { this.searches.push([userId, query]); return { status: "no_match", results: [] }; } }

describe("Agent", () => {
  it("persists a direct final answer without a tool", async () => { const history = new MemoryHistory(); const rag = new FakeRag(); const agent = new Agent(new SequenceProvider([{ content: "answer", toolCalls: [] }]), history as unknown as SqliteHistory, ["skill"], testConfig, rag as unknown as RagService); await expect(agent.chat("chat", "user", "question", new AbortController().signal)).resolves.toBe("answer"); expect(history.turns).toEqual([["question", "answer"]]); expect(rag.searches).toEqual([]); });
  it("injects the trusted runtime user into document retrieval", async () => { const history = new MemoryHistory(); const rag = new FakeRag(); const provider = new SequenceProvider([{ content: "", toolCalls: [{ id: "search", name: "search_documents", arguments: { query: "standalone" } }] }, { content: "Not found in uploaded documents.", toolCalls: [] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService); await agent.chat("chat", "trusted-user", "What about it?", new AbortController().signal); expect(rag.searches).toEqual([["trusted-user", "standalone"]]); });
  it("rejects ownership fields in model tool arguments", async () => { const history = new MemoryHistory(); const rag = new FakeRag(); const provider = new SequenceProvider([{ content: "", toolCalls: [{ id: "search", name: "search_documents", arguments: { query: "q", userId: "other" } }] }, { content: "Could not search.", toolCalls: [] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService); await agent.chat("chat", "trusted", "q", new AbortController().signal); expect(rag.searches).toEqual([]); });
  it("does not execute calls requested in the final allowed step", async () => { const history = new MemoryHistory(); const provider = new SequenceProvider([{ content: "", toolCalls: [{ id: "x", name: "exec", arguments: { command: "not run" } }] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], { ...testConfig, agentMaxSteps: 1 }, new FakeRag() as unknown as RagService); await expect(agent.chat("chat", "user", "question", new AbortController().signal)).resolves.toBe("I couldn't complete the request within the agent step limit."); expect(history.turns[0]?.[1]).toContain("step limit"); });
});
