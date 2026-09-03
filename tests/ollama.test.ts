import { describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "../src/inference/providers/ollama.js";

describe("OllamaProvider", () => {
  it("sends exactly one prompt with streaming and thinking disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ response: "model answer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:1.7b",
      fetch: fetchMock,
    });

    await expect(provider.generate("current message only")).resolves.toBe(
      "model answer",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3:1.7b",
          prompt: "current message only",
          stream: false,
          think: false,
        }),
      }),
    );
  });

  it.each([
    ["connection failure", vi.fn<typeof fetch>().mockRejectedValue(new Error("down"))],
    [
      "non-2xx response",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("failure", { status: 500 })),
    ],
    [
      "invalid JSON",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 200 })),
    ],
    [
      "missing response field",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ done: true }), { status: 200 }),
      ),
    ],
    [
      "empty response",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ response: "" }), { status: 200 }),
      ),
    ],
  ])("rejects a %s", async (_name, fetchMock) => {
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "model",
      fetch: fetchMock,
    });

    await expect(provider.generate("prompt")).rejects.toBeInstanceOf(Error);
  });

  it("reports an aborted request as a timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("aborted"));
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "model",
      fetch: fetchMock,
    });

    await expect(provider.generate("prompt", controller.signal)).rejects.toThrow(
      "Ollama request timed out",
    );
  });
});
