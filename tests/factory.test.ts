import { describe, expect, it } from "vitest";
import type { WorkerConfig } from "../src/config.js";
import { createInferenceProvider } from "../src/inference/providers/factory.js";
import { OllamaProvider } from "../src/inference/providers/ollama.js";

const baseConfig: WorkerConfig = {
  inferenceProvider: "ollama",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "model",
  llmTimeoutMs: 1000,
};

describe("createInferenceProvider", () => {
  it("selects Ollama", () => {
    expect(createInferenceProvider(baseConfig)).toBeInstanceOf(OllamaProvider);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      createInferenceProvider({ ...baseConfig, inferenceProvider: "unknown" }),
    ).toThrow("Unknown inference provider: unknown");
  });
});
