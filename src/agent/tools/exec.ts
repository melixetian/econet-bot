import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { ToolCall, ToolDefinition } from "../../inference/providers/provider.js";
const MAX_OUTPUT_BYTES = 32 * 1024;
export const EXEC_TOOL: ToolDefinition = { type: "function", function: { name: "exec", description: "Run one shell command when external data or a real system action is required.", parameters: { type: "object", additionalProperties: false, required: ["command"], properties: { command: { type: "string", description: "The shell command to run." } } } } };
function safeEnvironment(): NodeJS.ProcessEnv { const env: NodeJS.ProcessEnv = {}; for (const key of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP", "SystemRoot", "ComSpec"]) if (process.env[key]) env[key] = process.env[key]; return env; }
function result(data: Record<string, unknown>): string { return JSON.stringify(data); }
export function validateExecToolCall(call: ToolCall): string | null {
  if (call.name !== "exec") return "Unknown tool";
  if (typeof call.arguments !== "object" || call.arguments === null || Array.isArray(call.arguments) || Object.keys(call.arguments).length !== 1 || typeof (call.arguments as Record<string, unknown>).command !== "string") return "exec requires exactly one command string";
  const command = (call.arguments as Record<string, unknown>).command as string;
  return command.trim().length === 0 || command.includes("\0") ? "exec requires a non-empty command without NUL bytes" : null;
}
export async function executeToolCall(call: ToolCall, workspaceDir: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const validationError = validateExecToolCall(call);
  if (validationError) return result({ ok: false, error: validationError });
  const command = (call.arguments as Record<string, unknown>).command as string;
  await mkdir(workspaceDir, { recursive: true });
  return new Promise((resolve) => {
    const started = Date.now(); let stdout = ""; let stderr = ""; let truncated = false; let timedOut = false; let settled = false;
    const append = (target: "stdout" | "stderr", chunk: Buffer | string) => { const text = chunk.toString(); const current = Buffer.byteLength(stdout) + Buffer.byteLength(stderr); const remaining = MAX_OUTPUT_BYTES - current; if (remaining <= 0) { truncated = true; return; } const bytes = Buffer.from(text); const kept = bytes.subarray(0, remaining).toString(); if (target === "stdout") stdout += kept; else stderr += kept; if (bytes.length > remaining) truncated = true; };
    let child; try { child = spawn(command, { shell: true, cwd: workspaceDir, env: safeEnvironment(), stdio: ["ignore", "pipe", "pipe"] }); } catch { resolve(result({ ok: false, error: "Could not start command" })); return; }
    const stop = (timeout: boolean) => { timedOut ||= timeout; child.kill("SIGTERM"); };
    const timer = setTimeout(() => stop(true), timeoutMs); const aborted = () => stop(false); signal?.addEventListener("abort", aborted, { once: true });
    child.stdout.on("data", (chunk) => append("stdout", chunk)); child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", () => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener("abort", aborted); resolve(result({ ok: false, error: "Could not start command" })); } });
    child.once("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", aborted); const abortedRun = signal?.aborted === true; console.error(`exec finished: duration_ms=${Date.now() - started} exit_code=${code ?? "null"} timed_out=${timedOut}`); resolve(result({ ok: code === 0 && !timedOut && !abortedRun, exitCode: code, timedOut, aborted: abortedRun, truncated, stdout, stderr })); });
  });
}
