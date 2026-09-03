import { describe, expect, it } from "vitest";
import {
  getInferencePrompt,
  splitTelegramMessage,
  TELEGRAM_MESSAGE_LIMIT,
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
