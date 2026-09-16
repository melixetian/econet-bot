import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent/agent.js";
import type { SqliteHistory } from "../src/history/sqlite-history.js";
import { parseInferenceRequest, parseInferenceResponse } from "../src/inference/protocol.js";
import { OllamaProvider } from "../src/inference/providers/ollama.js";
import type { ChatMessage, InferenceProvider, ProviderResponse } from "../src/inference/providers/provider.js";
import type { RagService } from "../src/rag/service.js";
import { testConfig } from "./test-config.js";

class TrackingHistory {
  turns: Array<[string, string]> = [];
  recent(): [] { return []; }
  saveTurn(_conversationId: string, user: string, assistant: string): void { this.turns.push([user, assistant]); }
  clear(): void {}
}

class TrackingRag {
  searches: string[] = [];
  async search(_userId: string, query: string) { this.searches.push(query); return { status: "no_match" as const, results: [] }; }
}

const final = (content: string): ProviderResponse => ({ content, toolCalls: [], usage: null });

describe("provider and tool-call contracts", () => {
  it("accepts a valid final response and one valid call for each supported tool", async () => {
    const history = new TrackingHistory();
    const rag = new TrackingRag();
    const exec = vi.fn().mockResolvedValue(JSON.stringify({ ok: true, stdout: "fixture" }));
    const responses: ProviderResponse[] = [
      { content: "", toolCalls: [{ id: "exec-1", name: "exec", arguments: { command: "fixture-command" } }], usage: null },
      { content: "", toolCalls: [{ id: "search-1", name: "search_documents", arguments: { query: "fixture query" } }], usage: null },
      final("final answer"),
    ];
    const provider: InferenceProvider = { async chat() { return responses.shift()!; } };
    const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService, undefined, exec);
    await expect(agent.chat("conversation", "trusted", "question", new AbortController().signal)).resolves.toBe("final answer");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rag.searches).toEqual(["fixture query"]);
    expect(history.turns).toEqual([["question", "final answer"]]);
  });

  it.each([
    ["exec missing field", { id: "bad", name: "exec", arguments: {} }],
    ["exec wrong type", { id: "bad", name: "exec", arguments: { command: 7 } }],
    ["exec additional field", { id: "bad", name: "exec", arguments: { command: "x", extra: true } }],
    ["search missing field", { id: "bad", name: "search_documents", arguments: {} }],
    ["search wrong type", { id: "bad", name: "search_documents", arguments: { query: false } }],
    ["search additional field", { id: "bad", name: "search_documents", arguments: { query: "x", userId: "other" } }],
    ["unknown tool", { id: "bad", name: "unknown_tool", arguments: {} }],
  ])("keeps %s away from tools and history", async (_label, toolCall) => {
    const history = new TrackingHistory();
    const rag = new TrackingRag();
    const exec = vi.fn();
    let calls = 0;
    const seen: ChatMessage[][] = [];
    const provider: InferenceProvider = {
      async chat(messages) {
        seen.push(structuredClone([...messages]));
        calls += 1;
        if (calls === 1) return { content: "", toolCalls: [toolCall], usage: null };
        throw new Error("fixture provider stop");
      },
    };
    const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, rag as unknown as RagService, undefined, exec);
    await expect(agent.chat("conversation", "trusted", "question", new AbortController().signal)).rejects.toThrow("fixture provider stop");
    expect(exec).not.toHaveBeenCalled();
    expect(rag.searches).toEqual([]);
    expect(history.turns).toEqual([]);
    expect(seen[1]!.at(-1)).toMatchObject({ role: "tool" });
    expect(seen[1]!.at(-1)!.content).toContain("error");
  });

  it("rejects an empty final answer without persistence", async () => {
    const history = new TrackingHistory();
    const provider: InferenceProvider = { async chat() { return final(" "); } };
    const agent = new Agent(provider, history as unknown as SqliteHistory, [], testConfig, new TrackingRag() as unknown as RagService);
    await expect(agent.chat("conversation", "trusted", "question", new AbortController().signal)).rejects.toThrow("empty final answer");
    expect(history.turns).toEqual([]);
  });

  it.each([
    ["invalid JSON", "not-json", "invalid JSON"],
    ["missing message", JSON.stringify({ private_body: "must-not-leak" }), "invalid response"],
    ["wrong content type", JSON.stringify({ message: { content: 17 } }), "invalid response"],
    ["wrong tool call shape", JSON.stringify({ message: { content: "", tool_calls: [{ function: { name: "exec" } }] } }), "invalid response"],
  ])("returns a safe error for a malformed provider body: %s", async (_label, body, expected) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const provider = new OllamaProvider({ baseUrl: "http://localhost", model: "fixture", fetch: fetchMock });
    await expect(provider.chat([{ role: "user", content: "hello" }], [])).rejects.toThrow(expected);
    try { await provider.chat([{ role: "user", content: "hello" }], []); }
    catch (error) { expect(String(error)).not.toContain("private_body"); }
  });
});

describe("serialized worker contracts", () => {
  it.each([
    "not-json",
    '{"id":"x","type":"chat","conversationId":"c","userId":"u"}',
    '{"id":"x","type":"chat","conversationId":"c","userId":3,"prompt":"hello"}',
    '{"id":"x","type":"chat","conversationId":"c","userId":"u","prompt":"hello","extra":true}',
  ])("rejects malformed request JSON/schema without coercion", (line) => expect(parseInferenceRequest(line)).toBeNull());

  it("preserves response correlation IDs and rejects malformed responses", () => {
    expect(parseInferenceResponse('{"id":"request-b","ok":true,"type":"chat","text":"answer"}')).toMatchObject({ id: "request-b" });
    expect(parseInferenceResponse('{"id":"request-a","ok":true,"type":"reset"}')).toMatchObject({ id: "request-a" });
    expect(parseInferenceResponse('{"id":"request-a","ok":"true","type":"reset"}')).toBeNull();
  });
});
