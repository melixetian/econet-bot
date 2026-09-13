import type { WorkerConfig } from "../config.js";
import type { DocumentFileType, DocumentSummary } from "../inference/protocol.js";
import { chunkSegments } from "./chunker.js";
import { DocumentError, extractDocument, validateTemporaryFile } from "./extractors.js";
import type { EmbeddingClient, RagIndex, SearchResponse } from "./types.js";

export class RagService {
  constructor(private readonly index: RagIndex, private readonly embeddings: EmbeddingClient, private readonly config: WorkerConfig) {}

  private async embedBatches(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const all: number[][] = [];
    for (let start = 0; start < texts.length; start += this.config.embeddingBatchSize) {
      const batch = texts.slice(start, start + this.config.embeddingBatchSize);
      const embedded = await this.embeddings.embed(batch, signal);
      if (embedded.length !== batch.length) throw new Error("Embedding batch length mismatch");
      all.push(...embedded);
    }
    return all;
  }

  async indexDocument(userId: string, filename: string, fileType: DocumentFileType, tempPath: string, signal?: AbortSignal): Promise<{ filename: string; chunkCount: number }> {
    if (this.index.hasDocument(userId, filename)) throw new DocumentError("A document with that filename already exists.", "duplicate_document");
    const path = await validateTemporaryFile(tempPath, this.config.documentTempDir, this.config.maxDocumentBytes);
    const segments = await extractDocument(path, fileType, this.config.maxExtractedTextChars);
    const chunks = chunkSegments(segments, this.config.ragChunkSizeChars, this.config.ragChunkOverlapChars);
    if (chunks.length === 0) throw new DocumentError("Document contains no extractable text.", "document_empty");
    const vectors = await this.embedBatches(chunks.map((chunk) => chunk.text), signal);
    this.index.insertDocument(userId, filename, fileType, chunks, vectors);
    return { filename, chunkCount: chunks.length };
  }

  listDocuments(userId: string): DocumentSummary[] { return this.index.listDocuments(userId); }
  deleteDocument(userId: string, filename: string): boolean { return this.index.deleteDocument(userId, filename); }

  async search(userId: string, query: string, signal?: AbortSignal): Promise<SearchResponse> {
    const normalized = query.trim();
    if (!normalized || normalized.includes("\0")) throw new Error("Search query must be non-empty and contain no NUL bytes");
    const vectors = await this.embeddings.embed([normalized], signal);
    if (vectors.length !== 1) throw new Error("Embedding query length mismatch");
    const matched = this.index.search(userId, vectors[0]!, this.config.ragTopK).filter((result) => result.distance <= this.config.ragMaxDistance);
    if (matched.length === 0) return { status: "no_match", results: [] };
    const results = [];
    let characters = 0;
    for (const match of matched) {
      if (characters + match.text.length > this.config.ragMaxContextChars) break;
      results.push(match);
      characters += match.text.length;
    }
    return { status: "ok", results, omittedResults: matched.length - results.length };
  }

  close(): void { this.index.close(); }
}
