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
    "Tools are no longer available. Answer the user in plain text using the data you already have.";
const CORRECTION_UNUSED_SKILL =
    "You loaded a skill instruction but did not run any tool afterwards. " +
    "Describing a command in text does nothing. " +
    "If the instruction requires running a command, call the tool now with that command. " +
    "If the instruction requires no tool, answer the user directly.";
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

        this.dependencies.logger.info("agent.run.started", { dialogId, inputChars: text.length, runId });

        this.throwIfAborted(signal);

        await this.dependencies.messageStorage.appendUser(dialogId, text);
        this.dependencies.logger.debug("agent.message.persisted", { dialogId, role: "user", runId });

        const history = await this.dependencies.messageStorage.loadContext(dialogId, this.limits.contextMessages);
        this.dependencies.logger.debug("agent.context.loaded", { dialogId, messages: history.length, runId });

        const messages: AgentMessage[] = [
            { role: "system", content: this.dependencies.systemPromptProvider.build(this.dependencies.clock.now()) },
            ...repairContext(history),
        ];

        let toolsUsed = 0;
        // Отслеживаем, загрузила ли модель инструкцию skill'а и выполнила ли после этого
        // хоть какой-то инструмент. Если нет — она, скорее всего, пересказала инструкцию
        // текстом вместо вызова, и такой ответ отдавать пользователю нельзя.
        let skillLoaded = false;
        let toolRanAfterSkill = false;
        let correctionSpent = false;
        let correction: string | null = null;

        try {
            for (let round = 1; round <= this.limits.maxRounds; round += 1) {
                this.throwIfAborted(signal);

                const toolsEnabled =
                    round <= this.limits.toolRoundLimit &&
                    toolsUsed < this.limits.maxToolExecutions &&
                    this.dependencies.clock.now() - startedAt <= this.limits.wallClockMs;

                this.dependencies.logger.debug("agent.round.started", { round, runId, toolsEnabled, toolsUsed });

                const instruction = toolsEnabled ? correction : FINAL_INSTRUCTION;
                correction = null;
                const request: AgentMessage[] = instruction
                    ? [...messages, { role: "system", content: instruction }]
                    : messages;

                const turn = await this.completeWithRetry(runId, round, request, toolsEnabled, signal);

                if (turn.toolCalls.length === 0 && toolsEnabled && skillLoaded && !toolRanAfterSkill) {
                    if (!correctionSpent) {
                        correctionSpent = true;
                        correction = CORRECTION_UNUSED_SKILL;
                        this.dependencies.logger.warn("agent.turn.skill-not-executed", {
                            contentChars: turn.content.length,
                            round,
                            runId,
                        });
                        continue;
                    }
                    this.dependencies.logger.warn("agent.turn.skill-not-executed-final", { round, runId });
                }
                if (turn.toolCalls.length === 0) {
                    const answer = turn.content.trim() || (toolsEnabled ? FALLBACK_EMPTY : FALLBACK_LIMIT);
                    await this.dependencies.messageStorage.appendAssistant(dialogId, answer);
                    this.logRunCompleted(dialogId, runId, round, toolsUsed, answer);
                    return answer;
                }

                if (!toolsEnabled) {
                    const answer = turn.content.trim() || FALLBACK_LIMIT;
                    await this.dependencies.messageStorage.appendAssistant(dialogId, answer);
                    this.logRunCompleted(dialogId, runId, round, toolsUsed, answer);
                    return answer;
                }

                const requested = uniqueCalls(turn.toolCalls);
                const loadsSkill = requested.some((call) => call.name === "load_skill");
                const calls = loadsSkill ? requested.filter((call) => call.name === "load_skill") : requested;
                for (const deferred of requested.filter((call) => !calls.includes(call))) {
                    this.dependencies.logger.warn("agent.tool.deferred", {
                        name: deferred.name,
                        reason: "load_skill_must_complete_first",
                        round,
                        runId,
                        toolCallId: deferred.id,
                    });
                }

                const results: Array<{ toolCallId: string; content: string }> = [];
                for (const [index, call] of calls.entries()) {
                    if (index >= this.limits.maxToolCallsPerResponse || toolsUsed >= this.limits.maxToolExecutions) {
                        results.push({ toolCallId: call.id, content: skippedResult() });
                        continue;
                    }
                    this.throwIfAborted(signal);
                    this.dependencies.logger.debug("agent.tool.call", {
                        arguments: call.arguments,
                        name: call.name,
                        round,
                        runId,
                        toolCallId: call.id,
                    });
                    const result = await this.dependencies.toolRunner.run(runId, call, signal);
                    toolsUsed += 1;
                    if (call.name === "load_skill") {
                        if (result.ok) {
                            skillLoaded = true;
                            toolRanAfterSkill = false;
                        }
                    } else if (skillLoaded) {
                        toolRanAfterSkill = true;
                    }
                    this.dependencies.logger.debug("agent.tool.result", {
                        name: call.name,
                        ok: result.ok,
                        result: logToolResult(result),
                        round,
                        runId,
                        toolCallId: call.id,
                    });
                    results.push({
                        toolCallId: call.id,
                        content: truncate(stringifyToolResult(result), this.limits.toolOutputChars),
                    });
                }

                await this.dependencies.messageStorage.appendToolTurn(dialogId, turn.content, calls, results);
                this.dependencies.logger.debug("agent.tool-turn.persisted", {
                    calls: calls.length,
                    dialogId,
                    runId,
                });
                messages.push({ role: "assistant", content: turn.content, toolCalls: calls });

                for (const result of results) {
                    messages.push({ role: "tool", ...result });
                }
            }
            await this.dependencies.messageStorage.appendAssistant(dialogId, FALLBACK_LIMIT);
            this.dependencies.logger.warn("agent.run.limit-reached", { dialogId, runId, toolsUsed });
            return FALLBACK_LIMIT;
        } catch (error) {
            this.dependencies.logger.error("agent.run.failed", {
                dialogId,
                error: error instanceof Error ? error.message : "Unknown error",
                runId,
            });
            throw error;
        } finally {
            this.dependencies.logger.debug("agent.run.disposing", { runId });
            await this.dependencies.toolRunner.disposeRun(runId);
            this.dependencies.logger.debug("agent.run.disposed", { runId });
        }
    }

    private async completeWithRetry(
        runId: string,
        round: number,
        messages: AgentMessage[],
        toolsEnabled: boolean,
        signal: AbortSignal,
    ) {
        let attempts = 0;
        for (;;) {
            this.throwIfAborted(signal);
            try {
                attempts += 1;
                this.dependencies.logger.debug("agent.llm.request", {
                    attempt: attempts,
                    messages: messages.length,
                    round,
                    runId,
                    toolsEnabled,
                });
                const turn = await this.dependencies.llm.complete(
                    messages,
                    toolsEnabled ? this.dependencies.toolRunner.specs() : null,
                    signal,
                );
                this.dependencies.logger.debug("agent.llm.response", {
                    contentChars: turn.content.length,
                    round,
                    runId,
                    toolCalls: turn.toolCalls.map((call) => call.name),
                });
                return turn;
            } catch (error) {
                if (signal.aborted) {
                    throw new AgentCancelledError();
                }
                const llmError = error instanceof LlmError ? error : new LlmError("Модель недоступна", false);
                this.dependencies.logger.warn("agent.llm.failed", {
                    attempt: attempts,
                    error: llmError.message,
                    retryable: llmError.retryable,
                    round,
                    runId,
                });
                if (!llmError.retryable || attempts >= this.limits.maxLlmAttempts) {
                    throw llmError;
                }
                await this.dependencies.clock.sleep(1000);
            }
        }
    }

    private logRunCompleted(dialogId: string, runId: string, round: number, toolsUsed: number, answer: string): void {
        this.dependencies.logger.info("agent.run.completed", {
            dialogId,
            responseChars: answer.length,
            round,
            runId,
            toolsUsed,
        });
    }

    private throwIfAborted(signal: AbortSignal): void {
        if (signal.aborted) {
            throw new AgentCancelledError();
        }
    }
}

export function repairContext(messages: AgentMessage[]): AgentMessage[] {
    const firstNonTool = messages.findIndex((message) => message.role !== "tool");
    const window = firstNonTool === -1 ? [] : messages.slice(firstNonTool);
    const answered = new Set(window.flatMap((message) => (message.role === "tool" ? [message.toolCallId] : [])));
    return window.flatMap((message) => {
        if (message.role !== "assistant" || !message.toolCalls) {
            return [message];
        }
        const calls = message.toolCalls.filter((call) => answered.has(call.id));
        if (calls.length === message.toolCalls.length) {
            return [message];
        }
        return message.content.trim() ? [{ role: "assistant" as const, content: message.content }] : [];
    });
}

function uniqueCalls(calls: ToolCall[]): ToolCall[] {
    const identifiers = new Set<string>();
    return calls.map((call, index) => {
        let id = call.id.trim() || `call_${index}`;
        while (identifiers.has(id)) {
            id = `${id}_`;
        }
        identifiers.add(id);
        return { ...call, id, name: call.name.trim() };
    });
}

function stringifyToolResult(result: Awaited<ReturnType<ToolRunner["run"]>>): string {
    return result.ok ? JSON.stringify({ output: result.output }) : JSON.stringify({ error: result.error });
}

function logToolResult(result: Awaited<ReturnType<ToolRunner["run"]>>): string {
    return truncate(result.ok ? result.output : JSON.stringify(result.error), 1_000);
}

function skippedResult(): string {
    return JSON.stringify({
        status: "skipped",
        reason: "tool_budget",
        note: "No further tool calls will run in this step. Answer the user from the results you already have.",
    });
}

function truncate(text: string, maximum: number): string {
    if (text.length <= maximum) {
        return text;
    }
    const head = Math.floor(maximum / 2);
    return `${text.slice(0, head)}\n…\n${text.slice(-(maximum - head))}`;
}
