import { describe, expect, it, vi } from "vitest";
import { EXEC_TOOL } from "../src/agent/tools/exec.js";
import { OllamaProvider, parseOllamaUsage, ollamaMessages, ollamaUsageIssue } from "../src/inference/providers/ollama.js";
describe("OllamaProvider", () => { it("posts chat messages and tools", async () => { const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 })); const provider = new OllamaProvider({ baseUrl: "http://localhost", model: "m", fetch: fetchMock }); await expect(provider.chat([{ role: "user", content: "hi" }], [EXEC_TOOL])).resolves.toEqual({ content: "ok", toolCalls: [], usage: null, usageIssue: "absent_usage_fields" }); expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/chat", expect.objectContaining({ body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }], tools: [EXEC_TOOL], stream: false, think: false }) })); }); });

describe("Ollama usage", () => {
  it.each([
    [{}, "absent_usage_fields"],
    [{ done: false, prompt_eval_count: 2, eval_count: 1 }, "incomplete_provider_response"],
    [{ prompt_eval_count: "2", eval_count: 1 }, "invalid_token_count"],
    [{ prompt_eval_count: 2, eval_count: 1, prompt_eval_cached_count: -1 }, "invalid_cached_count"],
  ] as const)("classifies missing/invalid usage without storing bodies", (body, code) => expect(ollamaUsageIssue(body)).toBe(code));
  it("sends provider-native tool history with no audit/internal protocol fields", () => {
    expect(ollamaMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "exec", arguments: { command: "fixture" } }] },
      { role: "tool", toolCallId: "a", content: "result" },
    ])).toEqual([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "exec", arguments: { command: "fixture" } } }] },
      { role: "tool", tool_name: "exec", content: "result" },
    ]);
  });
  it("records authoritative usage for a completed large tool response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ done: true, message: { content: "succeeded" }, prompt_eval_count: 3100, eval_count: 12 })));
    const provider = new OllamaProvider({ baseUrl: "http://localhost", model: "m", fetch: fetchMock, chatOptions: { temperature: 0, seed: 731, num_ctx: 16384 } });
    const result = await provider.chat([{ role: "tool", toolCallId: "x", content: "X".repeat(12000) }], []);
    expect(result.usage).toMatchObject({ inputTokens: 3100, outputTokens: 12 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)).options).toEqual({ temperature: 0, seed: 731, num_ctx: 16384 });
  });
  it("captures exact input, output, optional cached tokens, and provider duration", () => expect(parseOllamaUsage({ prompt_eval_count: 100, eval_count: 25, prompt_eval_cached_count: 40, total_duration: 12_400_000 })).toEqual({ inputTokens: 100, outputTokens: 25, cachedTokens: 40, reasoningTokens: null, providerDurationMs: 12 }));
  it("keeps cached and reasoning usage unavailable when Ollama omits them", () => expect(parseOllamaUsage({ prompt_eval_count: 10, eval_count: 2 })).toEqual({ inputTokens: 10, outputTokens: 2, cachedTokens: null, reasoningTokens: null }));
  it.each([{ prompt_eval_count: -1, eval_count: 2 }, { prompt_eval_count: 1.5, eval_count: 2 }, { prompt_eval_count: 2, eval_count: 1, prompt_eval_cached_count: 3 }])("rejects malformed or inconsistent token usage", (body) => expect(parseOllamaUsage(body)).toBeNull());
});
