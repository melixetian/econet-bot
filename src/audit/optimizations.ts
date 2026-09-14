import type { StoredMessage } from "../history/sqlite-history.js";
import type { ChatMessage } from "../inference/providers/provider.js";
import { estimateTokens } from "./metrics.js";

export function selectHistory(history: readonly StoredMessage[], tokenBudget: number): StoredMessage[] {
  const exchanges: StoredMessage[][] = [];
  for (let index = history.length - 1; index > 0;) {
    const assistant = history[index];
    const user = history[index - 1];
    if (user?.role === "user" && assistant?.role === "assistant") { exchanges.unshift([user, assistant]); index -= 2; }
    else index -= 1;
  }
  const retained: StoredMessage[][] = [];
  let tokens = 0;
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const exchange = exchanges[index]!;
    const cost = exchange.reduce((sum, message) => sum + estimateTokens(message), 0);
    if (tokens + cost > tokenBudget) continue;
    retained.unshift(exchange);
    tokens += cost;
  }
  return retained.flat();
}

function clip(value: string, budget: number): string {
  if (value.length <= budget) return value;
  const marker = `...[truncated ${value.length}c/${Buffer.byteLength(value, "utf8")}b]...`;
  if (budget <= marker.length) return marker.slice(0, Math.max(0, budget));
  const available = Math.max(0, budget - marker.length);
  const prefix = Math.ceil(available / 2);
  return `${value.slice(0, prefix)}${marker}${value.slice(value.length - (available - prefix))}`;
}

export function compactExecOutput(content: string, maxChars: number): { content: string; compacted: boolean } {
  if (content.length <= maxChars) return { content, compacted: false };
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return { content: clip(content, maxChars), compacted: true }; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { content: clip(content, maxChars), compacted: true };
  const result = { ...(parsed as Record<string, unknown>) };
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const fixed = JSON.stringify({ ...result, stdout: "", stderr: "", modelOutputCompacted: true, originalChars: content.length, originalBytes: Buffer.byteLength(content, "utf8") }).length;
  let low = 0, high = Math.max(0, maxChars - fixed);
  const total = Math.max(1, stdout.length + stderr.length);
  result.modelOutputCompacted = true;
  result.originalChars = content.length;
  result.originalBytes = Buffer.byteLength(content, "utf8");
  let serialized = JSON.stringify({ ...result, stdout: "", stderr: "" });
  // Search the serialized budget: quotes/control characters may expand up to
  // sixfold in JSON. Subtracting the entire excess could erase both ends.
  while (low <= high) {
    const available = Math.floor((low + high) / 2);
    let outBudget = Math.floor(available * stdout.length / total), errBudget = available - outBudget;
    if (stderr.length <= available / 2) { errBudget = stderr.length; outBudget = available - errBudget; }
    else if (stdout.length <= available / 2) { outBudget = stdout.length; errBudget = available - outBudget; }
    result.stdout = clip(stdout, outBudget);
    result.stderr = clip(stderr, errBudget);
    const candidate = JSON.stringify(result);
    if (candidate.length <= maxChars) { serialized = candidate; low = available + 1; }
    else high = available - 1;
  }
  return { content: serialized, compacted: true };
}

type SearchResult = { text: string; filename: string; pageNumber?: number; chunkIndex: number; [key: string]: unknown };
function exactOverlap(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  for (let length = limit; length > 0; length -= 1) if (left.endsWith(right.slice(0, length))) return length;
  return 0;
}

export function compactRagOverlap(content: string, maxChars = Infinity): { content: string; compacted: boolean } {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return { content, compacted: false }; }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { results?: unknown }).results)) return { content, compacted: false };
  const source = parsed as { results: unknown[]; [key: string]: unknown };
  if (!source.results.every((item) => typeof item === "object" && item !== null && typeof (item as SearchResult).text === "string" && typeof (item as SearchResult).filename === "string" && Number.isSafeInteger((item as SearchResult).chunkIndex))) return { content, compacted: false };
  const results = source.results.map((item) => typeof item === "object" && item !== null ? { ...(item as Record<string, unknown>) } : item);
  let compacted = false;
  for (let index = 1; index < results.length; index += 1) {
    const previous = source.results[index - 1] as SearchResult | undefined;
    const current = results[index] as SearchResult | undefined;
    if (!previous || !current || typeof previous.text !== "string" || typeof current.text !== "string") continue;
    const sameSource = previous.filename === current.filename;
    const adjacent = current.chunkIndex === previous.chunkIndex + 1;
    if (!sameSource || !adjacent || previous.pageNumber !== current.pageNumber) continue;
    const overlap = exactOverlap(previous.text, current.text);
    const marker = `[overlap omitted: ${overlap} chars]`;
    if (overlap <= marker.length) continue;
    current.text = `${marker}${current.text.slice(overlap)}`;
    compacted = true;
  }
  let used = 0;
  let keep = 0;
  for (const result of results as SearchResult[]) {
    // Keep the complete highest-ranked evidence even if a runtime-configured
    // chunk is larger than the optional secondary cap.
    if (keep > 0 && used + result.text.length > maxChars) break;
    used += result.text.length;
    keep += 1;
  }
  const omitted = results.length - keep;
  compacted ||= omitted > 0;
  return compacted ? { content: JSON.stringify({ ...source, results: results.slice(0, keep), omittedResults: Number(source.omittedResults ?? 0) + omitted }), compacted: true } : { content, compacted: false };
}

function receipt(message: Extract<ChatMessage, { role: "tool" }>, toolName: string): ChatMessage {
  let status = "unknown";
  let resultCount: number | undefined;
  let truncated = false;
  const execution: Record<string, number | boolean | null> = {};
  let sources: Array<{ filename: string; pageNumber?: number; chunkIndex?: number }> | undefined;
  try {
    const value = JSON.parse(message.content) as Record<string, unknown>;
    status = typeof value.status === "string" ? value.status : value.ok === true ? "ok" : value.ok === false ? "error" : "unknown";
    resultCount = Array.isArray(value.results) ? value.results.length : undefined;
    if (Array.isArray(value.results)) sources = value.results.flatMap((result) => {
      if (typeof result !== "object" || result === null || typeof (result as Record<string, unknown>).filename !== "string") return [];
      const source = result as Record<string, unknown>;
      return [{ filename: source.filename as string, ...(typeof source.pageNumber === "number" ? { pageNumber: source.pageNumber } : {}), ...(typeof source.chunkIndex === "number" ? { chunkIndex: source.chunkIndex } : {}) }];
    });
    truncated = value.truncated === true || value.modelOutputCompacted === true;
    if (value.exitCode === null || typeof value.exitCode === "number") execution.exitCode = value.exitCode;
    for (const key of ["timedOut", "aborted"]) if (typeof value[key] === "boolean") execution[key] = value[key];
  } catch { /* content is intentionally discarded */ }
  return { role: "tool", toolCallId: message.toolCallId, content: JSON.stringify({ tool: toolName, status, ...execution, ...(resultCount === undefined ? {} : { resultCount }), ...(sources?.length ? { sources } : {}), truncated, receipt: "full output seen previously" }) };
}

export function compactOldToolResults(messages: readonly ChatMessage[]): ChatMessage[] {
  const rounds = messages.flatMap((message, index) => message.role === "assistant" && message.toolCalls?.length ? [index] : []);
  if (rounds.length < 2) return [...messages];
  const newest = rounds.at(-1)!;
  const evidence = (content: string): string[] => {
    try {
      const value = JSON.parse(content) as Record<string, unknown>;
      return [
        ...["stdout", "stderr", "error"].flatMap((key) => typeof value[key] === "string" && value[key] ? [value[key] as string] : []),
        ...(Array.isArray(value.results) ? value.results.flatMap((row) => typeof row?.text === "string" ? [row.text as string] : []) : []),
      ];
    } catch { return [content]; }
  };
  const fresh = messages.slice(newest + 1).filter((message) => message.role === "tool").flatMap((message) => evidence(message.content));
  const names = new Map<string, string>();
  return messages.map((message, index) => {
    if (message.role === "assistant") for (const call of message.toolCalls ?? []) names.set(call.id, call.name === "exec" || call.name === "search_documents" ? call.name : "unknown");
    if (message.role !== "tool" || index >= newest) return message;
    // Never erase unique earlier answer evidence. Only receipt bodies whose
    // evidence is still verbatim in the newest round (or have no text evidence).
    if (!evidence(message.content).every((text) => fresh.some((latest) => latest.includes(text)))) return message;
    const replacement = receipt(message, names.get(message.toolCallId) ?? "unknown");
    return replacement.content.length < message.content.length ? replacement : message;
  });
}
