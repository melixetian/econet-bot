import { describe, expect, it } from "vitest";
import { loadBotConfig, loadWorkerConfig } from "../src/config.js";
describe("configuration", () => {
  it("requires token and allowlist", () => { expect(() => loadBotConfig({})).toThrow("TELEGRAM_BOT_TOKEN is required"); expect(() => loadBotConfig({ TELEGRAM_BOT_TOKEN: "x" })).toThrow("ALLOWED_TELEGRAM_USER_IDS is required"); });
  it("deduplicates allowed senders", () => expect([...loadBotConfig({ TELEGRAM_BOT_TOKEN: "x", ALLOWED_TELEGRAM_USER_IDS: "1, 2, 1" }).allowedTelegramUserIds]).toEqual(["1", "2"]));
  it("uses agent defaults and validates limits", () => { expect(loadWorkerConfig({}).agentMaxSteps).toBe(5); expect(() => loadWorkerConfig({ AGENT_MAX_STEPS: "11" })).toThrow("AGENT_MAX_STEPS must be an integer from 1 to 10"); });
});
