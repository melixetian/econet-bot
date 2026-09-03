import { Bot } from "grammy";

export const HELP_TEXT =
  "Send me a text message and I will ask the local language model.";
export const INFERENCE_ERROR_TEXT =
  "The language model is temporarily unavailable. Please try again.";
export const TELEGRAM_MESSAGE_LIMIT = 4096;

export interface InferenceClient {
  request(prompt: string): Promise<string>;
}

export interface IncomingMessage {
  text?: unknown;
  entities?: ReadonlyArray<{ type: string; offset: number }>;
}

export function getInferencePrompt(message: IncomingMessage): string | null {
  if (typeof message.text !== "string" || message.text.trim().length === 0) {
    return null;
  }

  const beginsWithCommand =
    message.text.startsWith("/") ||
    message.entities?.some(
      (entity) => entity.type === "bot_command" && entity.offset === 0,
    ) === true;

  return beginsWithCommand ? null : message.text;
}

export function splitTelegramMessage(
  text: string,
  limit = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Message limit must be a positive integer");
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const newlineIndex = window.lastIndexOf("\n");
    let splitAt = newlineIndex >= 0 ? newlineIndex + 1 : limit;
    const previousCodeUnit = remaining.charCodeAt(splitAt - 1);
    const nextCodeUnit = remaining.charCodeAt(splitAt);
    if (
      splitAt > 1 &&
      previousCodeUnit >= 0xd800 &&
      previousCodeUnit <= 0xdbff &&
      nextCodeUnit >= 0xdc00 &&
      nextCodeUnit <= 0xdfff
    ) {
      splitAt -= 1;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

export function createBot(token: string, inference: InferenceClient): Bot {
  const bot = new Bot(token);

  bot.command(["start", "help"], async (context) => {
    await context.reply(HELP_TEXT);
  });

  bot.on("message:text", async (context) => {
    const prompt = getInferencePrompt(context.message);
    if (prompt === null) {
      return;
    }

    let response: string;
    try {
      response = await inference.request(prompt);
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "unknown error";
      console.error(`Inference request failed: ${diagnostic}`);
      await context.reply(INFERENCE_ERROR_TEXT);
      return;
    }

    for (const chunk of splitTelegramMessage(response)) {
      await context.reply(chunk);
    }
  });

  bot.catch(() => {
    console.error("Telegram update handling failed");
  });

  return bot;
}
