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
                for (const result of results) messages.push({ role: "tool", ...result });
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
});
