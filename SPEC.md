# Telegram LLM Bot Specification

## 1. Purpose

Build a minimal Telegram chatbot in Node.js and TypeScript. For every valid text message, the bot sends one independent request to an OpenAI-compatible LLM endpoint and replies in the same Telegram chat with the model's answer.

The processing flow is:

`Telegram user message -> message validation -> LLM chat completion -> Telegram bot reply`

This is the first version of a future AI agent. It is deliberately stateless: no conversation history, user memory, database, queue, tool loop, or agent loop is part of this scope.

## 2. Scope and Acceptance Criteria

The implementation is complete when all of the following are true:

1. `main()` in `main.ts` is the single application entry point and starts Telegram long polling.
2. A Telegram text message is validated before any LLM request is made.
3. A valid message produces exactly one Chat Completions request containing the system prompt and that message only.
4. The returned text is sent back to the originating Telegram chat.
5. Invalid messages receive a clear validation reply and never reach the LLM.
6. The Telegram handler depends on application contracts, not Telegraf/OpenAI provider details beyond its Telegram input/output boundary.
7. Runtime configuration comes from environment variables, and `.env.example` documents it.
8. Winston Console logging is available through `LoggerInterface` and is created in `main()`.
9. The code is modular and covered by Vitest tests written before or alongside production code in a TDD workflow.

## 3. Technology and Runtime

- Runtime: Node.js, TypeScript (strict mode recommended).
- Telegram SDK: `telegraf`.
- LLM client: `openai` using the **Chat Completions API** only.
- Tests: `vitest`.
- Logging: `winston` with `Console` transport.
- Configuration: environment variables. Use Node's environment-file support or an equivalent configuration bootstrap so `.env` can be used locally; do not commit `.env`.

Use an OpenAI-compatible HTTP API for every configured provider. This supports Ollama/llama.cpp, vLLM, OpenAI, Anthropic-compatible gateways, z.ai, and other compatible services without changing the message handler. A provider may require its own compatible base URL and API key.

## 4. Configuration

Read and validate configuration once at startup, before constructing third-party clients. Fail fast with a useful startup error when a required value is absent or invalid. Never log tokens or API keys.

Required variables:

| Variable             | Description                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token. Must be non-empty.                                                                             |
| `LLM_PROVIDER`       | Human-readable provider identifier, e.g. `ollama`, `openai`, `vllm`, or `zai`. Used for configuration/log context. |
| `LLM_BASE_URL`       | OpenAI-compatible API base URL for the selected provider.                                                          |
| `LLM_MODEL`          | Model name passed to Chat Completions.                                                                             |
| `LOG_LEVEL`          | Winston log level, e.g. `debug`, `info`, `warn`, or `error`.                                                       |

`LLM_API_KEY` is optional in `.env.example`: use it when the selected provider requires authentication; use a safe non-secret placeholder/default only where the compatible server requires one (for example, a local endpoint). Its absence must not prevent local Ollama-style setups from starting.

Create `.env.example` with this baseline (without a real token):

```env
LOG_LEVEL="debug"
LLM_MODEL="llama3.2"
LLM_PROVIDER="ollama"
LLM_BASE_URL="http://127.0.0.1:11434"
LLM_API_KEY=""
TELEGRAM_BOT_TOKEN=""
```

The base URL must be passed through the OpenAI client's `baseURL` option. The implementation may normalize a trailing slash if needed, but must document the expected OpenAI-compatible endpoint format (many providers expose an `/v1` endpoint).

## 5. Architecture

Use dependency injection from the composition root, `main()`. No module should read `process.env` except configuration loading, and no application service should construct its own logger, Telegram bot, or OpenAI client.

Suggested module layout (all application file names use PascalCase/CamelCase):

```text
src/
  main.ts
  Config.ts
  LoggerInterface.ts
  WinstonLogger.ts
  LlmClientInterface.ts
  OpenAiLlmClient.ts
  MessageValidator.ts
  TelegramMessageHandler.ts
tests/
  Config.spec.ts
  WinstonLogger.spec.ts
  OpenAiLlmClient.spec.ts
  MessageValidator.spec.ts
  TelegramMessageHandler.spec.ts
  main.spec.ts
```

The exact directories may differ, but preserve the responsibilities and naming rules below. Configuration files that follow ecosystem conventions (for example `package.json`, `tsconfig.json`, and `.env.example`) retain their conventional names.

### 5.1 Contracts

Define contracts using TypeScript interfaces/types with PascalCase names.

- `LoggerInterface`: exposes at least `debug`, `info`, `warn`, and `error`, accepting a message and optional safe metadata.
- `LlmClientInterface`: exposes a method such as `complete(prompt: string): Promise<string>`. It represents a one-turn LLM request and exposes no OpenAI SDK types to the handler.
- `TelegramMessageHandler`: application-facing handler for a normalized Telegram message input containing optional `chatId` and optional `text`. It returns or sends a user-facing reply through an injected reply abstraction/callback.

`OpenAiLlmClient` implements `LlmClientInterface`. It owns all use of the `openai` package and calls `client.chat.completions.create(...)` with the configured model.

The Telegram update adapter extracts only the needed `chat.id` and `message.text`, then invokes `TelegramMessageHandler`. The handler must not know which provider, endpoint, model, or OpenAI SDK is in use.

### 5.2 LLM Request

For every valid incoming message, create one independent Chat Completions request:

```ts
messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
];
```

The system prompt must be a small constant, kept close to the LLM adapter/service. It must at minimum require the model to return a helpful answer of no more than 1024 characters. It should also instruct the model not to claim actions it did not perform.

Do not include previous Telegram messages, previous completions, or any persistent state. Select the first completion choice and extract its textual content. If the model returns no usable textual content, log the condition and send a concise, friendly fallback to the user rather than sending `undefined`.

## 6. Message Validation and Replies

Validate Telegram input before calling the LLM:

- `chatId` must exist and be usable as a Telegram chat identifier.
- `text` must exist and be a string.
- The text must contain from 1 to 1024 characters inclusive. Whitespace-only input is invalid.
- Count user-visible Unicode code points rather than UTF-16 code units where practical.

Use a clear Russian or English validation message consistently, for example: `Please send a non-empty text message up to 1024 characters.` The reply must be sent only when a chat ID is available; if no chat ID exists, log a warning because a reply is impossible.

For supported text messages, reply to the same `chatId`. Ignore unsupported Telegram update types safely and log at debug level; they must not crash the polling process.

## 7. Errors and Logging

Create one `WinstonLogger` in `main()` using `winston` and a `Console` transport configured with `LOG_LEVEL`, then inject it into the handler and services that need it.

Log startup, polling startup/shutdown, validation failures, LLM request failures, and Telegram reply failures with useful non-secret context such as provider name, model name, chat ID (where policy permits), and error category. Do not log bot tokens, API keys, or full user prompts by default.

If the LLM request fails, log the error and send a concise user-facing failure message such as `I could not get a response right now. Please try again later.` The process must remain available for later messages. Handle Telegraf polling errors and graceful termination (`SIGINT`/`SIGTERM`) by stopping the bot cleanly.

## 8. `main()` Composition and Lifecycle

`main()` must:

1. Load and validate environment configuration.
2. Create the Winston-backed `LoggerInterface`.
3. Create the OpenAI client/`OpenAiLlmClient` configured from LLM settings.
4. Create the Telegraf bot from `TELEGRAM_BOT_TOKEN`.
5. Register the Telegram text-message handler, injecting the application handler and logger.
6. Start Telegraf long polling via `bot.launch()`.
7. Register graceful shutdown handlers that call `bot.stop(...)`.

Export `main()` for testability. Invoke it only from the executable startup guard/entry bootstrap so importing it in a test does not begin polling.

## 9. TDD and Testing

Use red-green-refactor: first write a failing unit test that specifies one behavior, implement only enough to make it pass, then refactor while keeping tests green.

Test file names must match the tested class/file name with the `.spec` suffix, for example `MessageValidator.spec.ts` for `MessageValidator.ts` and `OpenAiLlmClient.spec.ts` for `OpenAiLlmClient.ts`.

At minimum, cover:

- configuration parsing and required-variable failures;
- valid text, missing chat ID, missing text, whitespace-only text, empty text, 1-character text, 1024-character text, and over-limit text;
- handler behavior: invalid input replies without calling the LLM; valid input calls the LLM once and sends its answer to the original chat;
- each request has the system message plus only the current user message;
- LLM adapter maps configuration to the OpenAI Chat Completions call and handles empty completion content;
- LLM and Telegram failures are logged and result in safe behavior;
- `main()` wiring registers the handler and starts/stops polling using mocks (never real network calls).

Mock Telegraf and OpenAI boundaries in unit tests. Tests must not require real Telegram credentials, a running Ollama instance, or network access.

## 10. Repository Hygiene

Create `.gitignore` before other implementation work and include exactly these required entries at minimum:

```gitignore
.env
node_modules
```

Do not commit `.env`, secrets, generated credentials, or dependency directories. Commit `.env.example`, source code, tests, and project configuration.

## 11. Out of Scope

- Conversation/history storage and multi-turn context.
- Databases, user accounts, authorization, analytics, and rate limiting.
- Streaming responses, voice/media handling, tools/function calling, RAG, and an autonomous agent loop.
- Provider-specific SDKs or provider-specific behavior outside the OpenAI-compatible Chat Completions contract.
