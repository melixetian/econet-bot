# Prompt for Codex

Implement the project defined in `telegram-llm-bot-spec.md` in the current repository.

Treat the specification as the source of truth. First inspect the repository and preserve any relevant existing work. Then implement the smallest complete solution that satisfies every requirement and acceptance criterion. Do not expand the scope or introduce unnecessary abstractions or dependencies.

Important execution constraint: create all source files, configuration, documentation, and tests, but **do not run tests and do not start the bot, inference worker, Ollama, or any other service**. Do not make real Telegram or Ollama requests. At the end:

1. summarize what you implemented;
2. list any assumptions or deviations from the specification (write `None` if there are none);
3. provide the exact commands I should run to install dependencies, type-check, test, build, and start the application, in the recommended order.

If my command output later reveals an error, diagnose it and make the minimal necessary fix, again without running tests or services yourself.
