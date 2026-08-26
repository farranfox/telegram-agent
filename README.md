# Telegram LLM Bot

Простой Telegram-бот на TypeScript: получает текст пользователя, передаёт его
модели через OpenAI-совместимый API и возвращает ответ в тот же чат. История
диалога пока не сохраняется — каждое сообщение обрабатывается независимо.

## Запуск

1. Установите зависимости:

    ```bash
    npm install
    ```

2. Создайте локальный файл конфигурации и заполните токен Telegram-бота:

    ```bash
    cp .env.example .env
    ```

    Укажите в `.env` значение `TELEGRAM_BOT_TOKEN`. Для Ollama оставьте
    `LLM_PROVIDER="ollama"`, модель `llama3.2` и адрес
    `LLM_BASE_URL="http://127.0.0.1:11434/v1"`.

3. Если Ollama и модель ещё не установлены, загрузите модель:

    ```bash
    ollama run llama3.2
    ```

4. В отдельном терминале запустите сервер Ollama:

    ```bash
    ollama serve
    ```

5. Запустите Telegram-бота:

    ```bash
    npm run start
    ```

6. Откройте бота в Telegram, нажмите **Start** и отправьте текстовое сообщение.

## Проверки

```bash
npm test
npm run lint
npm run format:check
```

Ollama поддерживает два API: нативный `/api/chat` и OpenAI-совместимый
`/v1/chat/completions`. Этот проект использует второй вариант через библиотеку
`openai`. Если у Ollama в `LLM_BASE_URL` не указан `/v1`, приложение добавит его
автоматически.
