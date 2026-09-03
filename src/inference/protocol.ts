export interface InferenceRequest {
  id: string;
  prompt: string;
}

export type InferenceResponse =
  | { id: string; ok: true; text: string }
  | { id: string; ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseInferenceRequest(line: string): InferenceRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.prompt !== "string"
  ) {
    return null;
  }
  return { id: value.id, prompt: value.prompt };
}

export function parseInferenceResponse(line: string): InferenceResponse | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.ok !== "boolean"
  ) {
    return null;
  }

  if (value.ok === true && typeof value.text === "string") {
    return { id: value.id, ok: true, text: value.text };
  }
  if (value.ok === false && typeof value.error === "string") {
    return { id: value.id, ok: false, error: value.error };
  }
  return null;
}

export class JsonLineDecoder {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  }
}
