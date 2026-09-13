# Econet Bot

A minimal TypeScript Telegram AI agent backed by local Ollama. It remembers each Telegram chat, retains user-owned documents for retrieval-augmented answers, and can use its existing Skills and `exec` shell tool.

## Setup

Requirements are Node.js 20+, npm, Ollama, a Telegram bot token, and the decimal Telegram user IDs allowed to use the bot. `better-sqlite3` and `sqlite-vec` are native dependencies; use a supported Node/platform combination with a working native package install toolchain if a prebuilt binary is unavailable.

```sh
npm install
cp .env.example .env
ollama pull qwen3:1.7b
ollama pull embeddinggemma
```

Set `TELEGRAM_BOT_TOKEN` and the mandatory comma-separated `ALLOWED_TELEGRAM_USER_IDS` in `.env`. Never commit or share `.env`. Sender IDs—not usernames or chat IDs—control access and document ownership.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | none | Required Telegram token |
| `ALLOWED_TELEGRAM_USER_IDS` | none | Required authorized decimal sender IDs |
| `INFERENCE_PROVIDER` | `ollama` | Worker-side chat provider |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama URL |
| `OLLAMA_MODEL` | `qwen3:1.7b` | Tool-capable chat model |
| `OLLAMA_EMBEDDING_MODEL` | `embeddinggemma` | Embedding model |
| `RAG_EMBEDDING_DIMENSION` | `768` | Exact embedding/vector dimension |
| `LLM_TIMEOUT_MS` | `60000` | One chat-model call |
| `EMBEDDING_TIMEOUT_MS` | `60000` | One embedding call |
| `AGENT_TIMEOUT_MS` | `300000` | Whole chat request |
| `DOCUMENT_TIMEOUT_MS` | `300000` | Index/list/delete operation |
| `AGENT_MAX_STEPS` | `5` | Model calls per run, from 1 to 10 |
| `EXEC_TIMEOUT_MS` | `30000` | Shell command timeout |
| `CHAT_HISTORY_MESSAGES` | `20` | Recent stored messages in context |
| `CHAT_DB_PATH` | `./data/chat-history.sqlite` | Conversation database |
| `RAG_DB_PATH` | `./data/rag.sqlite` | Document/chunk/vector database |
| `DOCUMENT_TEMP_DIR` | `./data/tmp-documents` | Ephemeral download directory |
| `MAX_DOCUMENT_BYTES` | `10485760` | Uploaded-byte limit (10 MiB) |
| `MAX_EXTRACTED_TEXT_CHARS` | `1000000` | Extracted-text limit |
| `RAG_CHUNK_SIZE_CHARS` | `1600` | Target characters per chunk |
| `RAG_CHUNK_OVERLAP_CHARS` | `300` | Characters overlapped between chunks |
| `EMBEDDING_BATCH_SIZE` | `16` | Index inputs per `/api/embed` call |
| `RAG_TOP_K` | `5` | Nearest chunks requested |
| `RAG_MAX_DISTANCE` | `0.8` | Maximum accepted L2 distance |
| `RAG_MAX_CONTEXT_CHARS` | `8000` | Maximum retrieved chunk text returned to the model |
| `SKILLS_DIR` | `./skills` | Local `*/SKILL.md` directory |
| `AGENT_WORKSPACE_DIR` | `./agent-workspace` | Initial `exec` directory |

Changing the embedding model or dimension makes an existing index incompatible. Stop the app, remove or move `RAG_DB_PATH`, and re-upload documents; automatic re-embedding is intentionally not implemented.

## Behavior and architecture

The Telegram and inference worker are separate long-lived processes connected by strictly validated JSONL over stdin/stdout. Telegram performs the sender allowlist check before commands, downloads, or worker calls. It derives `conversationId` from the chat and trusted document `userId` from the validated sender. The sequential worker owns conversation history, extraction, deterministic chunking, Ollama embeddings, SQLite/sqlite-vec, Skills, and the bounded model/tool loop.

Upload one `.txt`, `.md`, `.docx`, or text-based `.pdf` document per update. The bot validates the safe basename and known size, downloads to a unique temporary path, indexes it, and always removes the temporary bytes. Original files are never retained. Filenames are case-sensitive and unique per user.

- `/start` or `/help` describes available behavior without model use.
- `/new` clears only the current chat history; it does not delete documents.
- `/documents` lists only the sender's documents in creation order.
- `/delete <filename>` deletes one exact owned filename, its chunks, and its vectors.

TXT and Markdown use UTF-8; DOCX uses Mammoth; PDF.js extracts text page by page with one-based page metadata. OCR and image-only/scanned PDFs are unsupported. Text is normalized and split deterministically around 1,600 characters with 300-character overlap, preferring paragraph, line, sentence, and whitespace boundaries. Smaller chunks can improve precision but lose context; larger chunks retain context but dilute similarity and consume more context. More overlap helps boundary-spanning facts at the cost of storage and embedding work.

The RAG database has `documents`, ordered `chunks`, and a sqlite-vec `vec0` table whose row IDs equal chunk IDs. Foreign keys connect chunks to documents; vector rows carry `user_id` as a partition key and `document_id` metadata. Index inserts and deletions are transactions, with vector rows explicitly deleted. The `search_documents` model tool accepts only a standalone `query`; trusted ownership is injected by the runtime. Its KNN query contains exact `user_id = ?` filtering, then joins and defensively rechecks ownership, so global results are never post-filtered.

Indexing and queries use the same 768-dimensional `embeddinggemma` vectors. Retrieval uses normalized-vector L2 distance, asks for Top 5, rejects distances above 0.8, preserves nearest-first order, and returns only complete chunks within 8,000 text characters. These conservative defaults bound model context; tune the threshold only with evaluation evidence.

Document-derived answers must use retrieved text, cite the exact filename and PDF page (or zero-based chunk number when no page exists), and say the information was not found in uploaded documents when retrieval does not support an answer. Retrieved text is treated as untrusted data. Corrupt, protected, empty, image-only, oversized, duplicate, unavailable, timeout, embedding, database, and model failures receive concise messages without paths, SQL, contents, vectors, or secrets.

## Run, validate, and evaluate

```sh
npm run typecheck
npm test
npm run evaluate
```

`npm run evaluate` uses deterministic fake topic vectors and a temporary sqlite-vec database. Its six cases cover TXT, Markdown, DOCX, PDF source/page metadata, multiple documents, no-answer behavior, and cross-user isolation; it does not call Telegram, Ollama, or an LLM.

Start in development:

```sh
npm run dev
```

Or compile and start:

```sh
npm run build
npm start
```

Manual demonstration: upload a text PDF and ask a question whose answer appears on a known page; verify the answer includes `Source: filename.pdf, page N`. Ask for absent information and verify a not-found answer. Upload additional formats, use `/documents`, then delete one exact name and confirm it no longer retrieves. With two allowlisted senders in a group, upload different documents and verify each sender can search/list/delete only their own. Finally run the test and evaluation commands above.

Runtime databases and WAL/SHM files, temporary documents, build output, coverage, dependencies, `.env`, and the agent workspace are ignored by Git. Logs contain only safe categories and metadata, never prompts, document contents, tool arguments/results, vectors, responses, or secrets.

## Security warning

**`exec` runs commands through the host shell. `AGENT_WORKSPACE_DIR` is only an initial directory, not a security sandbox.** The allowlist limits who can reach the agent but is not a complete isolation boundary. Run it as a low-privilege account or in a container, and authorize destructive, irreversible, or privileged actions carefully. Commands receive a minimal environment without the bot token or application configuration, but retain the operating-system permissions of the bot process.
