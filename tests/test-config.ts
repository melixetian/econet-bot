import type { WorkerConfig } from "../src/config.js";

export const testConfig: WorkerConfig = {
  inferenceProvider: "ollama", ollamaBaseUrl: "http://localhost", ollamaModel: "chat", ollamaEmbeddingModel: "embed", ragEmbeddingDimension: 3,
  llmTimeoutMs: 1_000, embeddingTimeoutMs: 1_000, agentTimeoutMs: 1_000, documentTimeoutMs: 1_000, agentMaxSteps: 3, execTimeoutMs: 10,
  chatHistoryMessages: 20, chatDbPath: "/tmp/unused-history.sqlite", ragDbPath: "/tmp/unused-rag.sqlite", documentTempDir: "/tmp",
  maxDocumentBytes: 10_000, maxExtractedTextChars: 10_000, ragChunkSizeChars: 100, ragChunkOverlapChars: 20, embeddingBatchSize: 2,
  ragTopK: 5, ragMaxDistance: 1.0, ragMaxContextChars: 1_000, skillsDir: "/tmp", agentWorkspaceDir: "/tmp",
  tokenAuditEnabled: false, tokenAuditDbPath: "/tmp/unused-audit.sqlite", tokenAuditAgentId: "test-agent", tokenAuditProfile: "optimized",
  chatHistoryTokenBudget: 1_600, execModelOutputMaxChars: 3_000, ragModelContextMaxChars: 4_500, tokenAuditInputUsdPer1M: 0, tokenAuditCachedInputUsdPer1M: 0,
  tokenAuditOutputUsdPer1M: 0, tokenAuditReasoningUsdPer1M: 0,
};
