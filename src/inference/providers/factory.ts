import type { WorkerConfig } from "../../config.js";
import { OllamaProvider } from "./ollama.js";
import type { InferenceProvider } from "./provider.js";

type ProviderFactory = (config: WorkerConfig) => InferenceProvider;

const providerFactories: Readonly<Record<string, ProviderFactory>> = {
  ollama: (config) =>
    new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
    }),
};

export function createInferenceProvider(config: WorkerConfig): InferenceProvider {
  const factory = providerFactories[config.inferenceProvider];
  if (!factory) {
    throw new Error(`Unknown inference provider: ${config.inferenceProvider}`);
  }
  return factory(config);
}
