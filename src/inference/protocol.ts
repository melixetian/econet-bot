import { extname } from "node:path";

export const DOCUMENT_FILE_TYPES = ["txt", "md", "docx", "pdf"] as const;
export type DocumentFileType = (typeof DOCUMENT_FILE_TYPES)[number];
export type DocumentSummary = { filename: string; fileType: DocumentFileType; createdAt: string };

export type InferenceRequest =
  | { id: string; type: "chat"; conversationId: string; userId: string; prompt: string }
  | { id: string; type: "reset"; conversationId: string }
  | { id: string; type: "index_document"; userId: string; filename: string; fileType: DocumentFileType; tempPath: string }
  | { id: string; type: "list_documents"; userId: string }
  | { id: string; type: "delete_document"; userId: string; filename: string };

export type InferenceResponse =
  | { id: string; ok: true; type: "chat"; text: string }
  | { id: string; ok: true; type: "reset" }
  | { id: string; ok: true; type: "index_document"; document: { filename: string; chunkCount: number } }
  | { id: string; ok: true; type: "list_documents"; documents: DocumentSummary[] }
  | { id: string; ok: true; type: "delete_document"; deleted: true }
  | { id: string; ok: false; error: string; code: string };

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const expected = [...keys].sort(); const actual = Object.keys(value).sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
export function isSafeDocumentFilename(value: unknown): value is string { return nonEmpty(value) && value !== "." && value !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(value); }
export function documentFileType(filename: string): DocumentFileType | null { const extension = extname(filename).slice(1).toLowerCase(); return DOCUMENT_FILE_TYPES.includes(extension as DocumentFileType) ? extension as DocumentFileType : null; }

export function parseInferenceRequest(line: string): InferenceRequest | null {
  let value: unknown; try { value = JSON.parse(line); } catch { return null; }
  if (!isRecord(value) || !nonEmpty(value.id) || !nonEmpty(value.type)) return null;
  if (value.type === "chat" && exactKeys(value, ["id", "type", "conversationId", "userId", "prompt"]) && nonEmpty(value.conversationId) && nonEmpty(value.userId) && nonEmpty(value.prompt)) return { id: value.id, type: "chat", conversationId: value.conversationId, userId: value.userId, prompt: value.prompt };
  if (value.type === "reset" && exactKeys(value, ["id", "type", "conversationId"]) && nonEmpty(value.conversationId)) return { id: value.id, type: "reset", conversationId: value.conversationId };
  if (value.type === "index_document" && exactKeys(value, ["id", "type", "userId", "filename", "fileType", "tempPath"]) && nonEmpty(value.userId) && isSafeDocumentFilename(value.filename) && DOCUMENT_FILE_TYPES.includes(value.fileType as DocumentFileType) && value.fileType === documentFileType(value.filename) && nonEmpty(value.tempPath)) return { id: value.id, type: "index_document", userId: value.userId, filename: value.filename, fileType: value.fileType as DocumentFileType, tempPath: value.tempPath };
  if (value.type === "list_documents" && exactKeys(value, ["id", "type", "userId"]) && nonEmpty(value.userId)) return { id: value.id, type: "list_documents", userId: value.userId };
  if (value.type === "delete_document" && exactKeys(value, ["id", "type", "userId", "filename"]) && nonEmpty(value.userId) && isSafeDocumentFilename(value.filename)) return { id: value.id, type: "delete_document", userId: value.userId, filename: value.filename };
  return null;
}

function validDocumentSummary(value: unknown): value is DocumentSummary { return isRecord(value) && exactKeys(value, ["filename", "fileType", "createdAt"]) && isSafeDocumentFilename(value.filename) && DOCUMENT_FILE_TYPES.includes(value.fileType as DocumentFileType) && nonEmpty(value.createdAt); }
export function parseInferenceResponse(line: string): InferenceResponse | null {
  let value: unknown; try { value = JSON.parse(line); } catch { return null; }
  if (!isRecord(value) || !nonEmpty(value.id) || typeof value.ok !== "boolean") return null;
  if (!value.ok && exactKeys(value, ["id", "ok", "error", "code"]) && nonEmpty(value.error) && nonEmpty(value.code)) return { id: value.id, ok: false, error: value.error, code: value.code };
  if (!value.ok || !nonEmpty(value.type)) return null;
  if (value.type === "chat" && exactKeys(value, ["id", "ok", "type", "text"]) && typeof value.text === "string") return { id: value.id, ok: true, type: "chat", text: value.text };
  if (value.type === "reset" && exactKeys(value, ["id", "ok", "type"])) return { id: value.id, ok: true, type: "reset" };
  if (value.type === "index_document" && exactKeys(value, ["id", "ok", "type", "document"]) && isRecord(value.document) && exactKeys(value.document, ["filename", "chunkCount"]) && isSafeDocumentFilename(value.document.filename) && Number.isInteger(value.document.chunkCount) && (value.document.chunkCount as number) > 0) return { id: value.id, ok: true, type: "index_document", document: { filename: value.document.filename, chunkCount: value.document.chunkCount as number } };
  if (value.type === "list_documents" && exactKeys(value, ["id", "ok", "type", "documents"]) && Array.isArray(value.documents) && value.documents.every(validDocumentSummary)) return { id: value.id, ok: true, type: "list_documents", documents: value.documents };
  if (value.type === "delete_document" && exactKeys(value, ["id", "ok", "type", "deleted"]) && value.deleted === true) return { id: value.id, ok: true, type: "delete_document", deleted: true };
  return null;
}

export class JsonLineDecoder { private buffer = ""; push(chunk: string): string[] { this.buffer += chunk; const lines = this.buffer.split("\n"); this.buffer = lines.pop() ?? ""; return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line); } }
