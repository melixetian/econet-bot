import type { DocumentChunk, ExtractedSegment } from "./types.js";

function lastSentenceBoundary(text: string, minimum: number): number {
  let boundary = -1;
  const pattern = /[.!?](?:["')\]]*)\s+/g;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end >= minimum) boundary = end;
  }
  return boundary;
}

function preferredEnd(text: string, start: number, maximum: number, target: number): number {
  if (maximum === text.length) return maximum;
  const window = text.slice(start, maximum);
  const minimum = Math.floor(target * 0.5);
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= minimum) return start + paragraph + 2;
  const newline = window.lastIndexOf("\n");
  if (newline >= minimum) return start + newline + 1;
  const sentence = lastSentenceBoundary(window, minimum);
  if (sentence >= minimum) return start + sentence;
  const whitespace = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
  return whitespace >= minimum ? start + whitespace + 1 : maximum;
}

export function chunkSegments(segments: readonly ExtractedSegment[], chunkSize: number, overlap: number): DocumentChunk[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || !Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) throw new Error("Invalid chunk configuration");
  const chunks: DocumentChunk[] = [];
  for (const segment of segments) {
    let start = 0;
    while (start < segment.text.length) {
      const maximum = Math.min(start + chunkSize, segment.text.length);
      const end = preferredEnd(segment.text, start, maximum, chunkSize);
      const text = segment.text.slice(start, end).trim();
      if (text) chunks.push({ text, chunkIndex: chunks.length, ...(segment.pageNumber === undefined ? {} : { pageNumber: segment.pageNumber }) });
      if (end >= segment.text.length) break;
      const next = Math.max(end - overlap, start + 1);
      start = next > start ? next : end;
    }
  }
  return chunks;
}
