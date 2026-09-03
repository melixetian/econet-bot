import "dotenv/config";
import { createInterface } from "node:readline";
import { loadWorkerConfig } from "../config.js";
import { parseInferenceRequest, type InferenceResponse } from "./protocol.js";
import { createInferenceProvider } from "./providers/factory.js";

function writeResponse(response: InferenceResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Inference request failed";
}

try {
  const config = loadWorkerConfig();
  const provider = createInferenceProvider(config);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  input.on("line", (line) => {
    const request = parseInferenceRequest(line);
    if (!request) {
      console.error("Ignored malformed inference worker request");
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);

    void provider
      .generate(request.prompt, controller.signal)
      .then((text) => {
        writeResponse({ id: request.id, ok: true, text });
      })
      .catch((error: unknown) => {
        const message = safeErrorMessage(error);
        console.error(`Inference failed: ${message}`);
        writeResponse({ id: request.id, ok: false, error: message });
      })
      .finally(() => clearTimeout(timer));
  });
} catch (error) {
  console.error(`Inference worker configuration error: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
}
