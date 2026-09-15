import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { Bot } from "grammy";
import type { DocumentFileType, DocumentSummary } from "./inference/protocol.js";
import { documentFileType, isSafeDocumentFilename } from "./inference/protocol.js";
import { logEvent } from "./logging.js";

export const HELP_TEXT = "I remember this chat. Send /new to start over without deleting documents. Upload a .txt, .md, .docx, or .pdf file, use /documents to list uploads, or /delete <filename> to remove one. I can search your documents and use tools for fresh information and actions.";
export const INFERENCE_ERROR_TEXT = "The language model is temporarily unavailable. Please try again.";
export const ACCESS_DENIED_TEXT = "Access denied.";
export const TELEGRAM_MESSAGE_LIMIT = 4096;
const DOCUMENT_RECEIVED_TEXT = "📄 Document received.\n\nProcessing...";
const DOCUMENT_READY_TEXT = "✅ Document is ready.\n\nYou can now ask questions about it.";

export interface InferenceClient {
  request(conversationId: string, userId: string, prompt: string): Promise<string>;
  reset(conversationId: string): Promise<void>;
  indexDocument(userId: string, filename: string, fileType: DocumentFileType, tempPath: string): Promise<{ filename: string; chunkCount: number }>;
  listDocuments(userId: string): Promise<DocumentSummary[]>;
  deleteDocument(userId: string, filename: string): Promise<boolean>;
}
export interface IncomingMessage { text?: unknown; entities?: ReadonlyArray<{ type: string; offset: number }>; }
export interface BotDocumentOptions { documentTempDir: string; maxDocumentBytes: number; documentTimeoutMs: number; fetch?: typeof fetch; createId?: () => string; }
export interface UploadRequest { token: string; userId: string; fileId: string; filename: unknown; knownSize: unknown; inference: InferenceClient; options: BotDocumentOptions; getRemotePath(fileId: string): Promise<string | undefined>; reply(text: string): Promise<unknown>; }
export function isAuthorizedSender(senderId: number | undefined, allowedUserIds: ReadonlySet<string>): boolean { return senderId !== undefined && allowedUserIds.has(String(senderId)); }

export function getInferencePrompt(message: IncomingMessage): string | null { if (typeof message.text !== "string" || message.text.trim().length === 0) return null; const beginsWithCommand = message.text.startsWith("/") || message.entities?.some((entity) => entity.type === "bot_command" && entity.offset === 0) === true; return beginsWithCommand ? null : message.text; }
export function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] { if (!Number.isInteger(limit) || limit <= 0) throw new Error("Message limit must be a positive integer"); const chunks: string[] = []; let remaining = text; while (remaining.length > limit) { const window = remaining.slice(0, limit); let splitAt = window.lastIndexOf("\n"); splitAt = splitAt >= 0 ? splitAt + 1 : limit; if (splitAt > 1 && remaining.charCodeAt(splitAt - 1) >= 0xd800 && remaining.charCodeAt(splitAt - 1) <= 0xdbff && remaining.charCodeAt(splitAt) >= 0xdc00 && remaining.charCodeAt(splitAt) <= 0xdfff) splitAt -= 1; chunks.push(remaining.slice(0, splitAt)); remaining = remaining.slice(splitAt); } if (remaining.length > 0) chunks.push(remaining); return chunks; }

export function validateUpload(filename: unknown, knownSize: unknown, maxBytes: number): { filename: string; fileType: DocumentFileType } {
  if (!isSafeDocumentFilename(filename)) throw new Error("Invalid document filename.");
  const fileType = documentFileType(filename);
  if (!fileType) throw new Error("Unsupported document type. Upload .txt, .md, .docx, or .pdf.");
  if (knownSize !== undefined && (typeof knownSize !== "number" || !Number.isInteger(knownSize) || knownSize < 0)) throw new Error("Invalid document size.");
  if (typeof knownSize === "number" && knownSize > maxBytes) throw new Error("Document is too large.");
  return { filename, fileType };
}

async function downloadFile(url: string, target: string, maxBytes: number, timeoutMs: number, fetchImplementation: typeof fetch): Promise<number> {
  let response: Response;
  try { response = await fetchImplementation(url, { signal: AbortSignal.timeout(timeoutMs) }); } catch { throw new Error("Could not download the document."); }
  if (!response.ok || !response.body) throw new Error("Could not download the document.");
  const file = await open(target, "wx", 0o600);
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Document is too large."); }
      await file.write(value);
    }
  } finally { await file.close(); }
  return size;
}

function safeDocumentError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const allowed = new Set(["Invalid document filename.", "Unsupported document type. Upload .txt, .md, .docx, or .pdf.", "Invalid document size.", "Document is too large.", "Could not download the document.", "A document with that filename already exists.", "Document contains no extractable text.", "Extracted document text is too large.", "Document is corrupt, protected, or unreadable.", "Document not found."]);
  return allowed.has(message) ? message : "Could not process the document. Please try again.";
}

export async function processDocumentUpload(request: UploadRequest): Promise<void> {
  let tempPath: string | undefined;
  const started = Date.now();
  try {
    const upload = validateUpload(request.filename, request.knownSize, request.options.maxDocumentBytes);
    logEvent("bot", "document_received", { file_type: upload.fileType, declared_bytes: typeof request.knownSize === "number" ? request.knownSize : -1 });
    await request.reply(DOCUMENT_RECEIVED_TEXT);
    await mkdir(request.options.documentTempDir, { recursive: true });
    tempPath = join(request.options.documentTempDir, `${(request.options.createId ?? randomUUID)()}.upload`);
    const remotePath = await request.getRemotePath(request.fileId);
    if (!remotePath) throw new Error("Could not download the document.");
    logEvent("bot", "document_download_started");
    const downloadedBytes = await downloadFile(`https://api.telegram.org/file/bot${request.token}/${remotePath}`, tempPath, request.options.maxDocumentBytes, request.options.documentTimeoutMs, request.options.fetch ?? globalThis.fetch);
    logEvent("bot", "document_download_completed", { bytes: downloadedBytes });
    logEvent("bot", "document_indexing_started");
    const indexed = await request.inference.indexDocument(request.userId, upload.filename, upload.fileType, tempPath);
    logEvent("bot", "document_indexing_completed", { chunks: indexed.chunkCount, duration_ms: Date.now() - started });
    await request.reply(DOCUMENT_READY_TEXT);
  } catch (error) { logEvent("bot", "document_processing_failed", { category: error instanceof Error && error.name === "AbortError" ? "timeout" : "document_error", duration_ms: Date.now() - started }); await request.reply(safeDocumentError(error)); }
  finally { if (tempPath) await rm(tempPath, { force: true }).catch(() => logEvent("bot", "temporary_document_cleanup_failed")); }
}

export function createBot(token: string, allowedUserIds: ReadonlySet<string>, inference: InferenceClient, documentOptions: BotDocumentOptions): Bot {
  const bot = new Bot(token);
  bot.use(async (context, next) => { if (!isAuthorizedSender(context.from?.id, allowedUserIds)) { await context.reply(ACCESS_DENIED_TEXT); return; } await next(); });
  bot.command(["start", "help"], async (context) => { await context.reply(HELP_TEXT); });
  bot.command("new", async (context) => { try { await inference.reset(String(context.chat.id)); await context.reply("Started a new chat."); } catch { console.error("Inference reset failed"); await context.reply(INFERENCE_ERROR_TEXT); } });
  bot.command("documents", async (context) => { try { const documents = await inference.listDocuments(String(context.from!.id)); await context.reply(documents.length === 0 ? "No documents uploaded." : `Your documents:\n\n${documents.map((document) => `- ${document.filename} (${document.fileType}, ${document.createdAt})`).join("\n")}`); } catch { console.error("Document list failed"); await context.reply("Could not list documents. Please try again."); } });
  bot.command("delete", async (context) => { const filename = context.match.trim(); if (!filename) { await context.reply("Usage: /delete <filename>"); return; } if (!isSafeDocumentFilename(filename)) { await context.reply("Invalid document filename."); return; } try { await inference.deleteDocument(String(context.from!.id), filename); await context.reply(`Deleted ${filename}.`); } catch (error) { console.error("Document deletion failed"); await context.reply(safeDocumentError(error)); } });
  bot.on("message:document", async (context) => {
    await processDocumentUpload({ token, userId: String(context.from!.id), fileId: context.message.document.file_id, filename: context.message.document.file_name, knownSize: context.message.document.file_size, inference, options: documentOptions, getRemotePath: async (fileId) => (await context.api.getFile(fileId)).file_path, reply: (text) => context.reply(text) });
  });
  bot.on("message:text", async (context) => { const prompt = getInferencePrompt(context.message); if (prompt === null) return; const conversationId = String(context.chat.id); const userId = String(context.from!.id); const started = Date.now(); logEvent("bot", "chat_received", { prompt_chars: prompt.length }); try { const response = await inference.request(conversationId, userId, prompt); const chunks = splitTelegramMessage(response); logEvent("bot", "chat_inference_completed", { response_chars: response.length, reply_parts: chunks.length, duration_ms: Date.now() - started }); for (const chunk of chunks) await context.reply(chunk); logEvent("bot", "chat_reply_completed", { reply_parts: chunks.length, duration_ms: Date.now() - started }); } catch { logEvent("bot", "chat_failed", { category: "inference_error", duration_ms: Date.now() - started }); await context.reply(INFERENCE_ERROR_TEXT); } });
  bot.catch(() => { console.error("Telegram update handling failed"); });
  return bot;
}
