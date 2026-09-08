import { Bot } from "grammy";
export const HELP_TEXT = "I remember this chat. Send /new to start over. I can answer directly or use tools for fresh information and actions.";
export const INFERENCE_ERROR_TEXT = "The language model is temporarily unavailable. Please try again.";
export const ACCESS_DENIED_TEXT = "Access denied.";
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export interface InferenceClient { request(conversationId: string, prompt: string): Promise<string>; reset(conversationId: string): Promise<void>; }
export interface IncomingMessage { text?: unknown; entities?: ReadonlyArray<{ type: string; offset: number }>; }
export function getInferencePrompt(message: IncomingMessage): string | null { if (typeof message.text !== "string" || message.text.trim().length === 0) return null; const beginsWithCommand = message.text.startsWith("/") || message.entities?.some((entity) => entity.type === "bot_command" && entity.offset === 0) === true; return beginsWithCommand ? null : message.text; }
export function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] { if (!Number.isInteger(limit) || limit <= 0) throw new Error("Message limit must be a positive integer"); const chunks: string[] = []; let remaining = text; while (remaining.length > limit) { const window = remaining.slice(0, limit); let splitAt = window.lastIndexOf("\n"); splitAt = splitAt >= 0 ? splitAt + 1 : limit; if (splitAt > 1 && remaining.charCodeAt(splitAt - 1) >= 0xd800 && remaining.charCodeAt(splitAt - 1) <= 0xdbff && remaining.charCodeAt(splitAt) >= 0xdc00 && remaining.charCodeAt(splitAt) <= 0xdfff) splitAt -= 1; chunks.push(remaining.slice(0, splitAt)); remaining = remaining.slice(splitAt); } if (remaining.length > 0) chunks.push(remaining); return chunks; }
export function createBot(token: string, allowedUserIds: ReadonlySet<string>, inference: InferenceClient): Bot {
  const bot = new Bot(token); bot.use(async (context, next) => { if (!context.from || !allowedUserIds.has(String(context.from.id))) { await context.reply(ACCESS_DENIED_TEXT); return; } await next(); });
  bot.command(["start", "help"], async (context) => { await context.reply(HELP_TEXT); });
  bot.command("new", async (context) => { try { await inference.reset(String(context.chat.id)); await context.reply("Started a new chat."); } catch { console.error("Inference reset failed"); await context.reply(INFERENCE_ERROR_TEXT); } });
  bot.on("message:text", async (context) => { const prompt = getInferencePrompt(context.message); if (prompt === null) return; try { const response = await inference.request(String(context.chat.id), prompt); for (const chunk of splitTelegramMessage(response)) await context.reply(chunk); } catch { console.error("Inference request failed"); await context.reply(INFERENCE_ERROR_TEXT); } });
  bot.catch(() => { console.error("Telegram update handling failed"); }); return bot;
}
