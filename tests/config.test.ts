import { describe, expect, it } from "vitest";
import { loadBotConfig, loadWorkerConfig } from "../src/config.js";

describe("configuration", () => {
  it("requires a Telegram token", () => {
    expect(() => loadBotConfig({})).toThrow("TELEGRAM_BOT_TOKEN is required");
  });

  it("uses documented worker defaults", () => {
    expect(loadWorkerConfig({})).toEqual({
      inferenceProvider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:1.7b",
      llmTimeoutMs: 60_000,
    });
  });

  it.each(["0", "-1", "1.5", "not-a-number"])(
    "rejects invalid timeout %s",
    (value) => {
      expect(() =>
        loadBotConfig({ TELEGRAM_BOT_TOKEN: "token", LLM_TIMEOUT_MS: value }),
      ).toThrow("LLM_TIMEOUT_MS must be a positive integer");
    },
  );

  it("rejects invalid Ollama URLs", () => {
    expect(() => loadWorkerConfig({ OLLAMA_BASE_URL: "not a URL" })).toThrow(
      "OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL",
    );
    expect(() => loadWorkerConfig({ OLLAMA_BASE_URL: "ftp://localhost" })).toThrow(
      "OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL",
    );
  });
});
