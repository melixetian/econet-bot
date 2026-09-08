import { resolve } from "node:path";

export interface BotConfig {
  telegramBotToken: string;
  allowedTelegramUserIds: ReadonlySet<string>;
  agentTimeoutMs: number;
}

export interface WorkerConfig {
  inferenceProvider: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  llmTimeoutMs: number;
  agentTimeoutMs: number;
  agentMaxSteps: number;
  execTimeoutMs: number;
  chatHistoryMessages: number;
  chatDbPath: string;
  skillsDir: string;
  agentWorkspaceDir: string;
}

function readPositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function readHttpUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL");
  return url.toString().replace(/\/$/, "");
}

function readAllowlist(value: string | undefined): ReadonlySet<string> {
  if (!value) throw new Error("ALLOWED_TELEGRAM_USER_IDS is required");
  const ids = value.split(",").map((id) => id.trim());
  if (ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) throw new Error("ALLOWED_TELEGRAM_USER_IDS must contain comma-separated decimal user IDs");
  return new Set(ids);
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is required");
  return { telegramBotToken, allowedTelegramUserIds: readAllowlist(env.ALLOWED_TELEGRAM_USER_IDS), agentTimeoutMs: readPositiveInteger("AGENT_TIMEOUT_MS", env.AGENT_TIMEOUT_MS, 300_000) };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const agentMaxSteps = readPositiveInteger("AGENT_MAX_STEPS", env.AGENT_MAX_STEPS, 5);
  if (agentMaxSteps > 10) throw new Error("AGENT_MAX_STEPS must be an integer from 1 to 10");
  return {
    inferenceProvider: env.INFERENCE_PROVIDER?.trim() || "ollama",
    ollamaBaseUrl: readHttpUrl(env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"),
    ollamaModel: env.OLLAMA_MODEL?.trim() || "qwen3:1.7b",
    llmTimeoutMs: readPositiveInteger("LLM_TIMEOUT_MS", env.LLM_TIMEOUT_MS, 60_000),
    agentTimeoutMs: readPositiveInteger("AGENT_TIMEOUT_MS", env.AGENT_TIMEOUT_MS, 300_000),
    agentMaxSteps,
    execTimeoutMs: readPositiveInteger("EXEC_TIMEOUT_MS", env.EXEC_TIMEOUT_MS, 30_000),
    chatHistoryMessages: readPositiveInteger("CHAT_HISTORY_MESSAGES", env.CHAT_HISTORY_MESSAGES, 20),
    chatDbPath: resolve(env.CHAT_DB_PATH?.trim() || "./data/chat-history.sqlite"),
    skillsDir: resolve(env.SKILLS_DIR?.trim() || "./skills"),
    agentWorkspaceDir: resolve(env.AGENT_WORKSPACE_DIR?.trim() || "./agent-workspace"),
  };
}
