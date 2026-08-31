import { describe, expect, it, vi } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { AgentMessage } from "../src/agent/AgentMessage.js";
import type { LlmClient } from "../src/llm/LlmClient.js";
import type { MessageStorage } from "../src/storage/MessageStorage.js";
import type { ToolRunner } from "../src/tools/ToolRunner.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("Agent", () => {
    it("persists a tool turn and returns the model final answer", async () => {
        const messages: AgentMessage[] = [];
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async (_dialogId, content) => {
                messages.push({ role: "assistant", content });
            }),
            appendToolTurn: vi.fn(async (_dialogId, content, calls, results) => {
                messages.push({ role: "assistant", content, toolCalls: calls });
                for (const result of results) {
                    messages.push({ role: "tool", ...result });
                }
            }),
            appendUser: vi.fn(async (_dialogId, content) => {
                messages.push({ role: "user", content });
            }),
            loadContext: vi.fn(async () => messages),
        };
        const llm: LlmClient = {
            complete: vi
                .fn()
                .mockResolvedValueOnce({
                    content: "",
                    toolCalls: [{ id: "call_weather", name: "weather", arguments: "{}" }],
                })
                .mockResolvedValueOnce({ content: "Сегодня солнечно.", toolCalls: [] }),
        };
        const tools: ToolRunner = {
            disposeRun: vi.fn(async () => undefined),
            run: vi.fn(async () => ({ ok: true as const, output: "sunny" })),
            specs: vi.fn(() => [{ name: "weather", description: "Weather", parameters: { type: "object" } }]),
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: tools,
        });

        await expect(agent.run("dialog-1", "Какая погода?")).resolves.toBe("Сегодня солнечно.");
        expect(storage.appendToolTurn).toHaveBeenCalledOnce();
        expect(llm.complete).toHaveBeenCalledTimes(2);
        expect(tools.disposeRun).toHaveBeenCalledOnce();
        expect(logger.debug).toHaveBeenCalledWith("agent.tool.call", expect.objectContaining({ name: "weather" }));
        expect(logger.debug).toHaveBeenCalledWith(
            "agent.tool.result",
            expect.objectContaining({ ok: true, result: "sunny" }),
        );
        expect(logger.info).toHaveBeenCalledWith(
            "agent.run.completed",
            expect.objectContaining({ dialogId: "dialog-1" }),
        );
    });

    it("forces a text response after the tool round limit", async () => {
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async () => undefined),
            appendToolTurn: vi.fn(async () => undefined),
            appendUser: vi.fn(async () => undefined),
            loadContext: vi.fn(async () => []),
        };
        const llm: LlmClient = {
            complete: vi
                .fn()
                .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "one", name: "x", arguments: "{}" }] })
                .mockResolvedValueOnce({ content: "Финальный ответ", toolCalls: [] }),
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            limits: { maxRounds: 2, toolRoundLimit: 1 },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: {
                disposeRun: async () => undefined,
                run: async () => ({ ok: true, output: "ok" }),
                specs: () => [{ name: "x", description: "x", parameters: {} }],
            },
        });

        await expect(agent.run("dialog-1", "test")).resolves.toBe("Финальный ответ");
        expect(llm.complete).toHaveBeenLastCalledWith(expect.any(Array), null, expect.any(AbortSignal));
    });

    // Вариант B: когда модель в одном turn зовёт load_skill и exec, exec не исполняется
    // и вообще не попадает в контекст — модель на следующем шаге видит только результат skill'а.
    it("drops exec from the turn when load_skill is requested alongside it", async () => {
        const contexts: AgentMessage[][] = [];
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async () => undefined),
            appendToolTurn: vi.fn(async () => undefined),
            appendUser: vi.fn(async () => undefined),
            loadContext: vi.fn(async () => []),
        };
        const llm: LlmClient = {
            complete: vi.fn(async (messages: AgentMessage[]) => {
                contexts.push(structuredClone(messages));
                if (contexts.length === 1) {
                    return {
                        content: "",
                        toolCalls: [
                            { id: "skill", name: "load_skill", arguments: '{"name":"weather"}' },
                            { id: "invalid-exec", name: "exec", arguments: '{"command":"wttr.in -d antalya"}' },
                        ],
                    };
                }
                if (contexts.length === 2) {
                    return {
                        content: "",
                        toolCalls: [
                            {
                                id: "weather-exec",
                                name: "exec",
                                arguments: '{"command":"curl -fsSL https://wttr.in/Antalya?format=1"}',
                            },
                        ],
                    };
                }
                return { content: "В Анталии солнечно.", toolCalls: [] };
            }),
        };
        const tools: ToolRunner = {
            disposeRun: async () => undefined,
            run: vi.fn(async (_runId, call) => ({ ok: true as const, output: call.name })),
            specs: () => [],
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: tools,
        });

        await expect(agent.run("dialog-1", "Какая погода в Анталии?")).resolves.toBe("В Анталии солнечно.");

        // Выдуманная команда `wttr.in -d antalya` не исполнялась: run вызван для load_skill, затем для curl.
        expect(tools.run).toHaveBeenCalledTimes(2);
        expect(tools.run).toHaveBeenNthCalledWith(
            1,
            expect.any(String),
            expect.objectContaining({ name: "load_skill" }),
            expect.any(AbortSignal),
        );
        expect(tools.run).toHaveBeenNthCalledWith(
            2,
            expect.any(String),
            expect.objectContaining({ arguments: expect.stringContaining("curl"), name: "exec" }),
            expect.any(AbortSignal),
        );

        // Контекст round 2: assistant-сообщение содержит ровно один tool_call (load_skill),
        // а среди tool-сообщений нет ни одной ошибки — модели нечего интерпретировать как провал.
        const secondRound = contexts[1];
        const assistantTurn = secondRound.find((message) => message.role === "assistant");
        expect(assistantTurn).toMatchObject({ toolCalls: [expect.objectContaining({ name: "load_skill" })] });
        expect(secondRound.filter((message) => message.role === "tool")).toEqual([
            { role: "tool", toolCallId: "skill", content: JSON.stringify({ output: "load_skill" }) },
        ]);

        // В историю диалога тоже пишется только реально исполненный вызов.
        expect(storage.appendToolTurn).toHaveBeenNthCalledWith(
            1,
            "dialog-1",
            "",
            [expect.objectContaining({ id: "skill", name: "load_skill" })],
            [{ toolCallId: "skill", content: JSON.stringify({ output: "load_skill" }) }],
        );
    });

    // Регрессия на исходный баг: llama3.2, увидев в контексте ошибку инструмента, сдавалась
    // и отвечала «Из-за ошибки ... не может предоставить эту информацию», не повторив exec.
    // Модель здесь ведёт себя так же — тест проходит только если ей не показали ошибку.
    it("completes the skill flow even with a model that surrenders on any tool error", async () => {
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async () => undefined),
            appendToolTurn: vi.fn(async () => undefined),
            appendUser: vi.fn(async () => undefined),
            loadContext: vi.fn(async () => []),
        };
        let turns = 0;
        const llm: LlmClient = {
            complete: vi.fn(async (messages: AgentMessage[]) => {
                const sawToolError = messages.some(
                    (message) => message.role === "tool" && message.content.includes('"error"'),
                );
                if (sawToolError) {
                    return { content: "Из-за ошибки не могу предоставить эту информацию.", toolCalls: [] };
                }
                turns += 1;
                if (turns === 1) {
                    return {
                        content: "",
                        toolCalls: [
                            { id: "skill", name: "load_skill", arguments: '{"name":"weather"}' },
                            { id: "invalid-exec", name: "exec", arguments: '{"command":"wttr.in -d antalya"}' },
                        ],
                    };
                }
                if (turns === 2) {
                    return {
                        content: "",
                        toolCalls: [
                            {
                                id: "weather-exec",
                                name: "exec",
                                arguments: '{"command":"curl -fsSL https://wttr.in/Antalya?format=1"}',
                            },
                        ],
                    };
                }
                return { content: "Antalya: ☀️ +27°C", toolCalls: [] };
            }),
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: {
                disposeRun: async () => undefined,
                run: async (_runId, call) => ({ ok: true, output: call.name }),
                specs: () => [],
            },
        });

        await expect(agent.run("dialog-1", "Какая погода в Анталии?")).resolves.toBe("Antalya: ☀️ +27°C");
        expect(llm.complete).toHaveBeenCalledTimes(3);
    });

    // C.1: при исчерпании бюджета на один ответ выполняются первые maxToolCallsPerResponse
    // вызовов, а остальные получают НЕ ошибку, а нейтральный статус с указанием
    // ответить по уже полученным данным. Раньше здесь был error-конверт — та же мина,
    // из-за которой модель капитулировала в разрыве A.
    it("marks over-budget tool calls as skipped, not as an error", async () => {
        const persisted: Array<{ toolCallId: string; content: string }> = [];
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async () => undefined),
            appendToolTurn: vi.fn(async (_dialogId, _content, _calls, results) => {
                persisted.push(...results);
            }),
            appendUser: vi.fn(async () => undefined),
            loadContext: vi.fn(async () => []),
        };
        const llm: LlmClient = {
            complete: vi
                .fn()
                .mockResolvedValueOnce({
                    content: "",
                    toolCalls: [
                        { id: "one", name: "exec", arguments: '{"command":"echo 1"}' },
                        { id: "two", name: "exec", arguments: '{"command":"echo 2"}' },
                        { id: "three", name: "exec", arguments: '{"command":"echo 3"}' },
                        { id: "four", name: "exec", arguments: '{"command":"echo 4"}' },
                    ],
                })
                .mockResolvedValueOnce({ content: "Готово по трём результатам.", toolCalls: [] }),
        };
        const tools: ToolRunner = {
            disposeRun: async () => undefined,
            run: vi.fn(async (_runId, call) => ({ ok: true as const, output: `ran ${call.id}` })),
            specs: () => [],
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            limits: { maxToolCallsPerResponse: 3 },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: tools,
        });

        await expect(agent.run("dialog-1", "четыре команды")).resolves.toBe("Готово по трём результатам.");

        // Первые три исполнены, четвёртая — нет.
        expect(tools.run).toHaveBeenCalledTimes(3);
        expect(persisted.map((result) => result.toolCallId)).toEqual(["one", "two", "three", "four"]);
        expect(persisted.slice(0, 3).map((result) => JSON.parse(result.content))).toEqual([
            { output: "ran one" },
            { output: "ran two" },
            { output: "ran three" },
        ]);

        // Четвёртая помечена пропущенной, без слова error, и несёт указание, что делать.
        const overBudget = JSON.parse(persisted[3].content) as Record<string, unknown>;
        expect(overBudget).toEqual({
            status: "skipped",
            reason: "tool_budget",
            note: "No further tool calls will run in this step. Answer the user from the results you already have.",
        });
        expect(persisted[3].content).not.toContain("error");
    });

    // Разрыв B: модель загрузила инструкцию skill'а и закончила текстом, не выполнив
    // ни одного инструмента. Это почти всегда пересказ инструкции или выдуманный
    // результат, поэтому агент даёт одну корректирующую попытку вместо того,
    // чтобы отдать такой текст пользователю.
    it("retries once when the model finishes without running the skill tool", async () => {
        const requests: string[][] = [];
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async () => undefined),
            appendToolTurn: vi.fn(async () => undefined),
            appendUser: vi.fn(async () => undefined),
            loadContext: vi.fn(async () => []),
        };
        const llm: LlmClient = {
            complete: vi.fn(async (messages: AgentMessage[]) => {
                requests.push(
                    messages.filter((message) => message.role === "system").map((message) => message.content),
                );
                if (requests.length === 1) {
                    return { content: "", toolCalls: [{ id: "skill", name: "load_skill", arguments: "{}" }] };
                }
                // Второй раунд: пересказ инструкции текстом вместо вызова.
                if (requests.length === 2) {
                    return { content: 'Используй exec: curl -fsSL "https://wttr.in/…"', toolCalls: [] };
                }
                // Третий раунд наступает только благодаря коррекции.
                if (requests.length === 3) {
                    return { content: "", toolCalls: [{ id: "exec-1", name: "exec", arguments: "{}" }] };
                }
                return { content: "Antalya: +27°C", toolCalls: [] };
            }),
        };
        const tools: ToolRunner = {
            disposeRun: async () => undefined,
            run: vi.fn(async (_runId, call) => ({ ok: true as const, output: call.name })),
            specs: () => [],
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: tools,
        });

        // Пересказ не ушёл пользователю: агент дожал модель до реального вызова.
        await expect(agent.run("dialog-1", "Какая погода?")).resolves.toBe("Antalya: +27°C");
        expect(tools.run).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(
            "agent.turn.skill-not-executed",
            expect.objectContaining({ round: 2 }),
        );

        // Коррекция подмешана ровно в один раунд — третий, и убрана из четвёртого.
        expect(requests[2].some((content) => content.includes("did not run any tool afterwards"))).toBe(true);
        expect(requests[3].some((content) => content.includes("did not run any tool afterwards"))).toBe(false);
    });

    // Коррекция даётся один раз: упрямая модель не должна крутить цикл до maxRounds.
    it("gives up after a single correction instead of looping", async () => {
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async () => undefined),
            appendToolTurn: vi.fn(async () => undefined),
            appendUser: vi.fn(async () => undefined),
            loadContext: vi.fn(async () => []),
        };
        let turns = 0;
        const llm: LlmClient = {
            complete: vi.fn(async () => {
                turns += 1;
                if (turns === 1) {
                    return { content: "", toolCalls: [{ id: "skill", name: "load_skill", arguments: "{}" }] };
                }
                return { content: "Погода солнечная.", toolCalls: [] };
            }),
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: {
                disposeRun: async () => undefined,
                run: async (_runId, call) => ({ ok: true, output: call.name }),
                specs: () => [],
            },
        });

        await expect(agent.run("dialog-1", "Какая погода?")).resolves.toBe("Погода солнечная.");
        // Раунд 1 — load_skill, раунд 2 — пересказ, раунд 3 — коррекция и снова пересказ. Больше не пытаемся.
        expect(llm.complete).toHaveBeenCalledTimes(3);
        expect(logger.warn).toHaveBeenCalledWith("agent.turn.skill-not-executed-final", expect.objectContaining({}));
    });

    // Отложенный вызов не теряется молча — он должен быть виден в логах.
    it("logs the dropped tool call as deferred", async () => {
        const storage: MessageStorage = {
            appendAssistant: vi.fn(async () => undefined),
            appendToolTurn: vi.fn(async () => undefined),
            appendUser: vi.fn(async () => undefined),
            loadContext: vi.fn(async () => []),
        };
        const llm: LlmClient = {
            complete: vi
                .fn()
                .mockResolvedValueOnce({
                    content: "",
                    toolCalls: [
                        { id: "skill", name: "load_skill", arguments: '{"name":"weather"}' },
                        { id: "invalid-exec", name: "exec", arguments: '{"command":"wttr.in -d antalya"}' },
                    ],
                })
                .mockResolvedValueOnce({
                    content: "",
                    toolCalls: [{ id: "good-exec", name: "exec", arguments: '{"command":"curl -fsSL wttr.in"}' }],
                })
                .mockResolvedValueOnce({ content: "Готово.", toolCalls: [] }),
        };
        const agent = new Agent({
            clock: { now: () => 0, sleep: async () => undefined },
            llm,
            logger,
            messageStorage: storage,
            systemPromptProvider: { build: () => "system" },
            toolRunner: {
                disposeRun: async () => undefined,
                run: async () => ({ ok: true, output: "skill body" }),
                specs: () => [],
            },
        });

        await agent.run("dialog-1", "Какая погода в Анталии?");

        expect(logger.warn).toHaveBeenCalledWith(
            "agent.tool.deferred",
            expect.objectContaining({
                name: "exec",
                reason: "load_skill_must_complete_first",
                toolCallId: "invalid-exec",
            }),
        );
    });
});
