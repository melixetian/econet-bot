import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";
import type { WorkerConfig } from "../src/config.js";
import type { SqliteHistory } from "../src/history/sqlite-history.js";
import type { InferenceProvider, ProviderResponse } from "../src/inference/providers/provider.js";
const config: WorkerConfig = { inferenceProvider: "ollama", ollamaBaseUrl: "http://localhost", ollamaModel: "m", llmTimeoutMs: 1_000, agentTimeoutMs: 1_000, agentMaxSteps: 2, execTimeoutMs: 1, chatHistoryMessages: 20, chatDbPath: "/tmp/unused.sqlite", skillsDir: "/tmp", agentWorkspaceDir: "/tmp" };
class MemoryHistory { turns: string[][] = []; recent() { return []; } saveTurn(_conversation: string, user: string, assistant: string) { this.turns.push([user, assistant]); } clear() {} }
class SequenceProvider implements InferenceProvider { calls = 0; constructor(private readonly responses: ProviderResponse[]) {} async chat() { return this.responses[this.calls++]!; } }
describe("Agent", () => {
  it("persists a direct final answer without a tool", async () => { const history = new MemoryHistory(); const agent = new Agent(new SequenceProvider([{ content: "answer", toolCalls: [] }]), history as unknown as SqliteHistory, ["skill"], config); await expect(agent.chat("chat", "question", new AbortController().signal)).resolves.toBe("answer"); expect(history.turns).toEqual([["question", "answer"]]); });
  it("does not execute calls requested in the final allowed step", async () => { const history = new MemoryHistory(); const provider = new SequenceProvider([{ content: "", toolCalls: [{ id: "x", name: "exec", arguments: { command: "not run" } }] }]); const agent = new Agent(provider, history as unknown as SqliteHistory, [], { ...config, agentMaxSteps: 1 }); await expect(agent.chat("chat", "question", new AbortController().signal)).resolves.toBe("I couldn't complete the request within the agent step limit."); expect(history.turns[0]?.[1]).toContain("step limit"); });
});
