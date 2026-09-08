export type InferenceRequest =
  | { id: string; type: "chat"; conversationId: string; prompt: string }
  | { id: string; type: "reset"; conversationId: string };
export type InferenceResponse = { id: string; ok: true; text: string } | { id: string; ok: true } | { id: string; ok: false; error: string };
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
export function parseInferenceRequest(line: string): InferenceRequest | null {
  let value: unknown; try { value = JSON.parse(line); } catch { return null; }
  if (!isRecord(value) || !nonEmpty(value.id) || !nonEmpty(value.conversationId)) return null;
  if (value.type === "chat" && nonEmpty(value.prompt)) return { id: value.id, type: "chat", conversationId: value.conversationId, prompt: value.prompt };
  if (value.type === "reset" && !("prompt" in value)) return { id: value.id, type: "reset", conversationId: value.conversationId };
  return null;
}
export function parseInferenceResponse(line: string): InferenceResponse | null {
  let value: unknown; try { value = JSON.parse(line); } catch { return null; }
  if (!isRecord(value) || !nonEmpty(value.id) || typeof value.ok !== "boolean") return null;
  if (value.ok && typeof value.text === "string") return { id: value.id, ok: true, text: value.text };
  if (value.ok && !("text" in value)) return { id: value.id, ok: true };
  if (!value.ok && nonEmpty(value.error)) return { id: value.id, ok: false, error: value.error };
  return null;
}
export class JsonLineDecoder { private buffer = ""; push(chunk: string): string[] { this.buffer += chunk; const lines = this.buffer.split("\n"); this.buffer = lines.pop() ?? ""; return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line); } }
