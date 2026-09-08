import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { JsonLineDecoder, parseInferenceResponse } from "./protocol.js";
export interface WorkerHandle { write(line: string, callback: (error?: Error | null) => void): void; endInput(): void; kill(): void; stdout: EventEmitter; stderr: EventEmitter; events: EventEmitter; }
export type WorkerFactory = () => WorkerHandle;
interface PendingRequest { resolve: (text: string | undefined) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; }
const TRANSPORT_GRACE_MS = 5_000;
export function createNodeWorkerFactory(workerPath: string, nodeArguments: readonly string[] = []): WorkerFactory { return () => { const child = spawn(process.execPath, [...nodeArguments, workerPath], { stdio: ["pipe", "pipe", "pipe"], env: process.env }); return { write: (line, callback) => child.stdin.write(line, callback), endInput: () => child.stdin.end(), kill: () => child.kill("SIGTERM"), stdout: child.stdout, stderr: child.stderr, events: child }; }; }
export class InferenceWorkerClient {
  private worker: WorkerHandle | undefined; private readonly pending = new Map<string, PendingRequest>(); private shuttingDown = false;
  constructor(private readonly workerFactory: WorkerFactory, private readonly agentTimeoutMs: number, private readonly createId: () => string = randomUUID) {}
  start(): void { if (this.shuttingDown) throw new Error("Inference client is shutting down"); this.ensureWorker(); }
  request(conversationId: string, prompt: string): Promise<string> { return this.send({ type: "chat", conversationId, prompt }).then((text) => { if (text === undefined) throw new Error("Inference worker returned an invalid chat response"); return text; }); }
  reset(conversationId: string): Promise<void> { return this.send({ type: "reset", conversationId }).then(() => undefined); }
  shutdown(): void { if (this.shuttingDown) return; this.shuttingDown = true; this.failAll(new Error("Inference client shut down")); const worker = this.worker; this.worker = undefined; if (worker) { worker.endInput(); worker.kill(); } }
  private send(payload: { type: "chat"; conversationId: string; prompt: string } | { type: "reset"; conversationId: string }): Promise<string | undefined> {
    if (this.shuttingDown) return Promise.reject(new Error("Inference client is shutting down")); const worker = this.ensureWorker(); const id = this.createId();
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error("Inference request timed out")); }, this.agentTimeoutMs + TRANSPORT_GRACE_MS); this.pending.set(id, { resolve, reject, timer }); worker.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => { if (error) this.rejectPending(id, new Error("Could not send request to inference worker")); }); });
  }
  private ensureWorker(): WorkerHandle { if (this.worker) return this.worker; const worker = this.workerFactory(); this.worker = worker; const decoder = new JsonLineDecoder(); worker.stdout.on("data", (chunk: Buffer | string) => { for (const line of decoder.push(chunk.toString())) this.handleResponseLine(line); }); worker.stderr.on("data", (chunk: Buffer | string) => { const diagnostic = chunk.toString().trim(); if (diagnostic) console.error(`Inference worker: ${diagnostic}`); }); worker.events.once("error", () => this.handleWorkerExit(worker, new Error("Inference worker failed"))); worker.events.once("exit", () => this.handleWorkerExit(worker, new Error("Inference worker exited"))); return worker; }
  private handleResponseLine(line: string): void { const response = parseInferenceResponse(line); if (!response) { console.error("Ignored malformed inference worker response"); return; } const pending = this.pending.get(response.id); if (!pending) return; this.pending.delete(response.id); clearTimeout(pending.timer); if (response.ok) pending.resolve("text" in response ? response.text : undefined); else pending.reject(new Error(response.error)); }
  private rejectPending(id: string, error: Error): void { const pending = this.pending.get(id); if (!pending) return; this.pending.delete(id); clearTimeout(pending.timer); pending.reject(error); }
  private handleWorkerExit(worker: WorkerHandle, error: Error): void { if (this.worker !== worker) return; this.worker = undefined; this.failAll(error); }
  private failAll(error: Error): void { for (const [id] of this.pending) this.rejectPending(id, error); }
}
