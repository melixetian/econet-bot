import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import mammoth from "mammoth";
import type { DocumentFileType } from "../inference/protocol.js";
import type { ExtractedSegment } from "./types.js";

export class DocumentError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replaceAll("\0", "").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function validateTemporaryFile(tempPath: string, tempDir: string, maxBytes: number): Promise<string> {
  if (!isAbsolute(tempPath)) throw new DocumentError("Invalid temporary document path.", "invalid_temp_path");
  await mkdir(tempDir, { recursive: true });
  let root: string;
  let file: string;
  try { root = await realpath(resolve(tempDir)); file = await realpath(tempPath); } catch { throw new DocumentError("Temporary document is unavailable.", "invalid_temp_path"); }
  const child = relative(root, file);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new DocumentError("Invalid temporary document path.", "invalid_temp_path");
  const stats = await lstat(tempPath);
  if (!stats.isFile()) throw new DocumentError("Temporary document is not a regular file.", "invalid_temp_path");
  if (stats.size > maxBytes) throw new DocumentError("Document is too large.", "document_too_large");
  return file;
}

async function extractPdf(buffer: Buffer): Promise<ExtractedSegment[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  try {
    const pdf = await loadingTask.promise;
    const segments: ExtractedSegment[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => "str" in item ? item.str : "").join(" ");
      segments.push({ text, pageNumber });
      page.cleanup();
    }
    return segments;
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractDocument(path: string, fileType: DocumentFileType, maxChars: number): Promise<ExtractedSegment[]> {
  let buffer: Buffer;
  try { buffer = await readFile(path); } catch { throw new DocumentError("Could not read the uploaded document.", "document_read_failed"); }
  let segments: ExtractedSegment[];
  try {
    if (fileType === "txt" || fileType === "md") segments = [{ text: new TextDecoder("utf-8", { fatal: true }).decode(buffer) }];
    else if (fileType === "docx") segments = [{ text: (await mammoth.extractRawText({ buffer })).value }];
    else segments = await extractPdf(buffer);
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("Document is corrupt, protected, or unreadable.", "document_parse_failed");
  }
  const normalized = segments.map((segment) => ({ ...segment, text: normalizeExtractedText(segment.text) })).filter((segment) => segment.text.length > 0);
  const total = normalized.reduce((sum, segment) => sum + segment.text.length, 0);
  if (total === 0) throw new DocumentError("Document contains no extractable text.", "document_empty");
  if (total > maxChars) throw new DocumentError("Extracted document text is too large.", "extracted_text_too_large");
  return normalized;
}
