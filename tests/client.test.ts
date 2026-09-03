import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InferenceWorkerClient,
  type WorkerHandle,
} from "../src/inference/client.js";

class FakeWorker implements WorkerHandle {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly events = new EventEmitter();
  readonly writes: string[] = [];
  ended = false;
  killed = false;

  write(line: string, callback: (error?: Error | null) => void): void {
    this.writes.push(line);
    callback();
  }

  endInput(): void {
    this.ended = true;
  }

  kill(): void {
    this.killed = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("InferenceWorkerClient", () => {
  it("correlates concurrent responses by id", async () => {
    const worker = new FakeWorker();
    const ids = ["request-1", "request-2"];
    const client = new InferenceWorkerClient(
      () => worker,
      1000,
      () => ids.shift()!,
    );

    const first = client.request("first prompt");
    const second = client.request("second prompt");
    expect(worker.writes.map((line) => JSON.parse(line))).toEqual([
      { id: "request-1", prompt: "first prompt" },
      { id: "request-2", prompt: "second prompt" },
    ]);

    worker.stdout.emit(
      "data",
      '{"id":"request-2","ok":true,"text":"second answer"}\n',
    );
    worker.stdout.emit(
      "data",
      '{"id":"request-1","ok":true,"text":"first answer"}\n',
    );

    await expect(first).resolves.toBe("first answer");
    await expect(second).resolves.toBe("second answer");
    client.shutdown();
  });

  it("times each request out independently", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new InferenceWorkerClient(() => worker, 50, () => "request-1");

    const result = client.request("prompt");
    const assertion = expect(result).rejects.toThrow("Inference request timed out");
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    client.shutdown();
  });

  it("ignores malformed responses and accepts a later valid response", async () => {
    const worker = new FakeWorker();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = new InferenceWorkerClient(() => worker, 1000, () => "request-1");

    const result = client.request("prompt");
    worker.stdout.emit("data", "not-json\n");
    worker.stdout.emit(
      "data",
      '{"id":"request-1","ok":true,"text":"answer"}\n',
    );

    await expect(result).resolves.toBe("answer");
    expect(console.error).toHaveBeenCalledWith(
      "Ignored malformed inference worker response",
    );
    client.shutdown();
  });

  it("fails pending requests on exit and restarts lazily", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const ids = ["request-1", "request-2"];
    const client = new InferenceWorkerClient(
      () => workers.shift()!,
      1000,
      () => ids.shift()!,
    );

    const first = client.request("first");
    const firstAssertion = expect(first).rejects.toThrow("Inference worker exited");
    firstWorker.events.emit("exit", 1);
    await firstAssertion;

    const second = client.request("second");
    expect(secondWorker.writes).toHaveLength(1);
    secondWorker.stdout.emit(
      "data",
      '{"id":"request-2","ok":true,"text":"recovered"}\n',
    );
    await expect(second).resolves.toBe("recovered");
    client.shutdown();
  });

  it("rejects pending requests and terminates the worker on shutdown", async () => {
    const worker = new FakeWorker();
    const client = new InferenceWorkerClient(() => worker, 1000, () => "request-1");

    const result = client.request("prompt");
    const assertion = expect(result).rejects.toThrow("Inference client shut down");
    client.shutdown();

    await assertion;
    expect(worker.ended).toBe(true);
    expect(worker.killed).toBe(true);
  });
});
