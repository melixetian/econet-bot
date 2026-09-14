import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRag } from "../src/rag/sqlite-rag.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
function index(): SqliteRag { const root = mkdtempSync(join(tmpdir(), "sqlite-rag-")); directories.push(root); return new SqliteRag(join(root, "rag.sqlite"), "fake", 2); }

describe("SqliteRag", () => {
  it("indexes atomically and retrieves ordered owned chunks with sources", () => { const rag = index(); rag.insertDocument("A", "a.pdf", "pdf", [{ text: "closest", pageNumber: 2, chunkIndex: 0 }, { text: "second", pageNumber: 3, chunkIndex: 1 }], [[1, 0], [0.8, 0.2]]); rag.insertDocument("B", "secret.txt", "txt", [{ text: "other user", chunkIndex: 0 }], [[1, 0]]); const results = rag.search("A", [1, 0], 5); expect(results.map((result) => result.text)).toEqual(["closest", "second"]); expect(results[0]).toMatchObject({ filename: "a.pdf", pageNumber: 2, chunkIndex: 0 }); expect(rag.search("B", [1, 0], 5)[0]?.text).toBe("other user"); rag.close(); });
  it("cannot list or delete another user's exact filename and removes owned vectors", () => { const rag = index(); rag.insertDocument("A", "same.txt", "txt", [{ text: "owned", chunkIndex: 0 }], [[1, 0]]); rag.insertDocument("B", "same.txt", "txt", [{ text: "private", chunkIndex: 0 }], [[1, 0]]); expect(rag.listDocuments("B")).toHaveLength(1); expect(rag.deleteDocument("B", "other.txt")).toBe(false); expect(rag.deleteDocument("A", "SAME.txt")).toBe(false); expect(rag.deleteDocument("A", "same.txt")).toBe(true); expect(rag.search("A", [1, 0], 5)).toEqual([]); expect(rag.search("B", [1, 0], 5)[0]?.text).toBe("private"); rag.close(); });
  it("rejects duplicates and rolls back relational and vector writes", () => { const rag = index(); expect(() => rag.insertDocument("A", "bad.txt", "txt", [{ text: "one", chunkIndex: 0 }, { text: "two", chunkIndex: 1 }], [[1, 0], [1]])).toThrow(); expect(rag.listDocuments("A")).toEqual([]); rag.insertDocument("A", "ok.txt", "txt", [{ text: "one", chunkIndex: 0 }], [[1, 0]]); expect(() => rag.insertDocument("A", "ok.txt", "txt", [{ text: "two", chunkIndex: 0 }], [[0, 1]])).toThrow(); rag.close(); });
  it("deletion removes document, chunks, and vectors from retrieval", () => { const rag = index(); rag.insertDocument("A", "a.txt", "txt", [{ text: "gone", chunkIndex: 0 }], [[1, 0]]); expect(rag.deleteDocument("A", "a.txt")).toBe(true); expect(rag.listDocuments("A")).toEqual([]); expect(rag.search("A", [1, 0], 5)).toEqual([]); rag.close(); });
  it("requires a rebuild when embedding metadata changes", () => { const root = mkdtempSync(join(tmpdir(), "sqlite-rag-meta-")); directories.push(root); const path = join(root, "rag.sqlite"); new SqliteRag(path, "first", 2).close(); expect(() => new SqliteRag(path, "second", 2)).toThrow("rebuild RAG_DB_PATH"); });
});
