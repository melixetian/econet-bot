import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as sqliteVec from "sqlite-vec";
import type { DocumentFileType, DocumentSummary } from "../inference/protocol.js";
import type { DocumentChunk, RagIndex, SearchResult } from "./types.js";

type StoredMetadata = { key: string; value: string };
type SearchRow = { text: string; filename: string; page_number: number | null; chunk_index: number; distance: number; owner: string };

export class SqliteRag implements RagIndex {
  private readonly database: Database.Database;
  constructor(path: string, model: string, private readonly dimension: number) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    sqliteVec.load(this.database);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS rag_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK (file_type IN ('txt', 'md', 'docx', 'pdf')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, filename)
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        page_number INTEGER,
        text TEXT NOT NULL,
        UNIQUE (document_id, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents (user_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_chunks_document_chunk ON chunks (document_id, chunk_index);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
        embedding float[${dimension}],
        user_id TEXT PARTITION KEY,
        document_id INTEGER
      );
    `);
    const metadata = new Map((this.database.prepare("SELECT key, value FROM rag_metadata").all() as StoredMetadata[]).map((row) => [row.key, row.value]));
    if (metadata.size === 0) {
      const insert = this.database.prepare("INSERT INTO rag_metadata (key, value) VALUES (?, ?)");
      this.database.transaction(() => { insert.run("embedding_model", model); insert.run("embedding_dimension", String(dimension)); })();
    } else if (metadata.get("embedding_model") !== model || metadata.get("embedding_dimension") !== String(dimension)) {
      this.database.close();
      throw new Error("RAG index embedding configuration changed; rebuild RAG_DB_PATH");
    }
  }

  hasDocument(userId: string, filename: string): boolean { return this.database.prepare("SELECT 1 FROM documents WHERE user_id = ? AND filename = ?").get(userId, filename) !== undefined; }

  insertDocument(userId: string, filename: string, fileType: DocumentFileType, chunks: readonly DocumentChunk[], embeddings: readonly number[][]): void {
    if (chunks.length === 0 || chunks.length !== embeddings.length) throw new Error("Invalid document index data");
    const insertDocument = this.database.prepare("INSERT INTO documents (user_id, filename, file_type) VALUES (?, ?, ?)");
    const insertChunk = this.database.prepare("INSERT INTO chunks (document_id, chunk_index, page_number, text) VALUES (?, ?, ?, ?)");
    const insertVector = this.database.prepare("INSERT INTO chunk_vectors (rowid, embedding, user_id, document_id) VALUES (?, ?, ?, ?)");
    this.database.transaction(() => {
      const documentId = Number(insertDocument.run(userId, filename, fileType).lastInsertRowid);
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]!;
        const embedding = embeddings[index]!;
        if (embedding.length !== this.dimension || embedding.some((value) => !Number.isFinite(value))) throw new Error("Invalid embedding vector");
        const chunkId = Number(insertChunk.run(documentId, chunk.chunkIndex, chunk.pageNumber ?? null, chunk.text).lastInsertRowid);
        insertVector.run(BigInt(chunkId), JSON.stringify(embedding), userId, BigInt(documentId));
      }
    })();
  }

  listDocuments(userId: string): DocumentSummary[] {
    return this.database.prepare("SELECT filename, file_type AS fileType, created_at AS createdAt FROM documents WHERE user_id = ? ORDER BY created_at, id").all(userId) as DocumentSummary[];
  }

  deleteDocument(userId: string, filename: string): boolean {
    return this.database.transaction(() => {
      const document = this.database.prepare("SELECT id FROM documents WHERE user_id = ? AND filename = ?").get(userId, filename) as { id: number } | undefined;
      if (!document) return false;
      const chunkIds = this.database.prepare("SELECT id FROM chunks WHERE document_id = ? ORDER BY id").all(document.id) as { id: number }[];
      const deleteVector = this.database.prepare("DELETE FROM chunk_vectors WHERE rowid = ?");
      for (const chunk of chunkIds) deleteVector.run(BigInt(chunk.id));
      this.database.prepare("DELETE FROM chunks WHERE document_id = ?").run(document.id);
      this.database.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(document.id, userId);
      return true;
    })();
  }

  search(userId: string, embedding: readonly number[], topK: number): SearchResult[] {
    if (embedding.length !== this.dimension || embedding.some((value) => !Number.isFinite(value))) throw new Error("Invalid query embedding");
    const rows = this.database.prepare(`
      SELECT c.text, d.filename, c.page_number, c.chunk_index, v.distance, d.user_id AS owner
      FROM chunk_vectors AS v
      JOIN chunks AS c ON c.id = v.rowid
      JOIN documents AS d ON d.id = c.document_id
      WHERE v.embedding MATCH ? AND v.user_id = ? AND k = ?
      ORDER BY v.distance
    `).all(JSON.stringify(embedding), userId, topK) as SearchRow[];
    return rows.filter((row) => row.owner === userId).map((row) => ({ text: row.text, filename: row.filename, chunkIndex: row.chunk_index, distance: row.distance, ...(row.page_number === null ? {} : { pageNumber: row.page_number }) }));
  }

  close(): void { this.database.close(); }
}
