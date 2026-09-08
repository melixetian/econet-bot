# Prompts for project

## Initial prompt for Codex

Implement the project defined in `Spec.md` in the current repository.

Treat the specification as the source of truth. First inspect the repository and preserve any relevant existing work. Then implement the smallest complete solution that satisfies every requirement and acceptance criterion. Do not expand the scope or introduce unnecessary abstractions or dependencies.

Important execution constraint: create all source files, configuration, documentation, and tests, but **do not run tests and do not start the bot, inference worker, Ollama, or any other service**. Do not make real Telegram or Ollama requests. At the end:

1. summarize what you implemented;
2. list any assumptions or deviations from the specification (write `None` if there are none);
3. provide the exact commands I should run to install dependencies, type-check, test, build, and start the application, in the recommended order.

If my command output later reveals an error, diagnose it and make the minimal necessary fix, again without running tests or services yourself.


## Prompt for installing ollama

Помоги мне интерактивно установить и настроить локальную модель Ollama для Telegram-бота в этом репозитории.

Общайся со мной на русском языке, объясняй назначение команд и двигайся небольшими этапами: давай следующий шаг только после проверки предыдущего.

Мой компьютер:

* MacBook Pro 2019;
* Intel Core i7, 6 ядер;
* Intel UHD Graphics 630;
* 16 ГБ RAM.

Текущая конфигурация проекта:

```env
INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:1.7b
LLM_TIMEOUT_MS=60000
```

Сначала прочитай `AGENTS.md` и относящуюся к задаче документацию проекта.

Предпочтительная модель — `qwen3:1.7b`. Сначала настрой и проверь её. Если по фактическим измерениям она окажется непрактично медленной, предложи `qwen2.5:1.5b` как запасной вариант.

Ты можешь самостоятельно выполнять безопасные команды, которые только проверяют систему, установленные программы и состояние локального API. Не читай и не показывай `.env`, токены или другие секреты.

Я самостоятельно выполняю команды, которые:

* устанавливают или обновляют программы;
* скачивают модели;
* запускают или останавливают Ollama и другие сервисы;
* отправляют inference-запросы;
* запускают бота или тесты.

Давай мне такие команды, объясняй ожидаемый результат и проси прислать вывод для проверки.

Проведи настройку в следующем порядке:

1. Проверь версию macOS, архитектуру, свободное место и наличие Ollama.
2. Если требуется, помоги установить Ollama официальным способом.
3. Помоги запустить локальный сервер и скачать `qwen3:1.7b`.
4. Подготовь короткий тест для `/api/generate` с тем же форматом запроса, который использует приложение.
5. Оцени корректность ответа, холодный и повторный запуск, необходимость `think: false` и достаточность тайм-аута 60 секунд.
6. Убедись, что итоговая модель и параметры совпадают с конфигурацией проекта.

Не меняй модель, код или документацию без фактической необходимости и моего подтверждения. Если изменения понадобятся, внеси их минимально и синхронно актуализируй спецификацию и README.

Настройка завершена, когда выбранная модель успешно отвечает через локальный HTTP API в формате, совместимом с приложением. В конце кратко зафиксируй итоговую модель, параметры и команды для дальнейшего запуска.

## Prompt for agentic implementation

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
