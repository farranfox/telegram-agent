# Telegram Agent

Telegram-агент на TypeScript. Ядро не зависит от Telegram, SQLite, Docker или
конкретного LLM-провайдера. Оно хранит историю диалога в SQLite, выполняет
ограниченный agentic loop и возвращает итоговый текст адаптеру Telegram.

Инструмент `exec` выполняется только в краткоживущем Docker sandbox; репозиторий,
`.env`, домашняя директория и SQLite-файл в него не монтируются.

Sandbox запускается в отдельной bridge-сети, поэтому не видит другие локальные
контейнеры, а `host.docker.internal` перекрыт на loopback. При этом исходящий
доступ в интернет остаётся открытым — он нужен skill'ам с `curl`. Модель может
отправить наружу всё, что попало к ней в контекст; фильтрация egress потребовала бы
`internal`-сети с явным proxy и в текущий объём не входит.

## Требования

- Node.js 22+;
- Docker Desktop или Docker Engine, запущенный локально;
- Telegram bot token от [@BotFather](https://t.me/BotFather);
- LLM с OpenAI-compatible Chat Completions API и поддержкой tools.

Для локального запуска подходит Ollama с `llama3.2:3b` или `qwen2.5:7b`.

## Первый запуск

1. Установите npm-зависимости:

    ```bash
    npm install
    ```

2. Создайте локальную конфигурацию:

    ```bash
    cp .env.example .env
    ```

3. Заполните `.env`:

    ```env
    LOG_LEVEL="info"
    TELEGRAM_BOT_TOKEN="ваш-токен"
    LLM_BASE_URL="http://127.0.0.1:11434/v1"
    LLM_MODEL="qwen2.5:7b"
    LLM_API_KEY=""
    SQLITE_PATH="data/agent.sqlite"
    ```

    `LLM_API_KEY` оставьте пустым для Ollama. Для внешнего OpenAI-compatible
    провайдера укажите его base URL, имя модели и API key.

4. Если используется Ollama, скачайте модель и запустите сервер:

    ```bash
    ollama pull qwen2.5:7b
    ollama serve
    ```

5. Соберите Docker image для `exec` один раз или после изменения
   `sandbox-runner/Dockerfile`:

    ```bash
    docker compose -f sandbox-runner/compose.yaml build
    ```

6. Для разработки запустите бота с автоматическим перезапуском:

    ```bash
    npm run dev
    ```

    Эта команда использует Node `--watch`: при изменении TypeScript-файлов
    процесс перезапускается, поэтому активные in-memory runs отменяются.

7. Откройте бота в Telegram и отправьте сообщение. Команды:

    ```text
    /start — приветствие
    /new   — новый диалог, старая история остаётся в SQLite
    /stop  — отмена активного run
    ```

## Production-запуск

```bash
npm run start
```

Команда сначала компилирует TypeScript в `dist/`, затем запускает
`dist/main.js`. Hot reload в production-режиме отсутствует.

## Проверки

```bash
npm run format:check
npm run lint
npm test
npm run build
```

## Архитектура

```text
Telegram → TelegramMessageHandler → DialogRunService → Agent
                                      │                 │
                                SQLite dialogs     LlmClient + ToolRunner
                                                        │
                                                    Docker exec sandbox
```

История хранится по `dialog_id`; активный dialog выбирается по
`participant_id = tg:{chat_id}:{user_id}`. Tool turn сохраняется одной
транзакцией: assistant `tool_calls_json` и все соответствующие tool results.
