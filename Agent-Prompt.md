Implement the Minimal AI Agent upgrade defined in `Spec.md` in the current repository.

Before editing, inspect the existing project and treat its current architecture as the starting point:

- repository: https://github.com/melixetian/econet-bot
- previous specification: https://github.com/melixetian/econet-bot/blob/main/Spec.md

You may inspect the following existing solution for implementation ideas, especially its agent loop, shell tool, Skill loading, and weather instructions:

- https://github.com/larchanka/manbot/
- https://github.com/larchanka/manbot/blob/main/src/agents/executor-agent.ts
- https://github.com/larchanka/manbot/blob/main/src/services/tool-host.ts
- https://github.com/larchanka/manbot/blob/main/src/services/skill-manager.ts
- https://github.com/larchanka/manbot/blob/main/skills/weather/SKILL.md

Use those links only as references. Do not copy Manbot's large multi-agent architecture or add features outside `Spec.md`. If a reference conflicts with `Spec.md`, follow `Spec.md`.

Implement both required Skills from the specification: weather via `wttr.in` and fiat exchange rates/conversion via the Frankfurter API documented at https://frankfurter.dev/. Both Skills must use the same universal `exec` tool; do not add separate programmatic tools for them.

Implement the full specification, update existing tests, and keep `README.md`, `.env.example`, `.gitignore`, `AGENTS.md`, and `package.json` consistent with the result. Preserve working parts of the current bot and keep the solution minimal.

Do not read or expose the real `.env` or secrets. Do not run tests and do not start the bot, worker, Ollama, or any other service. Do not make real Telegram, Ollama, weather, or exchange-rate requests. When finished, summarize the changes and provide the exact validation and run commands for me to execute.
