import type { DocumentFileType, DocumentSummary } from "../inference/protocol.js";

export type ExtractedSegment = { text: string; pageNumber?: number };
export type DocumentChunk = { text: string; pageNumber?: number; chunkIndex: number };
export type SearchResult = { text: string; filename: string; pageNumber?: number; chunkIndex: number; distance: number };
export type SearchResponse = { status: "ok"; results: SearchResult[]; omittedResults: number } | { status: "no_match"; results: [] };
export interface EmbeddingClient { embed(inputs: string[], signal?: AbortSignal): Promise<number[][]>; }
export interface RagIndex {
  hasDocument(userId: string, filename: string): boolean;
  insertDocument(userId: string, filename: string, fileType: DocumentFileType, chunks: readonly DocumentChunk[], embeddings: readonly number[][]): void;
  listDocuments(userId: string): DocumentSummary[];
  deleteDocument(userId: string, filename: string): boolean;
  search(userId: string, embedding: readonly number[], topK: number): SearchResult[];
  close(): void;
}
