import { randomUUID } from "node:crypto";

import type { LlmClient } from "../llm/LlmClient.js";
import type { Logger } from "../logging/Logger.js";
import type { MessageStorage } from "../storage/MessageStorage.js";
import type { ToolRunner } from "../tools/ToolRunner.js";
import { type AgentLimits, DEFAULT_AGENT_LIMITS } from "./AgentLimits.js";
import type { AgentMessage, ToolCall } from "./AgentMessage.js";
import type { Clock } from "./Clock.js";
import { AgentCancelledError } from "./errors/AgentCancelledError.js";
import { LlmError } from "./errors/LlmError.js";
import type { SystemPromptProvider } from "./SystemPromptProvider.js";

const FINAL_INSTRUCTION =
    "Инструменты недоступны. Ответь пользователю обычным текстом на основе уже полученных данных.";
const FALLBACK_EMPTY = "Модель не вернула текстовый ответ. Попробуйте переформулировать запрос.";
const FALLBACK_LIMIT = "Не удалось закончить запрос за отведённое число шагов. Попробуйте упростить запрос.";

export type AgentDependencies = {
    clock: Clock;
    limits?: Partial<AgentLimits>;
    llm: LlmClient;
    logger: Logger;
    messageStorage: MessageStorage;
    systemPromptProvider: SystemPromptProvider;
    toolRunner: ToolRunner;
};

export class Agent {
    private readonly limits: AgentLimits;

    public constructor(private readonly dependencies: AgentDependencies) {
        this.limits = { ...DEFAULT_AGENT_LIMITS, ...dependencies.limits };
    }

    public async run(
        dialogId: string,
        text: string,
        signal: AbortSignal = new AbortController().signal,
    ): Promise<string> {
        const runId = randomUUID();
        const startedAt = this.dependencies.clock.now();
        this.throwIfAborted(signal);
        await this.dependencies.messageStorage.appendUser(dialogId, text);
        const history = await this.dependencies.messageStorage.loadContext(dialogId, this.limits.contextMessages);
        const messages: AgentMessage[] = [
            { role: "system", content: this.dependencies.systemPromptProvider.build(this.dependencies.clock.now()) },
            ...repairContext(history),
        ];
        let toolsUsed = 0;

        try {
            for (let round = 1; round <= this.limits.maxRounds; round += 1) {
                this.throwIfAborted(signal);
                const toolsEnabled =
                    round <= this.limits.toolRoundLimit &&
                    toolsUsed < this.limits.maxToolExecutions &&
                    this.dependencies.clock.now() - startedAt <= this.limits.wallClockMs;
                const request: AgentMessage[] = toolsEnabled
                    ? messages
                    : [...messages, { role: "system", content: FINAL_INSTRUCTION }];
                const turn = await this.completeWithRetry(request, toolsEnabled, signal);

                if (turn.toolCalls.length === 0) {
                    const answer = turn.content.trim() || (toolsEnabled ? FALLBACK_EMPTY : FALLBACK_LIMIT);
                    await this.dependencies.messageStorage.appendAssistant(dialogId, answer);
                    return answer;
                }
                if (!toolsEnabled) {
                    const answer = turn.content.trim() || FALLBACK_LIMIT;
                    await this.dependencies.messageStorage.appendAssistant(dialogId, answer);
                    return answer;
                }

                const calls = uniqueCalls(turn.toolCalls);
                const results: Array<{ toolCallId: string; content: string }> = [];
                for (const [index, call] of calls.entries()) {
                    if (index >= this.limits.maxToolCallsPerResponse || toolsUsed >= this.limits.maxToolExecutions) {
                        results.push({ toolCallId: call.id, content: errorResult("tool_budget_exhausted") });
                        continue;
                    }
                    this.throwIfAborted(signal);
                    const result = await this.dependencies.toolRunner.run(runId, call, signal);
                    toolsUsed += 1;
                    results.push({
                        toolCallId: call.id,
                        content: truncate(stringifyToolResult(result), this.limits.toolOutputChars),
                    });
                }
                await this.dependencies.messageStorage.appendToolTurn(dialogId, turn.content, calls, results);
                messages.push({ role: "assistant", content: turn.content, toolCalls: calls });
                for (const result of results) messages.push({ role: "tool", ...result });
            }
            await this.dependencies.messageStorage.appendAssistant(dialogId, FALLBACK_LIMIT);
            return FALLBACK_LIMIT;
        } finally {
            await this.dependencies.toolRunner.disposeRun(runId);
        }
    }

    private async completeWithRetry(messages: AgentMessage[], toolsEnabled: boolean, signal: AbortSignal) {
        let attempts = 0;
        for (;;) {
            this.throwIfAborted(signal);
            try {
                attempts += 1;
                return await this.dependencies.llm.complete(
                    messages,
                    toolsEnabled ? this.dependencies.toolRunner.specs() : null,
                    signal,
                );
            } catch (error) {
                if (signal.aborted) throw new AgentCancelledError();
                const llmError = error instanceof LlmError ? error : new LlmError("Модель недоступна", false);
                if (!llmError.retryable || attempts >= this.limits.maxLlmAttempts) throw llmError;
                await this.dependencies.clock.sleep(1000);
            }
        }
    }

    private throwIfAborted(signal: AbortSignal): void {
        if (signal.aborted) throw new AgentCancelledError();
    }
}

export function repairContext(messages: AgentMessage[]): AgentMessage[] {
    const firstNonTool = messages.findIndex((message) => message.role !== "tool");
    const window = firstNonTool === -1 ? [] : messages.slice(firstNonTool);
    const answered = new Set(window.flatMap((message) => (message.role === "tool" ? [message.toolCallId] : [])));
    return window.flatMap((message) => {
        if (message.role !== "assistant" || !message.toolCalls) return [message];
        const calls = message.toolCalls.filter((call) => answered.has(call.id));
        if (calls.length === message.toolCalls.length) return [message];
        return message.content.trim() ? [{ role: "assistant" as const, content: message.content }] : [];
    });
}

function uniqueCalls(calls: ToolCall[]): ToolCall[] {
    const identifiers = new Set<string>();
    return calls.map((call, index) => {
        let id = call.id.trim() || `call_${index}`;
        while (identifiers.has(id)) id = `${id}_`;
        identifiers.add(id);
        return { ...call, id, name: call.name.trim() };
    });
}

function stringifyToolResult(result: Awaited<ReturnType<ToolRunner["run"]>>): string {
    return result.ok ? JSON.stringify({ output: result.output }) : JSON.stringify({ error: result.error });
}

function errorResult(code: string): string {
    return JSON.stringify({ error: { code } });
}

function truncate(text: string, maximum: number): string {
    if (text.length <= maximum) return text;
    const head = Math.floor(maximum / 2);
    return `${text.slice(0, head)}\n…\n${text.slice(-(maximum - head))}`;
}
