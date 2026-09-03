# Telegram LLM Bot

A minimal Telegram bot that sends each text message independently to a local
Ollama model and replies with the generated text.

## Prerequisites

- Node.js 20 or newer and npm
- [Ollama](https://ollama.com/) installed
- A Telegram bot token obtained from BotFather
- The configured Ollama model (the default is `qwen3:1.7b`)

## Setup

Install dependencies:

```sh
npm install
```

Copy the example environment file and add your Telegram token:

```sh
cp .env.example .env
```

```dotenv
TELEGRAM_BOT_TOKEN=your-real-token
INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:1.7b
LLM_TIMEOUT_MS=60000
```

Never commit `.env`; it contains a secret and is intentionally ignored by Git.

Pull the configured model:

```sh
ollama pull qwen3:1.7b
```

Start Ollama if your platform does not already run it as a background service:

```sh
ollama serve
```

## Run and verify

For development, run the TypeScript entry point:

```sh
npm run dev
```

For a compiled run:

```sh
npm run build
npm start
```

Then send the bot `/start` or `/help`, followed by a normal text message. The
commands return help without invoking Ollama. A normal message should receive a
model-generated reply. Non-text updates and whitespace-only messages are ignored.

Run static type checking and the unit tests with:

```sh
npm run typecheck
npm test
```

Tests mock network and process boundaries; they do not need a Telegram token,
Ollama process, or downloaded model.

## Architecture

The bot and inference worker are separate, long-lived operating-system processes.
The bot owns Telegram long polling and the worker lifecycle. It sends independent
requests over JSONL on the worker's standard input and correlates JSONL responses
from standard output. Provider logs use standard error so they cannot corrupt the
protocol. Each request has its own timeout, and the next request lazily restarts a
worker that exited.

The application deliberately has no conversation memory, database, cache, or
persistent storage. Only the current Telegram message is sent as an Ollama prompt;
earlier messages and model replies are never included.

Ollama thinking output is disabled for predictable response time on local CPU
hardware; the bot returns only the model's final answer.

To add an inference backend, implement `InferenceProvider` in
`src/inference/providers/provider.ts`, add the provider implementation under that
directory, and register it in `src/inference/providers/factory.ts`. Provider
selection remains confined to the worker and is controlled by
`INFERENCE_PROVIDER`.
