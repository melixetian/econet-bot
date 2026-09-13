import { describe, expect, it } from "vitest";
import { chunkSegments } from "../src/rag/chunker.js";

describe("deterministic chunking", () => {
  it("prefers boundaries, overlaps, preserves pages, and always advances", () => {
    const text = "First paragraph has words.\n\nSecond paragraph has enough words to require another deterministic chunk. More words follow here.";
    const first = chunkSegments([{ text, pageNumber: 2 }], 60, 15);
    const second = chunkSegments([{ text, pageNumber: 2 }], 60, 15);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
    expect(first.map((chunk) => chunk.chunkIndex)).toEqual(first.map((_, index) => index));
    expect(first.every((chunk) => chunk.text.length > 0 && chunk.text.length <= 60 && chunk.pageNumber === 2)).toBe(true);
    expect(first.length).toBeLessThan(text.length);
  });
  it("rejects non-advancing overlap", () => expect(() => chunkSegments([{ text: "abc" }], 3, 3)).toThrow("Invalid chunk"));
});
