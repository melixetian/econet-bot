import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentFileType, DocumentSummary } from "../src/inference/protocol.js";
import { RagService } from "../src/rag/service.js";
import type { DocumentChunk, EmbeddingClient, RagIndex, SearchResult } from "../src/rag/types.js";
import { testConfig } from "./test-config.js";

class MemoryIndex implements RagIndex {
  rows: SearchResult[] = []; documents: DocumentSummary[] = [];
  hasDocument(_user: string, filename: string) { return this.documents.some((document) => document.filename === filename); }
  insertDocument(_user: string, filename: string, fileType: DocumentFileType, chunks: readonly DocumentChunk[]) { this.documents.push({ filename, fileType, createdAt: "now" }); this.rows = chunks.map((chunk, index) => ({ ...chunk, filename, distance: index / 10 })); }
  listDocuments() { return this.documents; } deleteDocument() { return false; }
  search() { return this.rows; } close() {}
}
class FakeEmbeddings implements EmbeddingClient { batches: string[][] = []; async embed(inputs: string[]) { this.batches.push(inputs); return inputs.map(() => [1, 0, 0]); } }

describe("RagService", () => {
  it("batches indexing and leaves no partial write when embedding fails", async () => { const root = mkdtempSync(join(tmpdir(), "rag-service-")); const path = join(root, "source.txt"); writeFileSync(path, "one two three four five six"); try { const index = new MemoryIndex(); const embeddings = new FakeEmbeddings(); const config = { ...testConfig, documentTempDir: root, ragChunkSizeChars: 5, ragChunkOverlapChars: 1, embeddingBatchSize: 2 }; const service = new RagService(index, embeddings, config); await service.indexDocument("u", "source.txt", "txt", path); expect(embeddings.batches.every((batch) => batch.length <= 2)).toBe(true); expect(index.documents).toHaveLength(1); const failingIndex = new MemoryIndex(); const failing = new RagService(failingIndex, { embed: async () => { throw new Error("failed"); } }, config); await expect(failing.indexDocument("u", "failed.txt", "txt", path)).rejects.toThrow(); expect(failingIndex.documents).toHaveLength(0); } finally { rmSync(root, { recursive: true, force: true }); } });
  it("applies distance and complete-chunk context bounds", async () => { const index = new MemoryIndex(); index.rows = [{ text: "12345", filename: "a.txt", chunkIndex: 0, distance: 0.1 }, { text: "67890", filename: "a.txt", chunkIndex: 1, distance: 0.2 }, { text: "far", filename: "a.txt", chunkIndex: 2, distance: 0.9 }]; const service = new RagService(index, new FakeEmbeddings(), { ...testConfig, ragMaxContextChars: 5 }); await expect(service.search("u", "query")).resolves.toEqual({ status: "ok", results: [index.rows[0]], omittedResults: 1 }); });
  it("returns distinct no_match", async () => { const service = new RagService(new MemoryIndex(), new FakeEmbeddings(), testConfig); await expect(service.search("u", "query")).resolves.toEqual({ status: "no_match", results: [] }); });
});
