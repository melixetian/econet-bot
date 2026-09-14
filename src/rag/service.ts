import type { WorkerConfig } from "../config.js";
import type { DocumentFileType, DocumentSummary } from "../inference/protocol.js";
import { chunkSegments } from "./chunker.js";
import { DocumentError, extractDocument, validateTemporaryFile } from "./extractors.js";
import type { EmbeddingClient, RagIndex, SearchResponse } from "./types.js";
import { logEvent } from "../logging.js";

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
    const started = Date.now();
    if (this.index.hasDocument(userId, filename)) throw new DocumentError("A document with that filename already exists.", "duplicate_document");
    const path = await validateTemporaryFile(tempPath, this.config.documentTempDir, this.config.maxDocumentBytes);
    logEvent("worker", "document_file_validated", { file_type: fileType });
    const segments = await extractDocument(path, fileType, this.config.maxExtractedTextChars);
    logEvent("worker", "document_text_extracted", { segments: segments.length, text_chars: segments.reduce((total, segment) => total + segment.text.length, 0) });
    const chunks = chunkSegments(segments, this.config.ragChunkSizeChars, this.config.ragChunkOverlapChars);
    if (chunks.length === 0) throw new DocumentError("Document contains no extractable text.", "document_empty");
    logEvent("worker", "document_chunked", { chunks: chunks.length });
    logEvent("worker", "document_embedding_started", { chunks: chunks.length });
    const vectors = await this.embedBatches(chunks.map((chunk) => chunk.text), signal);
    logEvent("worker", "document_embedding_completed", { vectors: vectors.length });
    this.index.insertDocument(userId, filename, fileType, chunks, vectors);
    logEvent("worker", "document_stored", { chunks: chunks.length, duration_ms: Date.now() - started });
    return { filename, chunkCount: chunks.length };
  }

  listDocuments(userId: string): DocumentSummary[] { return this.index.listDocuments(userId); }
  deleteDocument(userId: string, filename: string): boolean { return this.index.deleteDocument(userId, filename); }

  async search(userId: string, query: string, signal?: AbortSignal): Promise<SearchResponse> {
    const started = Date.now();
    const normalized = query.trim();
    if (!normalized || normalized.includes("\0")) throw new Error("Search query must be non-empty and contain no NUL bytes");
    logEvent("worker", "document_search_started", { query_chars: normalized.length });
    const vectors = await this.embeddings.embed([normalized], signal);
    if (vectors.length !== 1) throw new Error("Embedding query length mismatch");
    logEvent("worker", "document_search_embedding_completed", { duration_ms: Date.now() - started });
    const candidates = this.index.search(userId, vectors[0]!, this.config.ragTopK);
    const nearestDistance = candidates[0]?.distance;
    logEvent("worker", "document_search_candidates", { candidates: candidates.length, nearest_distance: nearestDistance === undefined ? -1 : Number(nearestDistance.toFixed(4)), max_distance: this.config.ragMaxDistance });
    const matched = candidates.filter((result) => result.distance <= this.config.ragMaxDistance);
    if (matched.length === 0) { logEvent("worker", "document_search_completed", { status: "no_match", results: 0, duration_ms: Date.now() - started }); return { status: "no_match", results: [] }; }
    const results = [];
    let characters = 0;
    for (const match of matched) {
      if (characters + match.text.length > this.config.ragMaxContextChars) break;
      results.push(match);
      characters += match.text.length;
    }
    logEvent("worker", "document_search_completed", { status: "ok", results: results.length, omitted: matched.length - results.length, duration_ms: Date.now() - started });
    return { status: "ok", results, omittedResults: matched.length - results.length };
  }

  close(): void { this.index.close(); }
}
