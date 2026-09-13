import type { EmbeddingClient } from "./types.js";

export interface OllamaEmbeddingOptions { baseUrl: string; model: string; dimension: number; timeoutMs: number; fetch?: typeof fetch }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

export class OllamaEmbeddingClient implements EmbeddingClient {
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;
  constructor(private readonly options: OllamaEmbeddingOptions) { this.endpoint = `${options.baseUrl}/api/embed`; this.fetchImplementation = options.fetch ?? globalThis.fetch; }
  async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    if (inputs.length === 0 || inputs.some((input) => typeof input !== "string" || input.length === 0)) throw new Error("Embedding inputs are invalid");
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try { response = await this.fetchImplementation(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: this.options.model, input: inputs }), signal: requestSignal }); }
    catch { throw new Error(requestSignal.aborted ? "Embedding request timed out" : "Could not connect to Ollama embeddings"); }
    if (!response.ok) throw new Error(`Ollama embeddings returned HTTP ${response.status}`);
    let body: unknown; try { body = await response.json(); } catch { throw new Error("Ollama embeddings returned invalid JSON"); }
    if (!isRecord(body) || !Array.isArray(body.embeddings) || body.embeddings.length !== inputs.length) throw new Error("Ollama embeddings returned an invalid response");
    const embeddings: number[][] = [];
    for (const embedding of body.embeddings) {
      if (!Array.isArray(embedding) || embedding.length !== this.options.dimension || embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Ollama embeddings returned an invalid vector");
      embeddings.push(embedding as number[]);
    }
    return embeddings;
  }
}
