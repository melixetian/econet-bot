import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getInferencePrompt,
  isAuthorizedSender,
  MAX_USER_MESSAGE_CHARS,
  processTextMessage,
  processDocumentUpload,
  splitTelegramMessage,
  TELEGRAM_MESSAGE_LIMIT,
  USER_MESSAGE_TOO_LONG_TEXT,
  validateInferencePrompt,
  validateUpload,
  type InferenceClient,
} from "../src/bot.js";

describe("getInferencePrompt", () => {
  it("returns the original non-empty message without modification", () => {
    expect(getInferencePrompt({ text: "  keep this spacing  " })).toBe(
      "  keep this spacing  ",
    );
  });

  it.each([
    ["non-text", {}],
    ["whitespace-only text", { text: " \n\t " }],
    ["start command", { text: "/start" }],
    ["unknown command", { text: "/unknown argument" }],
    [
      "command entity",
      { text: "command", entities: [{ type: "bot_command", offset: 0 }] },
    ],
  ])("ignores %s", (_description, message) => {
    expect(getInferencePrompt(message)).toBeNull();
  });
});

describe("text input boundary", () => {
  it.each(["", " \n\t "])("rejects empty input without worker or reply side effects", async (text) => {
    const inference = { request: vi.fn() } as unknown as InferenceClient;
    const reply = vi.fn();
    await processTextMessage({ message: { text }, conversationId: "c", userId: "u", inference, reply });
    expect(inference.request).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("accepts exactly the Unicode code-point limit and forwards it unchanged", async () => {
    const text = ` ${"😀".repeat(MAX_USER_MESSAGE_CHARS - 2)} `;
    const inference = { request: vi.fn().mockResolvedValue("plain _*[]`\\ output") } as unknown as InferenceClient;
    const reply = vi.fn().mockResolvedValue(undefined);
    await processTextMessage({ message: { text }, conversationId: "c", userId: "u", inference, reply });
    expect([...text]).toHaveLength(MAX_USER_MESSAGE_CHARS);
    expect(inference.request).toHaveBeenCalledWith("c", "u", text);
    expect(reply).toHaveBeenCalledWith("plain _*[]`\\ output");
    expect(reply.mock.calls[0]).toHaveLength(1);
  });

  it("rejects one Unicode code point over the limit before the worker", async () => {
    const inference = { request: vi.fn() } as unknown as InferenceClient;
    const reply = vi.fn().mockResolvedValue(undefined);
    await processTextMessage({ message: { text: "😀".repeat(MAX_USER_MESSAGE_CHARS + 1) }, conversationId: "c", userId: "u", inference, reply });
    expect(inference.request).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(USER_MESSAGE_TOO_LONG_TEXT);
  });

  it("preserves Markdown-like, emoji, backslash, and non-ASCII input", async () => {
    const text = "  _*[]`\\ unmatched ** Привет 😀  ";
    expect(validateInferencePrompt({ text })).toEqual({ status: "accepted", prompt: text });
    const inference = { request: vi.fn().mockResolvedValue("ok") } as unknown as InferenceClient;
    await processTextMessage({ message: { text }, conversationId: "c", userId: "u", inference, reply: vi.fn().mockResolvedValue(undefined) });
    expect(inference.request).toHaveBeenCalledWith("c", "u", text);
  });
});

describe("document upload validation", () => {
  it("requires an allowlisted sender before any operation", () => { const allowed = new Set(["7"]); expect(isAuthorizedSender(undefined, allowed)).toBe(false); expect(isAuthorizedSender(8, allowed)).toBe(false); expect(isAuthorizedSender(7, allowed)).toBe(true); });
  it("accepts supported safe names and normalizes the extension", () => expect(validateUpload("Policy.PDF", 100, 1_000)).toEqual({ filename: "Policy.PDF", fileType: "pdf" }));
  it.each(["", "../policy.pdf", "folder/policy.pdf", "folder\\policy.pdf", "bad\0.pdf"])("rejects unsafe filename %j", (filename) => expect(() => validateUpload(filename, 1, 100)).toThrow());
  it("rejects unsupported and oversized files before download", () => { expect(() => validateUpload("a.csv", 1, 100)).toThrow("Unsupported"); expect(() => validateUpload("a.txt", 101, 100)).toThrow("too large"); });
});

describe("document upload lifecycle", () => {
  it("downloads, indexes with trusted ownership, replies, and cleans up", async () => { const root = mkdtempSync(join(tmpdir(), "bot-upload-")); const replies: string[] = []; let indexedPath = ""; const inference = { indexDocument: vi.fn(async (userId: string, filename: string, fileType: string, path: string) => { expect([userId, filename, fileType]).toEqual(["trusted", "notes.txt", "txt"]); expect(existsSync(path)).toBe(true); indexedPath = path; return { filename, chunkCount: 1 }; }) } as unknown as InferenceClient; try { await processDocumentUpload({ token: "token", userId: "trusted", fileId: "file", filename: "notes.txt", knownSize: 4, inference, options: { documentTempDir: root, maxDocumentBytes: 10, documentTimeoutMs: 1_000, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("text")), createId: () => "unique" }, getRemotePath: async () => "remote", reply: async (text) => { replies.push(text); } }); expect(replies).toEqual(["📄 Document received.\n\nProcessing...", "✅ Document is ready.\n\nYou can now ask questions about it."]); expect(existsSync(indexedPath)).toBe(false); } finally { rmSync(root, { recursive: true, force: true }); } });
  it("uses a safe reply and cleans partial files after download errors", async () => { const root = mkdtempSync(join(tmpdir(), "bot-upload-")); const replies: string[] = []; try { await processDocumentUpload({ token: "token", userId: "trusted", fileId: "file", filename: "notes.txt", knownSize: 4, inference: { indexDocument: vi.fn() } as unknown as InferenceClient, options: { documentTempDir: root, maxDocumentBytes: 3, documentTimeoutMs: 1_000, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("oversized")), createId: () => "unique" }, getRemotePath: async () => "remote", reply: async (text) => { replies.push(text); } }); expect(replies.at(-1)).toBe("Document is too large."); expect(existsSync(join(root, "unique.upload"))).toBe(false); } finally { rmSync(root, { recursive: true, force: true }); } });
});

describe("splitTelegramMessage", () => {
  it("leaves a short response intact", () => {
    expect(splitTelegramMessage("short answer")).toEqual(["short answer"]);
  });

  it("splits long output without loss, duplication, or oversized chunks", () => {
    const response = `${"a".repeat(3000)}\n${"b".repeat(5000)}\nend`;
    const chunks = splitTelegramMessage(response);

    expect(chunks.join("")).toBe(response);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= TELEGRAM_MESSAGE_LIMIT)).toBe(
      true,
    );
    expect(chunks[0]?.endsWith("\n")).toBe(true);
  });

  it("splits an unbroken response at exactly the Telegram limit", () => {
    const response = "x".repeat(TELEGRAM_MESSAGE_LIMIT + 1);
    expect(splitTelegramMessage(response).map((chunk) => chunk.length)).toEqual([
      TELEGRAM_MESSAGE_LIMIT,
      1,
    ]);
  });
});
