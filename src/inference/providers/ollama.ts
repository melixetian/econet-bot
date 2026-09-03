import type { InferenceProvider } from "./provider.js";

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}

export class OllamaProvider implements InferenceProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OllamaProviderOptions) {
    this.endpoint = `${options.baseUrl}/api/generate`;
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  async generate(prompt: string, signal?: AbortSignal): Promise<string> {
    let response: Response;
    try {
      const request: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          think: false,
        }),
      };
      if (signal) {
        request.signal = signal;
      }
      response = await this.fetchImplementation(this.endpoint, request);
    } catch (error) {
      if (signal?.aborted) {
        throw new Error("Ollama request timed out");
      }
      throw new Error("Could not connect to Ollama");
    }

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("Ollama returned invalid JSON");
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("response" in body) ||
      typeof body.response !== "string" ||
      body.response.length === 0
    ) {
      throw new Error("Ollama returned an invalid response");
    }

    return body.response;
  }
}
