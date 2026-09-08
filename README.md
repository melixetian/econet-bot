# Econet Bot

A minimal TypeScript Telegram AI agent backed by a local Ollama model. It keeps a separate conversation per Telegram chat, can start over with `/new`, and can use one `exec` shell tool for fresh data or explicitly authorized actions.

## Prerequisites and setup

- Node.js 20+ and npm
- [Ollama](https://ollama.com/) with a model that supports native tool calling (the default is `qwen3:1.7b`)
- A Telegram bot token from BotFather
- Your Telegram numeric user ID. Send a message to a bot such as `@userinfobot`, or inspect an update through Telegram's Bot API; do not use a username.

```sh
npm install
cp .env.example .env
ollama pull qwen3:1.7b
```

Set `TELEGRAM_BOT_TOKEN` and a comma-separated `ALLOWED_TELEGRAM_USER_IDS` list in `.env`. The allowlist is mandatory and is checked against message sender IDs, not chat IDs.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | none | Required Telegram token |
| `ALLOWED_TELEGRAM_USER_IDS` | none | Required authorized sender IDs |
| `INFERENCE_PROVIDER` | `ollama` | Worker-side provider |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama service URL |
| `OLLAMA_MODEL` | `qwen3:1.7b` | Tool-capable local model |
| `LLM_TIMEOUT_MS` | `60000` | Per Ollama call timeout |
| `AGENT_TIMEOUT_MS` | `300000` | Whole agent-run timeout |
| `AGENT_MAX_STEPS` | `5` | Model calls per run (1–10) |
| `EXEC_TIMEOUT_MS` | `30000` | Per-command timeout |
| `CHAT_HISTORY_MESSAGES` | `20` | Persisted messages supplied as context |
| `CHAT_DB_PATH` | `./data/chat-history.sqlite` | SQLite conversation store |
| `SKILLS_DIR` | `./skills` | Directory containing `*/SKILL.md` files |
| `AGENT_WORKSPACE_DIR` | `./agent-workspace` | Initial shell working directory |

`.env` must never be committed.

## Run and validate

Start Ollama if your platform does not run it in the background, then use either:

```sh
npm run dev
```

```sh
npm run build
npm start
```

Validate the repository with:

```sh
npm run typecheck
npm test
```

## Behavior and manual checks

`/start` and `/help` describe the bot without model usage. `/new` removes stored history only for the current Telegram chat. Other commands are ignored. Normal non-empty text messages are processed sequentially, preserving each chat's recent user and final assistant messages in SQLite.

The worker starts with two local Skills: weather via `wttr.in`, and fiat exchange rates via Frankfurter. For a direct answer, send “Explain photosynthesis briefly.” For a tool call, send “What is the weather in Amsterdam?” or “Convert 10 EUR to USD.” Then send a contextual follow-up such as “What about tomorrow?” Finally send `/new` and verify that the prior context is no longer used.

The Telegram process handles access, commands, replies, chunking, and worker lifecycle. The worker process owns JSONL requests, SQLite history, Skills, the bounded model → tool → model loop, and command execution. Ollama remains an HTTP-only provider; it receives chat messages and the one `exec` tool definition.

`CHAT_DB_PATH` and `AGENT_WORKSPACE_DIR` are runtime locations and are ignored by Git, together with SQLite WAL/SHM files.

## Security warning

**`exec` runs commands through the host shell. `AGENT_WORKSPACE_DIR` is only an initial directory, not a security sandbox.** The mandatory Telegram allowlist limits who may reach the agent, but it is not a complete safety boundary. Run the bot under a low-privilege account or in a container, and authorize destructive, irreversible, or privileged actions only with care. Commands receive a minimal environment without the bot token or application configuration, but shell access still has the operating-system permissions of the bot process.
