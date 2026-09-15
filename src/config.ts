import { resolve } from "node:path";

export interface BotConfig {
  telegramBotToken: string;
  allowedTelegramUserIds: ReadonlySet<string>;
  agentTimeoutMs: number;
  documentTimeoutMs: number;
  documentTempDir: string;
  maxDocumentBytes: number;
}

export interface WorkerConfig {
  inferenceProvider: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaEmbeddingModel: string;
  ragEmbeddingDimension: number;
  llmTimeoutMs: number;
  embeddingTimeoutMs: number;
  agentTimeoutMs: number;
  documentTimeoutMs: number;
  agentMaxSteps: number;
  execTimeoutMs: number;
  chatHistoryMessages: number;
  chatDbPath: string;
  ragDbPath: string;
  documentTempDir: string;
  maxDocumentBytes: number;
  maxExtractedTextChars: number;
  ragChunkSizeChars: number;
  ragChunkOverlapChars: number;
  embeddingBatchSize: number;
  ragTopK: number;
  ragMaxDistance: number;
  ragMaxContextChars: number;
  skillsDir: string;
  agentWorkspaceDir: string;
  tokenAuditEnabled: boolean;
  tokenAuditDbPath: string;
  tokenAuditAgentId: string;
  tokenAuditProfile: "baseline" | "optimized";
  chatHistoryTokenBudget: number;
  execModelOutputMaxChars: number;
  ragModelContextMaxChars: number;
  tokenAuditInputUsdPer1M: number;
  tokenAuditCachedInputUsdPer1M: number;
  tokenAuditOutputUsdPer1M: number;
  tokenAuditReasoningUsdPer1M: number;
}

function readPositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function readIntegerAtLeast(name: string, value: string | undefined, fallback: number, minimum: number): number {
  const parsed = readPositiveInteger(name, value, fallback);
  if (parsed < minimum) throw new Error(`${name} must be at least ${minimum}`);
  return parsed;
}

function readNonNegativeNumber(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

function readBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function readAuditProfile(value: string | undefined): "baseline" | "optimized" {
  const profile = value?.trim() || "optimized";
  if (profile !== "baseline" && profile !== "optimized") throw new Error("TOKEN_AUDIT_PROFILE must be baseline or optimized");
  return profile;
}

function readAuditAgentId(value: string | undefined): string {
  const agentId = value?.trim() || "econet-bot";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(agentId)) throw new Error("TOKEN_AUDIT_AGENT_ID must be a non-secret label using letters, numbers, dot, underscore, or hyphen");
  return agentId;
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

function sharedDocumentConfig(env: NodeJS.ProcessEnv) {
  return {
    documentTimeoutMs: readPositiveInteger("DOCUMENT_TIMEOUT_MS", env.DOCUMENT_TIMEOUT_MS, 300_000),
    documentTempDir: resolve(env.DOCUMENT_TEMP_DIR?.trim() || "./data/tmp-documents"),
    maxDocumentBytes: readPositiveInteger("MAX_DOCUMENT_BYTES", env.MAX_DOCUMENT_BYTES, 10_485_760),
  };
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is required");
  return {
    telegramBotToken,
    allowedTelegramUserIds: readAllowlist(env.ALLOWED_TELEGRAM_USER_IDS),
    agentTimeoutMs: readPositiveInteger("AGENT_TIMEOUT_MS", env.AGENT_TIMEOUT_MS, 300_000),
    ...sharedDocumentConfig(env),
  };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const agentMaxSteps = readPositiveInteger("AGENT_MAX_STEPS", env.AGENT_MAX_STEPS, 5);
  if (agentMaxSteps > 10) throw new Error("AGENT_MAX_STEPS must be an integer from 1 to 10");
  const ragChunkSizeChars = readPositiveInteger("RAG_CHUNK_SIZE_CHARS", env.RAG_CHUNK_SIZE_CHARS, 1_600);
  const ragChunkOverlapChars = env.RAG_CHUNK_OVERLAP_CHARS === undefined ? 300 : Number(env.RAG_CHUNK_OVERLAP_CHARS);
  if (!Number.isInteger(ragChunkOverlapChars) || ragChunkOverlapChars < 0 || ragChunkOverlapChars >= ragChunkSizeChars) throw new Error("RAG_CHUNK_OVERLAP_CHARS must be an integer from 0 to less than RAG_CHUNK_SIZE_CHARS");
  return {
    inferenceProvider: env.INFERENCE_PROVIDER?.trim() || "ollama",
    ollamaBaseUrl: readHttpUrl(env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"),
    ollamaModel: env.OLLAMA_MODEL?.trim() || "qwen3:1.7b",
    ollamaEmbeddingModel: env.OLLAMA_EMBEDDING_MODEL?.trim() || "embeddinggemma",
    ragEmbeddingDimension: readPositiveInteger("RAG_EMBEDDING_DIMENSION", env.RAG_EMBEDDING_DIMENSION, 768),
    llmTimeoutMs: readPositiveInteger("LLM_TIMEOUT_MS", env.LLM_TIMEOUT_MS, 60_000),
    embeddingTimeoutMs: readPositiveInteger("EMBEDDING_TIMEOUT_MS", env.EMBEDDING_TIMEOUT_MS, 60_000),
    agentTimeoutMs: readPositiveInteger("AGENT_TIMEOUT_MS", env.AGENT_TIMEOUT_MS, 300_000),
    agentMaxSteps,
    execTimeoutMs: readPositiveInteger("EXEC_TIMEOUT_MS", env.EXEC_TIMEOUT_MS, 30_000),
    chatHistoryMessages: readPositiveInteger("CHAT_HISTORY_MESSAGES", env.CHAT_HISTORY_MESSAGES, 20),
    chatDbPath: resolve(env.CHAT_DB_PATH?.trim() || "./data/chat-history.sqlite"),
    ragDbPath: resolve(env.RAG_DB_PATH?.trim() || "./data/rag.sqlite"),
    maxExtractedTextChars: readPositiveInteger("MAX_EXTRACTED_TEXT_CHARS", env.MAX_EXTRACTED_TEXT_CHARS, 1_000_000),
    ragChunkSizeChars,
    ragChunkOverlapChars,
    embeddingBatchSize: readPositiveInteger("EMBEDDING_BATCH_SIZE", env.EMBEDDING_BATCH_SIZE, 16),
    ragTopK: readPositiveInteger("RAG_TOP_K", env.RAG_TOP_K, 5),
    ragMaxDistance: readNonNegativeNumber("RAG_MAX_DISTANCE", env.RAG_MAX_DISTANCE, 1.0),
    ragMaxContextChars: readPositiveInteger("RAG_MAX_CONTEXT_CHARS", env.RAG_MAX_CONTEXT_CHARS, 8_000),
    skillsDir: resolve(env.SKILLS_DIR?.trim() || "./skills"),
    agentWorkspaceDir: resolve(env.AGENT_WORKSPACE_DIR?.trim() || "./agent-workspace"),
    tokenAuditEnabled: readBoolean("TOKEN_AUDIT_ENABLED", env.TOKEN_AUDIT_ENABLED, true),
    tokenAuditDbPath: resolve(env.TOKEN_AUDIT_DB_PATH?.trim() || "./data/token-audit.sqlite"),
    tokenAuditAgentId: readAuditAgentId(env.TOKEN_AUDIT_AGENT_ID),
    tokenAuditProfile: readAuditProfile(env.TOKEN_AUDIT_PROFILE),
    chatHistoryTokenBudget: readPositiveInteger("CHAT_HISTORY_TOKEN_BUDGET", env.CHAT_HISTORY_TOKEN_BUDGET, 1_600),
    execModelOutputMaxChars: readIntegerAtLeast("EXEC_MODEL_OUTPUT_MAX_CHARS", env.EXEC_MODEL_OUTPUT_MAX_CHARS, 3_000, 256),
    ragModelContextMaxChars: readPositiveInteger("RAG_MODEL_CONTEXT_MAX_CHARS", env.RAG_MODEL_CONTEXT_MAX_CHARS, 4_500),
    tokenAuditInputUsdPer1M: readNonNegativeNumber("TOKEN_AUDIT_INPUT_USD_PER_1M", env.TOKEN_AUDIT_INPUT_USD_PER_1M, 0),
    tokenAuditCachedInputUsdPer1M: readNonNegativeNumber("TOKEN_AUDIT_CACHED_INPUT_USD_PER_1M", env.TOKEN_AUDIT_CACHED_INPUT_USD_PER_1M, 0),
    tokenAuditOutputUsdPer1M: readNonNegativeNumber("TOKEN_AUDIT_OUTPUT_USD_PER_1M", env.TOKEN_AUDIT_OUTPUT_USD_PER_1M, 0),
    tokenAuditReasoningUsdPer1M: readNonNegativeNumber("TOKEN_AUDIT_REASONING_USD_PER_1M", env.TOKEN_AUDIT_REASONING_USD_PER_1M, 0),
    ...sharedDocumentConfig(env),
  };
}
