import "dotenv/config";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createBot } from "./bot.js";
import { loadBotConfig } from "./config.js";
import {
  createNodeWorkerFactory,
  InferenceWorkerClient,
} from "./inference/client.js";

async function main(): Promise<void> {
  const config = loadBotConfig();
  const sourceExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const workerPath = fileURLToPath(
    new URL(`./inference/worker.${sourceExtension}`, import.meta.url),
  );
  const workerRunnerArguments =
    sourceExtension === "ts"
      ? [createRequire(import.meta.url).resolve("tsx/cli")]
      : [];
  const inference = new InferenceWorkerClient(
    createNodeWorkerFactory(workerPath, workerRunnerArguments),
    config.agentTimeoutMs,
    config.documentTimeoutMs,
  );
  const bot = createBot(config.telegramBotToken, config.allowedTelegramUserIds, inference, { documentTempDir: config.documentTempDir, maxDocumentBytes: config.maxDocumentBytes, documentTimeoutMs: config.documentTimeoutMs });
  let stopping = false;

  const shutdown = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    inference.shutdown();
    await bot.stop();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  inference.start();
  try {
    await bot.start();
  } finally {
    inference.shutdown();
  }
}

main().catch((error: unknown) => {
  const rawDiagnostic = error instanceof Error ? error.message : "unknown error";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const diagnostic = token
    ? rawDiagnostic.replaceAll(token, "[redacted]")
    : rawDiagnostic;
  console.error(`Application failed: ${diagnostic}`);
  process.exitCode = 1;
});
