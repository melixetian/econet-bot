import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { InferenceWorkerClient, type WorkerHandle } from "../src/inference/client.js";

class FakeWorker implements WorkerHandle { stdout = new EventEmitter(); stderr = new EventEmitter(); events = new EventEmitter(); writes: string[] = []; write(line: string, cb: (error?: Error | null) => void) { this.writes.push(line); cb(); } endInput() {} kill() {} }
describe("client", () => {
  it("correlates chat, reset, index, list, and delete requests", async () => {
    const worker = new FakeWorker(); const ids = ["a", "b", "c", "d", "e"]; const client = new InferenceWorkerClient(() => worker, 1_000, 2_000, () => ids.shift()!);
    const chat = client.request("conversation", "user", "hello"); const reset = client.reset("conversation"); const index = client.indexDocument("user", "a.txt", "txt", "/tmp/a"); const list = client.listDocuments("user"); const remove = client.deleteDocument("user", "a.txt");
    expect(worker.writes.map((line) => JSON.parse(line))).toEqual([
      { id: "a", type: "chat", conversationId: "conversation", userId: "user", prompt: "hello" }, { id: "b", type: "reset", conversationId: "conversation" },
      { id: "c", type: "index_document", userId: "user", filename: "a.txt", fileType: "txt", tempPath: "/tmp/a" }, { id: "d", type: "list_documents", userId: "user" }, { id: "e", type: "delete_document", userId: "user", filename: "a.txt" },
    ]);
    worker.stdout.emit("data", '{"id":"a","ok":true,"type":"chat","text":"ok"}\n{"id":"b","ok":true,"type":"reset"}\n{"id":"c","ok":true,"type":"index_document","document":{"filename":"a.txt","chunkCount":1}}\n{"id":"d","ok":true,"type":"list_documents","documents":[{"filename":"a.txt","fileType":"txt","createdAt":"now"}]}\n{"id":"e","ok":true,"type":"delete_document","deleted":true}\n');
    await expect(chat).resolves.toBe("ok"); await expect(reset).resolves.toBeUndefined(); await expect(index).resolves.toEqual({ filename: "a.txt", chunkCount: 1 }); await expect(list).resolves.toHaveLength(1); await expect(remove).resolves.toBe(true); client.shutdown();
  });
});
