import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent/agent.js";
import type { SqliteHistory } from "../src/history/sqlite-history.js";
import type { InferenceProvider, ProviderResponse } from "../src/inference/providers/provider.js";
import type { ChatMessage, ToolDefinition } from "../src/inference/providers/provider.js";
import type { RagService } from "../src/rag/service.js";
import { testConfig } from "./test-config.js";

class MemoryHistory { turns: string[][] = []; recent() { return []; } saveTurn(_conversation: string, user: string, assistant: string) { this.turns.push([user, assistant]); } clear() {} }
class SequenceProvider implements InferenceProvider { calls = 0; constructor(private readonly responses: Array<Omit<ProviderResponse, "usage">>) {} async chat(): Promise<ProviderResponse> { return { ...this.responses[this.calls++]!, usage: null }; } }
class FakeRag { searches: string[][] = []; async search(userId: string, query: string) { this.searches.push([userId, query]); return { status: "no_match", results: [] }; } }

describe("Agent", () => {
  it("persists a direct final answer without a tool", async () => { const history = new MemoryHistory(); const rag = new FakeRag(); const agent = new Agent(new SequenceProvider([{ content: "answer", toolCalls: [] }]), history as unknown as SqliteHistory, ["skill"], testConfig, rag as unknown as RagService); await expect(agent.chat("chat", "user", "question", new AbortController().signal)).resolves.toBe("answer"); expect(history.turns).toEqual([["question", "answer"]]); expect(rag.searches).toEqual([]); });
  it("injects the trusted runtime user into document retrieval", async () => { const history = new MemoryHistory(); const rag = new FakeRag(); const provider = new SequenceProvider([{ content: "", toolCalls: [{ id: "search", name: "search_documents", arguments: { query: "standalone" } }] }, { content: "Not found in uploaded documents.", toolCalls: [] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService); await agent.chat("chat", "trusted-user", "What about it?", new AbortController().signal); expect(rag.searches).toEqual([["trusted-user", "standalone"]]); });
  it("rejects ownership fields in model tool arguments", async () => { const history = new MemoryHistory(); const rag = new FakeRag(); const provider = new SequenceProvider([{ content: "", toolCalls: [{ id: "search", name: "search_documents", arguments: { query: "q", userId: "other" } }] }, { content: "Could not search.", toolCalls: [] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService); await agent.chat("chat", "trusted", "q", new AbortController().signal); expect(rag.searches).toEqual([]); });
  it("does not execute calls requested in the final allowed step", async () => { const history = new MemoryHistory(); const provider = new SequenceProvider([{ content: "", toolCalls: [{ id: "x", name: "exec", arguments: { command: "not run" } }] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], { ...testConfig, agentMaxSteps: 1 }, new FakeRag() as unknown as RagService); await expect(agent.chat("chat", "user", "question", new AbortController().signal)).resolves.toBe("I couldn't complete the request within the agent step limit."); expect(history.turns[0]?.[1]).toContain("step limit"); });
  it("suppresses only an exact successful tool call repeated after its result was seen", async () => {
    const history = new MemoryHistory(); const rag = new FakeRag(); const executor = vi.fn().mockResolvedValue(JSON.stringify({ ok: true, stdout: "large result" }));
    const seen: ChatMessage[][] = []; let step = 0;
    const provider: InferenceProvider = { async chat(messages) { seen.push(structuredClone([...messages])); step += 1; return step <= 2 ? { content: "", toolCalls: [{ id: `x-${step}`, name: "exec", arguments: { command: "one" } }], usage: null } : { content: "done", toolCalls: [], usage: null }; } };
    const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService, undefined, executor);
    await expect(agent.chat("chat", "user", "question", new AbortController().signal)).resolves.toBe("done");
    expect(executor).toHaveBeenCalledTimes(1);
    expect(seen[1]!.at(-1)?.content).toContain("large result");
    expect(seen[2]!.at(-1)?.content).toContain("Duplicate successful tool call suppressed");
  });
  it("still executes identical calls requested together and retries a previous failure", async () => {
    const together = vi.fn().mockResolvedValue(JSON.stringify({ ok: true, stdout: "result" })); let togetherStep = 0;
    const togetherProvider: InferenceProvider = { async chat() { togetherStep += 1; return togetherStep === 1 ? { content: "", toolCalls: [
      { id: "a", name: "exec", arguments: { command: "same" } }, { id: "b", name: "exec", arguments: { command: "same" } },
    ], usage: null } : { content: "done", toolCalls: [], usage: null }; } };
    await new Agent(togetherProvider, new MemoryHistory() as unknown as SqliteHistory, [], testConfig, new FakeRag() as unknown as RagService, undefined, together).chat("chat", "user", "question", new AbortController().signal);
    expect(together).toHaveBeenCalledTimes(2);

    const retry = vi.fn().mockResolvedValueOnce(JSON.stringify({ ok: false, error: "failed" })).mockResolvedValueOnce(JSON.stringify({ ok: true, stdout: "recovered" })); let retryStep = 0;
    const retryProvider: InferenceProvider = { async chat() { retryStep += 1; return retryStep <= 2 ? { content: "", toolCalls: [{ id: `r-${retryStep}`, name: "exec", arguments: { command: "retry" } }], usage: null } : { content: "done", toolCalls: [], usage: null }; } };
    await new Agent(retryProvider, new MemoryHistory() as unknown as SqliteHistory, [], testConfig, new FakeRag() as unknown as RagService, undefined, retry).chat("chat", "user", "question", new AbortController().signal);
    expect(retry).toHaveBeenCalledTimes(2);
  });
  it.each([
    "The information is not available in the uploaded documents.",
    "I will check the policy. Please wait a moment.",
  ])("falls back to document search for an unverified provisional answer", async (provisional) => { const history = new MemoryHistory(); const rag = new FakeRag(); const provider = new SequenceProvider([{ content: provisional, toolCalls: [] }, { content: "Not found after search.", toolCalls: [] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService); await expect(agent.chat("chat", "trusted", "policy question", new AbortController().signal)).resolves.toBe("Not found after search."); expect(rag.searches).toEqual([["trusted", "policy question"]]); expect(history.turns).toEqual([["policy question", "Not found after search."]]); });
  it("logs process metadata without prompt or response content", async () => { const output: string[] = []; const error = vi.spyOn(console, "error").mockImplementation((line) => { output.push(String(line)); }); try { const agent = new Agent(new SequenceProvider([{ content: "private response", toolCalls: [] }]), new MemoryHistory() as unknown as SqliteHistory, [], testConfig, new FakeRag() as unknown as RagService); await agent.chat("chat", "user", "private question", new AbortController().signal); const logs = output.join("\n"); expect(logs).toContain("event=agent_started"); expect(logs).toContain("event=model_call_completed"); expect(logs).toContain("event=agent_completed"); expect(logs).not.toContain("private question"); expect(logs).not.toContain("private response"); } finally { error.mockRestore(); } });
  it("preserves the full configured stored context in baseline profile", async () => { const stored = [{ role: "user" as const, content: "old question" }, { role: "assistant" as const, content: "old answer" }]; const history = { recent: () => stored, saveTurn() {}, clear() {} }; let captured: readonly ChatMessage[] = []; const provider: InferenceProvider = { async chat(messages: readonly ChatMessage[], _tools: readonly ToolDefinition[]) { captured = messages; return { content: "answer", toolCalls: [], usage: null }; } }; await new Agent(provider, history as unknown as SqliteHistory, [], { ...testConfig, tokenAuditProfile: "baseline", chatHistoryTokenBudget: 1 }, new FakeRag() as unknown as RagService).chat("chat", "user", "current", new AbortController().signal); expect(captured.slice(1, -1)).toEqual(stored); });
});
