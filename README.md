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
| `RAG_MAX_DISTANCE` | `1.0` | Maximum accepted L2 distance |
| `RAG_MAX_CONTEXT_CHARS` | `8000` | Maximum retrieved chunk text returned to the model |
| `SKILLS_DIR` | `./skills` | Local `*/SKILL.md` directory |
| `AGENT_WORKSPACE_DIR` | `./agent-workspace` | Initial `exec` directory |
| `TOKEN_AUDIT_ENABLED` | `true` | Persist privacy-safe chat-loop metrics |
| `TOKEN_AUDIT_DB_PATH` | `./data/token-audit.sqlite` | Separate audit/benchmark database |
| `TOKEN_AUDIT_AGENT_ID` | `econet-bot` | Stable non-secret agent label |
| `TOKEN_AUDIT_PROFILE` | `optimized` | `baseline` or `optimized` context behavior |
| `CHAT_HISTORY_TOKEN_BUDGET` | `1600` | Optimized estimated stored-history budget |
| `EXEC_MODEL_OUTPUT_MAX_CHARS` | `3000` | Optimized model-visible exec cap |
| `RAG_MODEL_CONTEXT_MAX_CHARS` | `4500` | Optimized RAG text budget; preserve a complete top result |
| `TOKEN_AUDIT_INPUT_USD_PER_1M` | `0` | Notional uncached-input rate |
| `TOKEN_AUDIT_CACHED_INPUT_USD_PER_1M` | `0` | Notional cached-input rate |
| `TOKEN_AUDIT_OUTPUT_USD_PER_1M` | `0` | Notional output rate |
| `TOKEN_AUDIT_REASONING_USD_PER_1M` | `0` | Notional reasoning rate |

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

Indexing and queries use the same 768-dimensional `embeddinggemma` vectors. Retrieval uses normalized-vector L2 distance, asks for Top 5, rejects distances above 1.0, preserves nearest-first order, and returns only complete chunks within 8,000 text characters. For unit vectors, L2 `1.0` corresponds to cosine similarity `0.5`. The earlier `0.8` default rejected a manually verified relevant result at `0.9717`; the revised threshold admits that result while retaining a relevance cutoff. Tune it further only with evaluation evidence.

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

Runtime progress is written to stderr (the terminal running `npm run dev` or `npm start`). Structured `event=...` records cover Telegram receipt/reply, document download, extraction, chunking, embedding, storage, retrieval, each model/tool step, completion, durations, counts, and safe failures. For a document question, the normal path is `model_call_completed ... tool_calls=1`, `tool_started ... tool="search_documents"`, `document_search_completed`, and then another model call. If the model instead asks the user to wait or claims that uploaded documents lack the information without searching, the agent rejects that unverified response and logs `document_search_fallback_started`; it searches with the current prompt through the same trusted-user retrieval path and gives the result back to the model. Ordinary direct answers do not trigger this narrow fallback. Prompt and response text, document content, tool arguments/results, vectors, paths, tokens, and secrets are never logged.

User/chat IDs and source filenames are also excluded from operational logs and audit storage. Worker request IDs may appear as opaque correlation metadata.

## Token audit and optimization

Each worker chat request creates one audit run. Shared wrappers record attempted LLM calls, tools, delivery/compaction events and final status. Production audit failures are fail-open and emit only safe error categories. Worker startup recovers interrupted rows; benchmark startup performs additive migrations without changing existing agent-run statuses. The audit database and old evidence are preserved.

Exact usage is Ollama's non-negative integer `prompt_eval_count` and `eval_count`. Optional cached tokens are a subset of input, never added twice. Reasoning is unavailable with this configuration (`think=false`). Missing or invalid counters remain unavailable: no estimate is substituted. Usage issues distinguish `absent_usage_fields`, `invalid_token_count`, `invalid_cached_count`, and `incomplete_provider_response`. The provider translates internal tool history into Ollama's native `tool_calls`/`tool_name` fields for both profiles.

Context categories, tool tokens and repeated/new input use `ceil(UTF-8 bytes/4)`; repetition uses fresh run-local salted hashes that are never persisted. It is not provider cache usage. Cost uses recorded counters and configured USD/1M rates, excluding cached input from uncached input. With no cached counter, input is priced at the input rate. Local rates default to zero; non-zero rates are hypothetical, not a bill. Missing usage makes displayed aggregate cost N/A; zero-to-zero cost reduction is N/A.

The audit database, dashboard, execution logs and Markdown reports contain only opaque run/task/cohort IDs, configured non-secret labels, model/environment/options, statuses, counters, timestamps, predefined tool names and reason codes. Source/citation/value checks run in memory. No prompts, responses, commands, queries, tool contents, document text, source filenames, Telegram IDs, secrets or reusable runtime-content hashes are persisted. The static synthetic dataset SHA-256 and provider model digest identify benchmark artifacts, not user content. Readers never inspect history or RAG databases.

Optimized runtime defaults:

- Stored history: newest complete exchanges fitting **1,600 estimated tokens**, restored to chronological order. Any oversized exchange is skipped, including the newest; current input and stored history are unchanged.
- Exec: **3,000 model-visible JSON characters**, retaining prefix/suffix, status, original sizes and a truncation marker. The real executor's 32 KiB capture bound is unchanged.
- Transient tools: newest results remain full after initial exec/RAG compaction. Older results become receipts only after the model has seen them and their text evidence is still verbatim in newer results (or they contain no text evidence). Unique older evidence is retained.
- RAG overlap: remove exact suffix/prefix overlap only for consecutive chunk indices with the same document and page metadata, and only when the omission marker is shorter. Preserve metadata, rank and top evidence.
- RAG context: retain complete highest-ranked evidence under a **4,500-character text budget** after overlap removal. A single oversized top result is kept whole under the existing retrieval hard bound (8,000 by default); later results are omitted. This evidence-preserving exception does not occur in v2 fixtures.

Baseline retains pre-optimization context selection and tool bodies. Both profiles share the same compact, structured operational instructions: document questions must search, contextual follow-ups must form standalone queries, successful calls must not be repeated, and failed calls may be retried only with corrected inputs. The agent also suppresses an exact tool call repeated after its successful result was delivered, while still executing corrected retries, previous failures and calls within the same requested round. This protection is run-local and never logs or persists arguments. Static Skills were inspected and retained unchanged; the search schema was clarified without changing its interface. No dynamic Skill selection or speculative architecture was added.

### Valid v2 benchmark

All earlier invalid audits remain invalid and must not support a success or regression claim. V2 contains 13 synthetic cases: direct arithmetic/concept, seeded moderate history, TXT/Markdown/PDF/DOCX document questions, contextual follow-up, no-match, large exec, failed exec, two sequential tool rounds, and substantial RAG overlap. Document questions explicitly require search, and the contextual case names its recent topic without relying on an ambiguous pronoun. Scoring independently checks the exact predefined tool multiset, required query terms, source metadata, citation locators, identifying values and forbidden claims. It normalizes punctuation/case/whitespace, listed numeric-word/date alternatives and equivalent success wording. Exact filename plus page/chunk is accepted in common unambiguous citation layouts; a literal `Source:` prefix is not required. No LLM judge is used.

The benchmark uses the real configured **local Ollama chat model**, bundled repository Skills, deterministic in-memory retrieval/exec fixtures, and a fresh owner/history for every case/profile. It never opens runtime history/RAG stores, executes shell fixture commands, embeds documents, or contacts Telegram. Existing retrieval evaluation remains separate.

Preflight must succeed before measured cases. It builds/checks fixtures; checks local Ollama, model digest, model context support, version, returned usage and effective loaded context; and checks baseline/optimized settings. Its conservative largest-case calculation reserves every executable tool round: the full expected fixture result once, bounded feedback for all remaining rounds, every model output allowance, a 3× estimate multiplier and a 512-token margin. Every measured request is guarded again; near-window authoritative prompt usage invalidates the case. Read-only postflight checks reject model/server/loaded-context changes during either profile.

Recorded benchmark-only settings (both profiles):

| Setting | Value |
| --- | --- |
| Temperature / seed | 0 / 731 |
| Context / output limit | 16,384 / 256 tokens |
| Per-call timeout | 180,000 ms |
| Whole case timeout | Per conversation turn: max steps × (LLM timeout + 1,000 ms) + 10,000 ms; multiplied by prescribed turns |
| Default five-step case budget | 915,000 ms per conversation turn |
| History message cap / optimized budget | 20 / 1,600 estimated tokens |
| Optimized exec / RAG text budgets | 3,000 / 4,500 characters |
| Retrieval Top-K / original context cap | 5 / 8,000 characters |

Override benchmark context/timeouts using `TOKEN_AUDIT_BENCHMARK_NUM_CTX`, `TOKEN_AUDIT_BENCHMARK_LLM_TIMEOUT_MS`, and `TOKEN_AUDIT_BENCHMARK_CASE_TIMEOUT_MS`. A shorter-than-required case timeout fails preflight. Model, step limit, retrieval distance, exec timeout and pricing use configuration and are recorded. Runtime optimization overrides do not change the fixed benchmark budgets.

Use the paired command. Both profiles share one loaded implementation/dataset/Skills snapshot and a random cohort; separate single-profile commands remain diagnostic and intentionally cannot be compared across invocations. This avoids reusable content hashes and comparison across uncommitted code/Skill changes. Run with bot/worker stopped. A benchmark lock prevents simultaneous benchmark writers; after a crash, remove only `<TOKEN_AUDIT_DB_PATH>.benchmark.lock` after confirming no benchmark is running.

```sh
npm run typecheck
npm test
npm run evaluate
npm run audit:preflight
npm run audit:benchmark:pair -- --before before-v3 --after after-v3
npm run audit:compare -- --before before-v3 --after after-v3
npm run audit:dashboard
npm run audit:report -- --before before-v3 --after after-v3 --out reports/token-audit-v3.md
```

The paired command automatically saves separate timestamp-and-UUID execution logs for each profile, a pair log, and comparison output in `reports/audit-v2/`; preflight and explicit comparison also save distinct logs. Logs contain safe diagnostics only. Reusing a label fails before model access unless `--overwrite` is explicit; overwrite archives the prior label and retains all records. Reports use exclusive creation and never overwrite existing files. Use fresh labels/output names for later evidence.

Timeouts, incomplete cases, missing authoritative usage on any successful provider call, missing records and incompatible model/dataset/options/limits/pricing/cohort invalidate comparison: exact totals, reductions and quality-drop calculations display **N/A**, and comparison exits non-zero. A failed or pre-provider attempt makes its case incomplete but is not falsely reported as missing provider usage; usage completeness applies to calls the provider completed successfully. Legacy labels stay invalid after additive migration. Completed scoring failures (including duplicate/missing tools, missing query terms, values, metadata or citations) remain measured quality failures, not discarded cases. Full fixture payloads are single-use per expected call: duplicate or unexpected weak-model calls receive small structured feedback, remain visible in tool counts, and cannot repeatedly inflate context. Delivery diagnostics prove whether initial full results and later receipts occurred.

Only new complete compatible real Ollama output can establish at least 30% gross-token reduction with at most a 2-percentage-point success-rate decrease. With 13 cases, losing one success is 7.69 points. Temperature/seed do not guarantee bitwise reproducibility, and context estimates are not tokenizer proofs.

The terminal dashboard supports `--profile baseline|optimized` and `--run <opaque-run-id>`. It separates exact/estimated metrics and invalid benchmark labels. Audit/report/log runtime artifacts are ignored by Git. Do not clear the audit database when rerunning benchmarks; use fresh labels.

`document_search_candidates` reports only the number of user-filtered KNN candidates, nearest L2 distance, and configured maximum distance. A positive candidate count followed by `no_match` means the distance threshold rejected every candidate; zero candidates indicates an indexing/vector-visibility problem instead.

## Security warning

**`exec` runs commands through the host shell. `AGENT_WORKSPACE_DIR` is only an initial directory, not a security sandbox.** The allowlist limits who can reach the agent but is not a complete isolation boundary. Run it as a low-privilege account or in a container, and authorize destructive, irreversible, or privileged actions carefully. Commands receive a minimal environment without the bot token or application configuration, but retain the operating-system permissions of the bot process.
