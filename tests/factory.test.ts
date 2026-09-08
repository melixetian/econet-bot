import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../src/config.js";
import { createInferenceProvider } from "../src/inference/providers/factory.js";
import { OllamaProvider } from "../src/inference/providers/ollama.js";
describe("factory", () => { it("selects Ollama", () => expect(createInferenceProvider(loadWorkerConfig({}))).toBeInstanceOf(OllamaProvider)); });
