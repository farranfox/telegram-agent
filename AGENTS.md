# Project instructions

## Code style

Formatting and linting are the source of truth: `.prettierrc.js` and
`eslint.config.js`.

- Do not disable ESLint rules inline with `eslint-disable` unless an adjacent
  comment explains why the exception is necessary.
- Run `npm run format:check`, `npm run lint`, and `npm test` after relevant
  changes.
- Use TDD: add or adjust a failing test before implementing a behavior, then
  make it pass and refactor with the suite still green.
- Keep public interfaces and their implementations in separate, logically
  named files. Prefer explicit names over catch-all modules.
- Write commit messages and pull-request titles in Conventional Commits style,
  for example `feat(agent): add bounded tool loop`.

## Architecture

The agent core must not import Telegram, SQLite, Docker, or a provider SDK.
It receives a `dialogId`, user text, and an optional `AbortSignal`, then runs
the bounded LLM/tool loop.

- `src/agent/` contains the agent loop, agent message types, limits, clock,
  system-prompt contract, and agent-specific errors.
- `src/storage/` contains `MessageStorage` and `DialogStorage` contracts plus
  their SQLite implementations. Messages are scoped by `dialog_id`; an active
  dialog is scoped by `participant_id`.
- `src/llm/` contains `LlmClient` and OpenAI-compatible provider adapters.
  Adapters normalize provider responses to one internal tool-call format.
- `src/tools/` contains tool contracts, registry, skills loader, and the
  Docker-backed `exec` implementation. Tool failures return structured data to
  the model rather than escaping the agent loop.
- `src/runtime/` contains the participant queue, active-run registry, update
  deduplication, and application orchestration. Runs are cancelled with
  `AbortController`; there is no agent process per LLM call.
- `src/telegram/` is the transport boundary. `toTelegramMessage` lives in
  `TelegramMessage.ts`; `main.ts` registers Telegraf handlers and delegates to
  `TelegramMessageHandler`.
- `src/main.ts` is the composition root and is the only module that knows all
  concrete implementations.

Use these domain terms consistently:

- `participant_id`: `tg:{chat_id}:{user_id}`.
- `dialog_id`: UUID identifying an isolated memory dialog; `/new` switches to
  a new dialog without deleting older history.
- `run_id`: UUID for one user message through its final response and resource
  cleanup.

## Agent loop and persistence

- Persist user messages, final assistant messages, and completed tool turns.
- A tool turn persists assistant `tool_calls_json` and every matching tool
  result in one SQLite transaction.
- Preserve valid assistant/tool protocol pairs when trimming context.
- Enforce the configured limits for rounds, tool calls, retries, output size,
  context, and wall-clock time.
- On `/stop` or `/new`, propagate an `AbortSignal` to the LLM client and Docker
  executor. Do not write a fabricated final assistant answer after cancellation.
- `exec` runs only inside the short-lived Docker sandbox. Never mount the
  repository, SQLite database, home directory, or `.env` into it.
