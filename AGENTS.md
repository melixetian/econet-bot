# Repository instructions

## Project and sources of truth

This educational project is a minimal TypeScript/Node.js Telegram AI agent. It
uses long polling, per-chat SQLite history, a bounded Ollama tool-calling loop,
document RAG backed by SQLite/sqlite-vec, a native document-search tool, and one
universal shell tool. The canonical requirements, externally observable
behavior, architecture, configuration, constraints, and acceptance criteria are
in [Spec.md](Spec.md).
User setup and operation are documented in [README.md](README.md).

Keep `AGENTS.md`, `Spec.md`, and `README.md` mutually consistent. Do not duplicate
the full specification here.

## Architecture and boundaries

- The Telegram bot and inference worker must remain separate OS processes that
  communicate through the JSONL protocol defined in `Spec.md`.
- Message handling retains only the specified per-chat user/final-assistant
  SQLite history. Never persist system prompts, Skills, tool calls/results,
  commands, failed turns, or secrets.
- `InferenceProvider` is the replaceable inference plugin boundary. Provider
  selection and provider implementations belong to the worker side.
- Telegram code may depend on the inference client abstraction, but must not
  import or call Ollama or another provider directly.
- Provider code must remain independent of Telegram. IPC framing and correlation
  belong in the protocol/client/worker layer, not in providers.
- Telegram derives document ownership from the validated sender. The worker owns
  extraction, embeddings, storage, and retrieval, and vector KNN queries filter
  that trusted user ID inside the query.
- Preserve these dependency directions and existing behavior unless the task
  explicitly changes them.

## Commands

Commands are defined in `package.json`:

- `npm run typecheck` — type-check without emitting files.
- `npm test` — run the Vitest suite once. Agents must not run this command.
- `npm run test:offline` — explicit alias for the offline Vitest suite. Agents must not run it.
- `npm run evaluate` — run deterministic RAG retrieval evaluation. Agents must not run it.
- `npm run eval:models` — run the isolated behavioral benchmark against `EVAL_MODELS`. Agents must not run it.
- `npm run audit:benchmark -- --profile baseline|optimized --label <label>` — run the real local Ollama token benchmark. Agents must not run it.
- `npm run audit:preflight` — validate fixtures and local Ollama before measurement. Agents must not run it.
- `npm run audit:benchmark:pair -- --before <label> --after <label>` — run comparable profiles in one isolated cohort and save distinct logs/comparison. Agents must not run it.
- `npm run audit:run` — run preflight and a fresh timestamp-labelled pair, then collect comparison, dashboard, and report artifacts even when acceptance fails. Agents must not run it.
- `npm run audit:compare -- --before <label> --after <label>` — compare compatible benchmark results without model access.
- `npm run audit:dashboard` — inspect privacy-safe local audit metrics without model access.
- `npm run audit:report -- --before <label> --after <label> --out <path>` — generate the Markdown audit report.
- `npm run build` — compile application sources to `dist/`.
- `npm run dev` — run the TypeScript bot and its worker. Agents must not run it.
- `npm start` — run the compiled bot and its worker. Agents must not run it.

## Security and execution constraints

- Never read, print, expose, commit, or replace secrets from `.env`.
- Use `.env.example` for documented configuration and test fixtures.
- Never run tests, evaluation, token benchmarks, start the Telegram bot, inference worker,
  Ollama, or any other service, and never make real Telegram or Ollama requests.
- Give the user the exact validation or run commands to execute. Diagnose only
  command output the user supplies, then make the smallest necessary correction.
- Do not commit, push, or modify Git history unless the user explicitly requests
  it.

## Implementation principles

- Prefer the smallest correct solution for the requested scope.
- Do not add production infrastructure, generic abstractions, or dependencies
  without a concrete requirement.
- Preserve existing behavior unless the task explicitly changes it.
- Add or update focused tests when behavior changes, but leave execution to the
  user.

## Documentation maintenance

- Any change to behavior, architecture, configuration, interfaces, IPC protocol,
  dependencies, or acceptance criteria must update `Spec.md` in the same task.
- Any change to installation, commands, configuration, or user-facing operation
  must update `README.md` in the same task.
- Internal refactoring that does not change documented behavior should not cause
  cosmetic documentation rewrites.
- Documentation must describe the resulting implementation, never planned or
  obsolete behavior.
- If a requested change conflicts with `Spec.md`, update the specification
  explicitly instead of silently diverging from it.

## Agent workflow

1. Read `AGENTS.md`, `Spec.md`, relevant documentation, and affected code before editing.
2. Implement only the requested scope.
3. Add or update tests when behavior changes; do not run them.
4. Update the specification and README in the same change when the maintenance rules above apply.
5. Summarize code changes, assumptions, documentation updates, and validation status, including exact commands for the user to run.
