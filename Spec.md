# Telegram LLM Bot — Implementation Specification

## 1. Goal

Build a minimal Telegram bot in TypeScript that accepts a text message, sends it to a local LLM through Ollama, and returns the generated text to the same Telegram chat.

Each message is an independent request. The application must not store or send conversation history.

## 2. Scope

### In scope

- Telegram Bot API integration using long polling.
- Text-message handling.
- Local Ollama inference using its HTTP API.
- A replaceable inference-provider abstraction.
- Inference execution in a process separate from the Telegram bot process.
- Environment-based configuration.
- Graceful user-facing error handling and shutdown.
- Automated unit tests for core behavior, supplied but not executed by the development agent.
- A concise README with setup and manual verification instructions.

### Out of scope

- Conversation memory, chat history, databases, caches, or persistent storage.
- Streaming partial responses to Telegram.
- Voice, image, video, document, callback-query, or command functionality beyond `/start` and `/help`.
- Webhooks, deployment, Docker, authentication beyond the Telegram bot token, rate limiting, observability platforms, or production hardening.
- Tool calling, RAG, embeddings, or agentic workflows.
- Automatic Ollama or model installation.

## 3. Required technology

- Node.js 20 or newer.
- TypeScript with strict type checking.
- npm.
- `grammy` for Telegram integration.
- Native `fetch` for Ollama HTTP calls; do not add an Ollama SDK.
- `dotenv` for local `.env` loading.
- Node's built-in `child_process` API for the inference worker.
- Vitest for unit tests.

Avoid adding dependencies that are not necessary for these requirements.

## 4. Process architecture

The application consists of two operating-system processes:

1. **Bot process** — receives Telegram updates, sends replies, manages request correlation, and owns the worker lifecycle.
2. **Inference worker process** — owns inference-provider selection and calls the selected provider.

The bot process starts one long-lived inference worker as a child process. They communicate only through newline-delimited JSON (JSONL): requests on the worker's stdin and responses on its stdout. The worker's stderr is reserved for logs. Neither process may write non-protocol output to the worker's stdout.

This separation is mandatory: the Telegram message handler must not import or call the Ollama provider directly.

### 4.1 IPC request

One JSON object per line:

```json
{"id":"unique-request-id","prompt":"user text"}
```

### 4.2 IPC success response

```json
{"id":"same-request-id","ok":true,"text":"model response"}
```

### 4.3 IPC error response

```json
{"id":"same-request-id","ok":false,"error":"safe diagnostic message"}
```

The bot process must correlate responses by `id`, support multiple pending requests, and enforce `LLM_TIMEOUT_MS` separately for each request. Malformed protocol messages must be logged to stderr and ignored without crashing the bot.

If the worker exits, all pending requests must fail. The worker may be restarted lazily when the next user message arrives. Shutdown must reject pending requests and terminate the worker.

## 5. Inference plugin contract

Define a minimal interface independent of Telegram and Ollama:

```ts
export interface InferenceProvider {
  generate(prompt: string, signal?: AbortSignal): Promise<string>;
}
```

Provider selection belongs only to the inference worker and is controlled by `INFERENCE_PROVIDER`. Use an explicit provider factory or registry. The default and initially supported value is `ollama`. An unknown value must cause a clear startup/configuration error in the worker.

Adding another model backend must require only:

1. implementing `InferenceProvider`; and
2. registering it in the provider factory.

No Telegram-specific type or logic may appear in the provider layer.

## 6. Ollama provider

Call:

- method: `POST`
- URL: `${OLLAMA_BASE_URL}/api/generate`
- header: `Content-Type: application/json`
- body:

```json
{
  "model": "<OLLAMA_MODEL>",
  "prompt": "<the current Telegram message only>",
  "stream": false
}
```

Read the generated answer from the response's `response` string.

The provider must:

- never send earlier Telegram messages or model replies;
- handle connection failures, timeouts, non-2xx responses, invalid JSON, and a missing/non-string `response` field;
- return a non-empty string or throw an `Error`;
- avoid logging prompts, generated text, tokens, or secrets.

Do not add a system prompt unless this specification is changed.

## 7. Telegram behavior

### 7.1 Text messages

For every non-empty text message that is not a command:

1. send exactly that message text as the prompt for a new inference request;
2. await the matching worker response;
3. send the generated text back to the originating chat.

Requests from different messages must remain independent, including messages from the same chat.

While inference is running, sending the `typing` chat action is allowed but not required.

### 7.2 Commands

- `/start` and `/help` return a short description such as: `Send me a text message and I will ask the local language model.`
- Commands must not be sent to the LLM.

### 7.3 Unsupported or invalid input

- Ignore non-text updates without calling the LLM.
- Ignore text containing only whitespace.
- Do not use Telegram parse mode for model output.

### 7.4 Long responses

Telegram text messages are limited to 4096 characters. Split longer model output into ordered chunks of at most 4096 characters, preferring the last newline within the limit when practical. Do not lose, duplicate, or reorder content.

### 7.5 Errors

On inference failure or timeout, reply once with a stable user-facing message:

`The language model is temporarily unavailable. Please try again.`

Log a concise diagnostic to stderr without exposing `TELEGRAM_BOT_TOKEN`, prompts, or model responses.

## 8. Configuration

Load configuration from environment variables. `.env` is for local development only.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | none | Telegram bot token |
| `INFERENCE_PROVIDER` | no | `ollama` | Provider selected by the worker |
| `OLLAMA_BASE_URL` | no | `http://127.0.0.1:11434` | Ollama server base URL |
| `OLLAMA_MODEL` | no | `qwen3:1.7b` | Ollama model name |
| `LLM_TIMEOUT_MS` | no | `60000` | Positive integer request timeout in milliseconds |

Validate configuration early. The bot process must fail before polling if `TELEGRAM_BOT_TOKEN` is absent. Reject invalid URLs and non-positive or non-integer timeout values with clear messages.

Provide `.env.example` containing placeholders/defaults but no real secrets. `.gitignore` must include `.env`, `node_modules/`, `dist/`, and coverage output.

## 9. Suggested project structure

The exact filenames may vary slightly, but dependency direction and responsibilities must remain equivalent:

```text
src/
  bot.ts
  config.ts
  index.ts
  inference/
    client.ts
    protocol.ts
    worker.ts
    providers/
      provider.ts
      factory.ts
      ollama.ts
tests/
  ...
.env.example
.gitignore
package.json
tsconfig.json
vitest.config.ts
README.md
```

`index.ts` is the bot-process entry point. `worker.ts` is the inference-process entry point.

## 10. Scripts

Define at least these npm scripts:

- `build` — compile TypeScript;
- `start` — run the compiled bot process, which starts the compiled worker;
- `dev` — run locally from TypeScript while preserving the separate worker process;
- `typecheck` — type-check without emitting files;
- `test` — run unit tests once.

The implementation must not rely on shell-specific syntax in npm scripts.

## 11. Tests

Write focused unit tests for logic that does not require real Telegram or Ollama access:

- Ollama request body uses one prompt and `stream: false`;
- Ollama success parsing and representative failure handling;
- provider selection and unknown-provider rejection;
- JSONL request/response parsing and correlation;
- per-request timeout behavior;
- response splitting, including a response longer than 4096 characters;
- empty/whitespace and non-text messages do not trigger inference, if message-routing logic is extracted into a testable unit.

Mock network and process boundaries. Tests must not require a Telegram token, a running bot, a running Ollama instance, or a downloaded model.

The development agent must create the tests but must not run them. It also must not start the bot, worker, or Ollama. The user will execute commands and return output if debugging is needed.

## 12. README requirements

Document:

1. prerequisites: Node.js 20+, Ollama, a Telegram bot token, and the configured model;
2. installation with `npm install`;
3. copying `.env.example` to `.env` and setting `TELEGRAM_BOT_TOKEN`;
4. pulling the model, for example `ollama pull qwen3:1.7b`;
5. starting Ollama if required by the platform;
6. development and compiled start commands;
7. test and type-check commands;
8. the two-process architecture and how to add another inference provider;
9. the explicit no-memory behavior;
10. a warning that `.env` must not be committed.

## 13. Acceptance criteria

The implementation is complete when all of the following are true:

- With valid configuration and Ollama running, a Telegram text message produces a reply generated from that message alone.
- A second message does not include or depend on the first exchange.
- `/start` and `/help` return help text without inference.
- Non-text and whitespace-only input does not call inference.
- Long model output is delivered completely in valid Telegram-sized chunks.
- Ollama is accessed only by the inference worker through the provider interface.
- The Telegram process and inference worker are distinct OS processes using the defined JSONL protocol.
- Provider selection is configuration-driven and a new provider can be added without changing Telegram code.
- Failures result in one safe Telegram message and a secret-free diagnostic.
- No credential is present in tracked source; `.env` is ignored and `.env.example` is safe.
- The repository contains the required scripts, tests, and README.
- No test suite or service was run by the development agent; validation commands are handed to the user to execute.

## 14. Implementation constraints

- Prefer the smallest implementation that satisfies this specification.
- Do not introduce frameworks, dependency injection containers, databases, queues, Docker, or generic abstractions beyond the provider boundary and worker protocol.
- Do not expand the product scope.
- Never commit or print the Telegram token.

