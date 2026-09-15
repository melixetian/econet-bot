# Econet Bot — Token Audit and Context Optimization Specification

## 1. Goal

Add an observability layer to the completed Telegram AI agent, measure where its tokens are spent, and reduce token consumption by at least 30% without reducing benchmark success rate by more than 2 percentage points.

The result must include:

- metrics for every LLM call and model tool call;
- per-run totals and a turn-by-turn timeline;
- context composition and repeated-context estimates;
- a reproducible before/after benchmark;
- at least three implemented optimizations;
- a local dashboard and generated audit report;
- regression tests and documentation.

This iteration optimizes the existing agent. It must not redesign its Telegram, worker, history, RAG, Skills, or tool architecture.

## 2. Sources of truth and precedence

- `Spec.md` remains authoritative for all functional, security, RAG, and runtime behavior.
- This file is authoritative only for observability, benchmarking, reporting, and token optimizations.
- Where the earlier specification excludes a dashboard, this iteration permits only the local terminal dashboard defined here. A web application remains out of scope.
- The original homework `AI Agent Token Audit.md` defines the assignment outcome; this file makes it implementable for the current repository.

Relevant provider documentation:

- `https://docs.ollama.com/api/chat`

Ollama currently reports `prompt_eval_count`, `eval_count`, and optionally `prompt_eval_cached_count`. It does not expose a separate reasoning-token count for this agent configuration. Missing provider metrics must remain unavailable rather than being invented.

## 3. Scope

### In scope

- A provider-neutral usage structure returned by every chat-provider call.
- Middleware/observer coverage around all LLM calls.
- Instrumentation of `exec`, `search_documents`, and future model tools through one shared tool wrapper.
- A separate SQLite audit database.
- Exact provider token counts when supplied by Ollama.
- Clearly labelled estimates for context categories, repetition, and tool-output tokens.
- Configurable notional per-token pricing, with truthful zero defaults for local Ollama.
- Baseline and optimized execution profiles on the same code revision.
- A fixed benchmark dataset and comparison command.
- A local terminal dashboard and Markdown before/after report.
- At least three bounded context optimizations.
- Tests and concise README documentation.

### Out of scope

- External observability services, analytics SDKs, tracing backends, or telemetry export.
- A web server, web dashboard, Telegram admin UI, or cloud deployment.
- Changing the chat or embedding model to obtain better benchmark results.
- Prompt caching emulation or claiming cache hits not reported by the provider.
- Model-specific tokenizer downloads or heavyweight tokenizer frameworks.
- Storing raw prompts, messages, document chunks, model responses, tool arguments, tool output, vectors, secrets, Telegram user IDs, or chat IDs in audit storage.
- Logging sensitive content to stdout/stderr.
- Optimizing embedding/indexing calls; the assignment measures the chat agent loop.
- Subjective manual grading as the only quality measure.

## 4. Definitions and measurement rules

### 4.1 Agent run

One `chat` worker request is one agent run.

- `run_id`: generated opaque UUID for observability.
- `task_id`: existing opaque worker request/correlation ID.
- `agent_id`: configured stable name, default `econet-bot`.
- `turn_number`: one-based LLM-call number inside the run.
- Tool calls belong to the turn whose assistant response requested them.
- Commands, uploads, indexing, list, delete, and reset are not agent runs and do not create LLM records.

### 4.2 Authoritative token metrics

For Ollama chat responses:

- `input_tokens = prompt_eval_count`;
- `output_tokens = eval_count`;
- `cached_tokens = prompt_eval_cached_count` when present, otherwise `NULL`;
- `reasoning_tokens = NULL` unless a provider explicitly returns a separate authoritative count.

`cached_tokens` are a subset of `input_tokens` and must never be added again to total tokens.

```text
total_tokens = input_tokens + output_tokens + coalesce(reasoning_tokens, 0)
cache_hit_rate = cached_tokens / input_tokens
```

Do not derive exact LLM token usage from character counts when the provider supplied no usage. Store unavailable exact fields as `NULL` and exclude them from exact aggregates.

### 4.3 Estimated metrics

Ollama does not expose token counts per message or for tool payloads. Use one small deterministic estimator already local to the repository, such as `ceil(UTF8 bytes / 4)`, only for:

- context-category attribution;
- repeated-context estimates;
- tool input/output token estimates;
- enforcing approximate context budgets.

Names, schema columns, dashboard labels, and the report must include `estimated` for these values. Do not present them as tokenizer-exact.

### 4.4 Context categories

Before every LLM call, classify canonical payload units as:

- `system`: system instructions and injected Skill instructions;
- `tools`: tool schemas/descriptions;
- `history`: stored prior user/assistant messages;
- `user`: current user request;
- `tool_output`: transient assistant tool calls and tool-result messages.

Track estimated tokens per category. Provider-facing JSON must not contain audit-only metadata.

### 4.5 Repeated context

Build canonical content units for the categories above and hash them with a run-scoped salt. For each later LLM call in the same run, mark a unit repeated if the same canonical unit hash appeared in an earlier call.

Store only the aggregate estimated repeated/new token counts; raw content and reusable global hashes are forbidden.

```text
repeated_share = repeated_input_tokens_estimated /
                 (repeated_input_tokens_estimated + new_input_tokens_estimated)
```

This is a content-unit estimate, not a provider cache metric. Dashboard and report must show it separately from cache hit rate.

### 4.6 Latency

- Measure application-observed LLM and tool duration with a monotonic clock.
- Store milliseconds as non-negative integers.
- Provider-reported duration may be stored separately when available but does not replace application latency.
- A failed call is still recorded with status and latency; unavailable usage remains `NULL`.

## 5. Cost calculation

Add configurable USD rates per one million tokens:

- `TOKEN_AUDIT_INPUT_USD_PER_1M`, default `0`;
- `TOKEN_AUDIT_CACHED_INPUT_USD_PER_1M`, default `0`;
- `TOKEN_AUDIT_OUTPUT_USD_PER_1M`, default `0`;
- `TOKEN_AUDIT_REASONING_USD_PER_1M`, default `0`.

For an LLM call:

```text
uncached_input = input_tokens - coalesce(cached_tokens, 0)

estimated_cost_usd =
  uncached_input * input_rate / 1_000_000 +
  coalesce(cached_tokens, 0) * cached_input_rate / 1_000_000 +
  output_tokens * output_rate / 1_000_000 +
  coalesce(reasoning_tokens, 0) * reasoning_rate / 1_000_000
```

Reject negative rates and invalid token counts. Clamp neither malformed cached counts nor `cached_tokens > input_tokens`; treat such provider usage as invalid/unavailable and record a safe diagnostic.

Local Ollama has no API per-token fee, so defaults truthfully produce `$0.00`. The report must distinguish actual local API cost from a hypothetical estimate using user-supplied rates. If both before and after cost are zero, cost reduction is `N/A`, not `100%` or division by zero. The primary acceptance target is then token reduction as defined in section 11.

## 6. Provider contract and LLM middleware

Extend the provider-neutral chat result with optional validated usage metadata. Equivalent names matching the repository are acceptable.

```ts
type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  providerDurationMs?: number;
};

type ChatResult = {
  message: AssistantMessage;
  usage: ChatUsage | null;
};
```

Requirements:

- Validate Ollama usage fields as finite non-negative safe integers.
- Keep response content/tool-call validation unchanged.
- Wrap the provider at the agent-loop boundary so every model call, including failures, is observed exactly once.
- Record run, task, agent, model, turn, timestamp, latency, status, usage, cost, context categories, and repetition aggregates.
- Do not couple Telegram code to audit persistence.
- Metrics failure is fail-open: report a safe audit error category and continue the user request.
- Observability must not change prompts, tool results, or responses when the baseline profile is selected.

## 7. Tool-call instrumentation

Instrument model tool execution in one shared wrapper rather than separately scattering logic across tools.

For every requested tool call record:

- `run_id`, `turn_number`, and zero-based `call_index`;
- `tool_name`;
- `input_bytes` and `output_bytes` from canonical serialized values;
- `input_tokens_estimated` and `output_tokens_estimated`;
- `duration_ms`;
- success/failure status;
- whether the model-visible output was truncated or compacted.

Never store arguments, commands, queries, result content, filenames, source text, or error details. Unknown/invalid tool calls are recorded under a safe normalized name such as `unknown`, without preserving attacker-controlled names.

Instrumentation must include both `exec` and `search_documents`, success and failure, and must preserve sequential tool execution and existing timeout/abort behavior.

## 8. Audit persistence

Use a separate SQLite file at `TOKEN_AUDIT_DB_PATH`, default `./data/token-audit.sqlite`. The worker remains the sole normal-runtime writer. With the bot/worker stopped, the benchmark writes to the same separate audit database without touching real history/RAG. Its exclusive lock prevents concurrent benchmark invocations.

Use a small normalized schema equivalent to:

```sql
CREATE TABLE agent_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (profile IN ('baseline', 'optimized')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'limit')),
  llm_calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  estimated_cost_usd REAL NOT NULL DEFAULT 0
);

CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  latency_ms INTEGER NOT NULL,
  provider_duration_ms INTEGER,
  estimated_cost_usd REAL NOT NULL,
  system_tokens_estimated INTEGER NOT NULL,
  tools_tokens_estimated INTEGER NOT NULL,
  history_tokens_estimated INTEGER NOT NULL,
  user_tokens_estimated INTEGER NOT NULL,
  tool_output_tokens_estimated INTEGER NOT NULL,
  repeated_input_tokens_estimated INTEGER NOT NULL,
  new_input_tokens_estimated INTEGER NOT NULL,
  UNIQUE (run_id, turn_number)
);

CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  call_index INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  input_bytes INTEGER NOT NULL,
  output_bytes INTEGER NOT NULL,
  input_tokens_estimated INTEGER NOT NULL,
  output_tokens_estimated INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  compacted INTEGER NOT NULL CHECK (compacted IN (0, 1)),
  UNIQUE (run_id, turn_number, call_index)
);
```

Additional tables/columns for benchmark labels and cases are allowed when kept small. Add indexes required by dashboard queries. Aggregate run fields are finalized after every completed/failed run so a dashboard query does not have to reconstruct all totals.

Requirements:

- create schema idempotently;
- use foreign keys and transactions where appropriate;
- preserve completed call data if a later turn fails;
- recover stale `running` rows as interrupted on next startup or display them explicitly;
- close the database cleanly;
- ignore SQLite, WAL, and SHM files in Git;
- never reuse the chat-history or RAG database for audit data.

## 9. Required optimization profiles

The same code revision must support:

- `TOKEN_AUDIT_PROFILE=baseline`: current pre-optimization context behavior plus instrumentation;
- `TOKEN_AUDIT_PROFILE=optimized`: all accepted optimizations plus identical instrumentation.

Default to `optimized` for normal runtime. Profile selection must not change the model, benchmark questions, tool availability, timeouts, or scoring rules.

Implement at least the following four bounded optimizations. Equivalent evidence-backed implementations are allowed only when documented in the final report.

### 9.1 Budget stored conversation history

Baseline preserves current `CHAT_HISTORY_MESSAGES` behavior.

Optimized mode also applies `CHAT_HISTORY_TOKEN_BUDGET`, default `1600` estimated tokens:

- traverse history newest-first;
- retain newest complete user/assistant exchanges that fit;
- restore chronological order;
- never drop the current user message;
- do not split a stored message;
- skip every exchange that exceeds the remaining budget, including an oversized latest exchange; continue newest-first and never exempt an exchange from the hard estimated-token budget.

This changes only context selection, never persisted history.

### 9.2 Compact model-visible `exec` output

Keep the existing executor capture/safety limit unchanged. In optimized mode, before returning the result to the model, apply `EXEC_MODEL_OUTPUT_MAX_CHARS`, default `3000`:

- preserve a useful prefix and suffix;
- include an explicit structured truncation marker and original byte/character count;
- preserve exit status, timeout, and error category;
- do not write the removed content to audit storage or logs.

Baseline returns the existing bounded result.

### 9.3 Compact old transient tool results

The model receives a full new tool result on the immediately following LLM call. Before later calls in the same run, optimized mode replaces older tool-result bodies with bounded receipts containing only tool name, status, result count/source identifiers already safe for the model, truncation state, and an indication that full output was previously seen.

- Keep the most recent tool round in full.
- Do not compact the only evidence still needed to compose the final answer. Conservatively replace an old result only when all its text evidence remains verbatim in newer tool results (or it has no text evidence), and only when the receipt is shorter.
- Never invent a summary with new semantic claims.
- Baseline repeats complete transient tool results as it does today.

### 9.4 Remove repeated RAG overlap

In optimized mode, compact `search_documents` results before they are serialized for the model:

- preserve rank and source metadata;
- remove only exact overlapping text shared by consecutive chunk indices with identical document and page metadata; being on the same page alone is not adjacency;
- never deduplicate merely similar text;
- keep at least one complete top-ranked result;
- continue to enforce `RAG_MAX_CONTEXT_CHARS` and `RAG_TOP_K`;
- mark omitted overlap only when the marker is shorter than the removed text.

### 9.5 Bound model-visible RAG context

After overlap removal, apply `RAG_MODEL_CONTEXT_MAX_CHARS`, default `4500`, to result text (not JSON metadata). Retain a complete highest-ranked prefix of results; mark omitted result count. Preserve one complete highest-ranked result if it alone exceeds this secondary budget, still bounded by `RAG_MAX_CONTEXT_CHARS`. This evidence-preserving exception is explicit; v2 benchmark chunks fit the secondary budget. Ownership, search threshold, rank and source metadata are unchanged.

Baseline preserves current retrieval output. Retrieval ranking, ownership filtering, `no_match`, and citations must not change.

## 10. Dashboard

Provide a read-only terminal command:

```bash
npm run audit:dashboard
npm run audit:dashboard -- --profile optimized
npm run audit:dashboard -- --run <run-id>
```

The aggregate view must show:

- tasks completed/failed;
- total input, output, cached, and reasoning tokens, with unavailable values labelled `N/A`;
- total estimated cost and the active price assumptions;
- average total tokens, turns, tool calls, and latency per run;
- cache hit rate when available;
- estimated repeated/new input and repeated share;
- context composition by category and growth by turn;
- tools ranked by model-visible output tokens/bytes and duration.

The single-run view must show a turn-by-turn timeline with LLM tokens/latency/cost and each tool's estimated input/output tokens and duration. It must not print content, arguments, filenames, user/chat IDs, or secrets.

The command must work without Telegram, Ollama, or network access when an audit database exists. An empty database receives a clear non-error message.

## 11. Benchmark and acceptance math

### 11.1 Dataset

Add a versioned benchmark dataset with at least 10 representative cases. It must include:

- direct answer without tools;
- multi-turn history growth;
- `search_documents` over more than one supported document format;
- a RAG follow-up requiring conversational context;
- a true `no_match` case;
- large successful `exec` output using a harmless fixed local command or a benchmark-only deterministic tool fixture;
- a tool failure;
- a case requiring more than one LLM turn.

Use only synthetic committed fixtures. Never use runtime databases, uploaded user documents, Telegram credentials, or external services.

Each case defines deterministic pass conditions such as required tool name, exact source metadata, required identifying values, forbidden unsupported claims, and/or expected safe status. Do not score style or exact full prose.

### 11.2 Execution

Provide commands equivalent to:

```bash
npm run audit:run
npm run audit:preflight
npm run audit:benchmark:pair -- --before before-v3 --after after-v3
npm run audit:compare -- --before before-v3 --after after-v3
```

The one-command wrapper creates fresh timestamped labels/output by default. It stops before measurement if preflight fails. Once a paired measurement begins, it attempts comparison, dashboard, and report generation even when the pair or comparison returns non-zero for invalid evidence or failed acceptance, and finally returns non-zero itself. It accepts optional explicit before label, after label, and Markdown path. This avoids both unsafe unconditional `;` chaining and incomplete artifact collection caused by all-`&&` chaining.

The benchmark:

- runs directly against the worker/agent boundary without Telegram;
- uses the configured local Ollama chat model for authoritative usage;
- may use deterministic local fakes for external tools and seeded retrieval data;
- sets deterministic model options where supported and records the effective model/options;
- isolates conversation IDs and RAG ownership between cases;
- performs an unscored warm-up so model load time does not distort latency;
- records Git revision, dataset hash, profile, model, timestamps, per-case success, and linked audit run IDs;
- refuses to compare different dataset hashes, models, case counts, or incompatible settings;
- does not overwrite earlier labelled results without an explicit flag.

Unit tests use a scripted fake provider and deterministic usage values. The final before/after evidence must come from the same local Ollama model on the same machine/configuration, not from fake usage.

### 11.3 Metrics

For each profile:

```text
success_rate = passed_cases / total_cases * 100
gross_tokens = sum(input_tokens + output_tokens + coalesce(reasoning_tokens, 0))
token_reduction = (baseline_gross_tokens - optimized_gross_tokens)
                  / baseline_gross_tokens * 100
success_rate_drop_pp = baseline_success_rate - optimized_success_rate
```

Primary acceptance:

- `token_reduction >= 30%`;
- `success_rate_drop_pp <= 2.0`;
- all cases completed with authoritative token usage.

Also compare input/output/cached tokens, estimated repeated share, average turns, tool-output size, latency, and estimated cost. If configured prices are non-zero, estimated cost reduction must be reported; with all-zero local pricing it is `N/A` while the 30% gross-token criterion remains mandatory.

The compare command exits non-zero when compatibility or acceptance checks fail and prints actionable aggregate reasons without content.

### 11.4 Corrected v2 validity and reproducibility

The first audit is invalid evidence and cannot demonstrate either success or regression. The obsolete v1 benchmark fixture is removed; additive migrations still mark any pre-v2 database labels invalid and preserve their records.

A label cannot support comparison if any case timed out, failed to complete all prescribed turns, reached the step limit, lacks linked audit records, or contains any successful LLM call without validated authoritative input/output counters. Failed provider calls also make the case incomplete. Never sum available counters into a supposedly comparable partial total. Exact input/output/gross/cache/reasoning/cost totals and all reduction/guardrail calculations are N/A for invalid/incompatible comparisons. Return non-zero for missing results, invalidity, incompatibility or failed acceptance.

Compare model/digest, dataset SHA-256, case IDs/counts, complete run links, effective options, all benchmark limits, prices, runtime environment, implementation revision and invocation cohort. Only a paired execution is comparable: it shares one loaded implementation, synthetic dataset and bundled-Skills snapshot in memory, with an opaque random cohort. Separate single-profile invocations are retained for diagnostics but are deliberately incompatible. This avoids persisting reusable implementation/Skill content hashes while supporting an uncommitted working tree. The required static synthetic dataset hash and provider model digest are artifact identifiers, never hashes of user content.

Reject duplicate labels before any model request, including duplicate before/after names. An explicit `--overwrite` archives the previous label under an opaque name and preserves all its records. Do not silently overwrite any output file. A complete wrapper run saves separate timestamp-and-UUID logs for preflight, each profile, the paired invocation and comparison in one `reports/audit-<UTC timestamp>/` directory matching its report. Direct commands derive the suffix from the baseline label or accept `--evidence-id <safe-id>`. A failed invocation must never present acceptance from previously existing labels.

Preflight must finish before measured cases. Build/check all synthetic fixtures; verify local loopback Ollama availability, configured model/digest, advertised context support, Ollama version, a usage-bearing warmup response and effective loaded context. Both profiles have identical `temperature=0`, `seed=731`, `num_ctx=16384`, `num_predict=256`, `stream=false`, `think=false` by default. Record effective values. Verify paired settings before starting; repeat model/context preflight before optimized measurement. Warmup is unmeasured. After each profile, read-only model/digest, server-version and loaded-context checks must still match preflight; failure invalidates that label.

The largest planned request, including system, bundled Skills, tool schemas, history, every executable tool round and bounded generated responses, must fit conservatively in `num_ctx`. Reserve the full expected fixture payload once, bounded duplicate/unexpected-call feedback for every remaining permitted tool round, `num_predict` for every permitted LLM response, a `3 ×` estimate multiplier and a 512-token margin. Apply the same guard before each measured request. Invalidate a case if authoritative prompt usage approaches the configured window within output-plus-margin reserve. These conservative checks are not an exact tokenizer proof; no claim of provider-side non-truncation may be inferred from estimates alone.

Use benchmark-only LLM timeout 180,000 ms. The default whole-case allowance is `prescribed_conversation_turns × (AGENT_MAX_STEPS × (LLM_TIMEOUT + 1000) + 10000)`: 915,000 ms per conversation turn at five steps. Reject shorter overrides. Abort the request/body read, await settlement, clear the timer, and clear case-only state before continuing. Never let timed-out work continue into another case.

Benchmark profiles fix history-message cap 20, optimized history budget 1600, optimized exec cap 3000, optimized RAG text cap 4500, original retrieval text cap 8000 and Top-K 5. Record configured model, steps, retrieval distance, executor timeout/capture bound and all prices. Runtime optimization overrides do not alter the fixed benchmark budgets. A fresh in-memory history and owner-scoped retrieval fixture per case/profile prevents cross-case contamination; no real history/RAG database, embedding call, shell execution or Telegram connection is used.

V2 has 13 cases: two direct answers, moderate seeded history, TXT/Markdown/PDF/DOCX retrieval, contextual follow-up, no-match, large exec, failed exec, sequential exec-then-search, and RAG overlap. History uses eight moderate irrelevant exchanges and one short recent required fact, materially exceeding the optimized budget while fitting baseline context. Exec returns approximately 12,000 characters before optimization with identifying evidence in prefix/suffix. RAG contains 640 exact overlapping characters; required facts remain outside removable overlap, and the marker is much shorter. Its lower-ranked filler makes the secondary cap measurable. The contextual follow-up names the recent document topic while still requiring history, avoiding an underspecified pronoun that a small model can reasonably resolve in multiple ways.

Document questions explicitly require searching uploaded documents. Identical shared compact instructions require search even for anticipated no-match questions, form standalone follow-up queries from recent context, forbid repeating a successful tool call, and permit a failed-call retry only with corrected inputs. The shared agent suppresses only an exact call repeated in a later round after the model received a successful result. Corrected calls, failed-call retries and duplicate calls within one model-requested round execute normally. Its canonical signature exists only in run memory and is never persisted or logged. Deterministic scoring uses normalized case, whitespace/punctuation, listed numeric-word alternatives, common November date orderings/ordinals and equivalent success wording. Dollar notation retains the currency unit in normalization. Independently check the exact predefined tool multiset, required query terms, actual source metadata, citation locators, identifying values and explicit forbidden claims. An exact filename and page/chunk locator in any common unambiguous layout is a citation; the arbitrary literal `Source:` prefix is not required. No loose full-prose style check or LLM judge. The sequential case requires separate exec/search rounds, full initial delivery of both results, and an optimized later receipt while retaining answer evidence.

Persist per-case completion, scoring reason codes, expected/observed predefined tool names and exact-count status, LLM/tool call counts, usage completeness, query-term/value/source-metadata/citation booleans and context/tool compaction booleans. Delivery events store opaque run ID, original turn/call index, receiving LLM turn, receipt flag and visible byte count only. Assertions remain in memory; only booleans are stored. Codes include `case_timeout`, `incomplete_case`, `missing_authoritative_usage`, `missing_required_tool`, `unexpected_tool_count`, `missing_required_value`, `missing_query_term`, `missing_source_metadata`, `missing_citation`, `missing_source`, `forbidden_claim`, `unexpected_status`, `missing_tool_round`, `missing_full_delivery`, `missing_compaction`, `context_window_exceeded`, and `audit_storage_error`.

Completed semantic/tool-choice failures are measured quality failures, not dropped cases. A successful provider call must have authoritative input/output usage. A failed or pre-provider attempt makes the case incomplete through its status, but does not also claim that provider usage was missing when no completed provider response existed. Timeouts, incomplete cases and successful-call missing usage invalidate the measurement. Dashboard/report distinguish complete exact counts, estimated categories/tool metrics and invalid labels. Zero configured prices remain truthful zero only for complete usage; incomplete cost is N/A.

Benchmark fixtures are deterministic single-use contracts, not unrestricted production tools. The first exact expected exec/search call receives the full fixture. Duplicate calls and unexpected arguments receive small structured benchmark-only errors as a fail-safe, remain recorded under the normalized tool name, and fail exact tool-count or semantic scoring. Together with the shared later-round duplicate guard, this prevents a weak model's repeated identical tool request from multiplying a 12,000-character result until the context guard aborts, while preserving that mistake as an honest quality failure. Ordinary production tool execution, outputs, corrected retries and step limits are unchanged.

Provider usage diagnostics store only `absent_usage_fields`, `invalid_token_count`, `invalid_cached_count` or `incomplete_provider_response`. A completed `exec-large` response with absent counts stays invalid; no parser may invent usage. The old outputs cannot distinguish absent fields from malformed counters. Shared provider transport must serialize internal assistant tool calls as Ollama `tool_calls` and tool results with `tool_name`, without audit-only metadata. This correctness fix applies identically to both profiles.

Tests must cover preflight failures, validity, partial/incompatible refusal, overwrite/output protection, hard history budgets, normalized scoring codes, sequential delivery/compaction, substantial adjacent overlap/net savings, source/evidence retention, lifecycle isolation and unchanged privacy/agent regressions. Agents may type-check but must not run those tests, evaluation, benchmarks, Ollama, workers, bots or network requests. The 30% target and 2-point guardrail remain pending real compatible user-run evidence.

## 12. Generated audit report

Provide:

```bash
npm run audit:report -- --before before-v2 --after after-v2 --out reports/token-audit-v2.md
```

The generated Markdown report must contain:

1. environment, Git revision, model, profiles, dataset hash, and run time;
2. measurement definitions and limitations;
3. before/after table for success, exact tokens, cache, turns, tools, latency, and cost;
4. top token consumers and most expensive turns/tools;
5. context composition and estimated repeated input;
6. each optimization, evidence/rationale, and tradeoff;
7. per-case success comparison;
8. acceptance result for 30% token reduction and 2-point quality guardrail;
9. explicit note that local Ollama API cost is zero unless notional rates were configured.

Commit a concise report template or generation documentation. Commit the generated report only after the user runs both real benchmark profiles. Audit databases and raw run data remain ignored.

## 13. Configuration

Add and validate:

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `TOKEN_AUDIT_ENABLED` | no | `true` | Persist chat-agent observability |
| `TOKEN_AUDIT_DB_PATH` | no | `./data/token-audit.sqlite` | Separate audit database |
| `TOKEN_AUDIT_AGENT_ID` | no | `econet-bot` | Stable non-secret agent label |
| `TOKEN_AUDIT_PROFILE` | no | `optimized` | `baseline` or `optimized` |
| `CHAT_HISTORY_TOKEN_BUDGET` | no | `1600` | Optimized estimated history budget |
| `EXEC_MODEL_OUTPUT_MAX_CHARS` | no | `3000` | Optimized model-visible exec limit |
| `RAG_MODEL_CONTEXT_MAX_CHARS` | no | `4500` | Optimized RAG text budget with complete-top-result exception |
| `TOKEN_AUDIT_BENCHMARK_NUM_CTX` | no | `16384` | Explicit identical benchmark context |
| `TOKEN_AUDIT_BENCHMARK_LLM_TIMEOUT_MS` | no | `180000` | Benchmark-only model-call timeout |
| `TOKEN_AUDIT_BENCHMARK_CASE_TIMEOUT_MS` | no | derived | At least max steps × (LLM timeout + 1000) + 10000 per conversation turn |
| `TOKEN_AUDIT_INPUT_USD_PER_1M` | no | `0` | Uncached input price assumption |
| `TOKEN_AUDIT_CACHED_INPUT_USD_PER_1M` | no | `0` | Cached input price assumption |
| `TOKEN_AUDIT_OUTPUT_USD_PER_1M` | no | `0` | Output price assumption |
| `TOKEN_AUDIT_REASONING_USD_PER_1M` | no | `0` | Reasoning price assumption |

Use existing RAG and executor caps where possible. Avoid extra flags unless an optimization cannot otherwise be tested independently. Update `.env.example` without secrets and README with defaults and measurement semantics.

## 14. Errors, privacy, and operational behavior

- Audit persistence and dashboard/report errors must use safe categories and never expose message/tool content.
- A telemetry write failure must not fail an otherwise successful agent request.
- Agent/provider/tool failures remain visible to audit only as normalized statuses and counts.
- Do not log or store prompts, completions, commands, queries, document text, tool results, source filenames, credentials, Telegram IDs, or reusable content hashes.
- Use parameterized SQL and validate dashboard/report selectors.
- Dashboard and report are read-only with respect to chat/RAG data.
- Audit data is local runtime data. Document how to delete its database safely when the worker is stopped.

## 15. Tests

Write deterministic tests covering at least:

- Ollama usage parsing, optional cached usage, and unavailable reasoning usage;
- rejected malformed/negative/inconsistent usage;
- exactly one LLM metric per success/failure call;
- run finalization on success, error, and step limit;
- tool metrics for `exec`, `search_documents`, invalid tool, and failure;
- no raw prompt/tool/document/user data in audit tables or dashboard output;
- fail-open behavior when audit storage fails;
- correct cost/cache/repeated-share arithmetic and zero-cost handling;
- context classification and run-scoped repetition estimates;
- baseline profile preserves previous context behavior;
- each optimization independently reduces its intended payload while preserving required metadata/status;
- history selection keeps chronological complete exchanges;
- `exec` prefix/suffix truncation and original-size marker;
- old tool-result compaction retains the newest evidence;
- exact RAG overlap removal does not cross users/documents or remove merely similar text;
- dashboard aggregate and single-run timeline snapshots/structured output;
- benchmark isolation, labels, compatibility checks, scoring, threshold math, and non-zero failure exit;
- regressions for all existing agent, RAG, history, Skills, and tool behavior.

Tests require no Telegram, credentials, network, or running Ollama. The development agent writes tests but does not run tests, benchmarks, services, or real model requests; the user validates locally.

## 16. Documentation and repository outputs

Update `README.md`, `.env.example`, `.gitignore`, `AGENTS.md`, and package scripts as needed. Document:

- what is exact versus estimated;
- local Ollama cost semantics and optional notional pricing;
- audit schema and privacy guarantees;
- all dashboard, benchmark, comparison, and report commands;
- baseline/optimized profile semantics;
- the implemented optimizations and their tradeoffs;
- how to reproduce and interpret the before/after result;
- that benchmark model/config/dataset must match;
- how to clear audit runtime data safely.

Expected scripts may use repository-consistent names, but must include equivalents of:

```text
audit:dashboard
audit:benchmark
audit:preflight
audit:benchmark:pair
audit:compare
audit:report
```

Do not commit audit SQLite files, WAL/SHM files, temporary benchmark state, real prompts, or user content.

## 17. Acceptance criteria

- Every LLM call and model tool call is observed exactly once without changing baseline behavior.
- Required exact provider metrics and clearly labelled estimates are available per call, run, profile, and benchmark case.
- Per-run cost is calculated from documented rates; local zero pricing is reported honestly.
- Dashboard shows aggregate hotspots and a single-run timeline without sensitive content.
- Repeated context and context-category growth are measurable and labelled as estimates.
- At least three bounded optimizations are implemented; the required profile supports all four specified optimizations unless a documented evidence-backed equivalent replaces one.
- One code revision can reproduce comparable baseline and optimized runs.
- Comparison rejects incompatible runs and enforces at least 30% gross-token reduction with at most 2 percentage points of success-rate loss.
- Report generation produces a complete before/after Markdown audit.
- Existing functional behavior, user isolation, RAG grounding, sources, Skills, `exec`, history, errors, timeouts, and access control remain intact.
- Tests are deterministic and need no real services; real benchmark execution is handed to the user.
- No raw or sensitive content is stored or logged.

## 18. Implementation constraints

- Prefer the smallest clear implementation satisfying this specification.
- Inspect and extend current provider/tool boundaries rather than creating a tracing framework.
- Use SQLite and simple terminal/Markdown rendering; do not add a UI framework.
- Preserve useful code/tests and unrelated user changes.
- Do not read, print, modify, or commit real `.env`, credentials, runtime databases, uploads, or user documents.
- Do not claim the 30% target is met until compatible real baseline and optimized benchmarks have been run and compared.
- If the first local comparison misses the target or quality guardrail, use its hotspot data for a focused follow-up optimization iteration rather than weakening the benchmark.

## Token audit

Implement the Token Audit and optimization iteration for the existing Econet Bot.

Before editing, read `AGENTS.md`, `Spec.md`, `TokenAuditSpec.md`, `README.md`, `package.json`, and the relevant source/tests. Treat `Spec.md` as authoritative for existing functional and security behavior; `TokenAuditSpec.md` is the authoritative supplement for observability, benchmark, dashboard, report, and optimization requirements.

Work on the completed RAG agent in place. Add exact Ollama usage capture where available, fail-open SQLite audit persistence, shared LLM/tool instrumentation, context/repetition estimates, truthful configurable cost calculation, a privacy-safe terminal dashboard, reproducible baseline/optimized benchmark and comparison, Markdown report generation, and the bounded optimizations required by `TokenAuditSpec.md`. Preserve Telegram behavior, JSONL worker isolation, history, RAG ownership and grounding, Skills, `exec`, limits, safe errors, and existing tests.

Do not store or log prompts, responses, commands, queries, document text, tool output, source filenames, user/chat IDs, secrets, or reusable content hashes. Do not add external observability services, a web UI, a tracing framework, or change the model/dataset/scoring between benchmark profiles. Do not claim the 30% target until real compatible Ollama runs prove it.

You may install required local dependencies and run static checks such as type-checking. Write/update deterministic tests and the benchmark dataset, but do not run tests, benchmarks, the bot/worker/Ollama, or real network/model requests. Do not read or modify the real `.env`; I will validate locally.

Work autonomously unless genuinely blocked. At the end report only:

1. changed files and implemented behavior;
2. the exact metrics, privacy boundaries, and implemented optimizations;
3. key decisions or justified deviations from `TokenAuditSpec.md`;
4. remaining risks, including anything that requires real benchmark evidence;
5. exact commands, in order, for type-checking, tests, baseline benchmark, optimized benchmark, comparison, dashboard, report generation, and manual startup.
