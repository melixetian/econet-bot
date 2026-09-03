export interface BotConfig {
  telegramBotToken: string;
  llmTimeoutMs: number;
}

export interface WorkerConfig {
  inferenceProvider: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  llmTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function readTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error("LLM_TIMEOUT_MS must be a positive integer");
  }
  return timeout;
}

function readHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL");
  }

  return url.toString().replace(/\/$/, "");
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }

  return {
    telegramBotToken,
    llmTimeoutMs: readTimeout(env.LLM_TIMEOUT_MS),
  };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const inferenceProvider = env.INFERENCE_PROVIDER?.trim() || "ollama";
  const ollamaModel = env.OLLAMA_MODEL?.trim() || "qwen3:1.7b";

  return {
    inferenceProvider,
    ollamaBaseUrl: readHttpUrl(
      env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    ),
    ollamaModel,
    llmTimeoutMs: readTimeout(env.LLM_TIMEOUT_MS),
  };
}
