import type { AgentMessage, AssistantTurn, ToolCall } from "../agent/AgentMessage.js";
import { LlmError } from "../agent/errors/LlmError.js";
import type { ToolSpec } from "../tools/Tool.js";
import type { LlmClient } from "./LlmClient.js";

type OpenAICompatibleClientOptions = { apiKey?: string; baseUrl: string; fetchImpl?: typeof fetch; model: string };

export class OpenAICompatibleClient implements LlmClient {
    private readonly fetchImpl: typeof fetch;

    public constructor(private readonly options: OpenAICompatibleClientOptions) {
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    public async complete(
        messages: AgentMessage[],
        tools: ToolSpec[] | null,
        signal: AbortSignal,
    ): Promise<AssistantTurn> {
        let response: Response;
        try {
            response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
                body: JSON.stringify({
                    messages: messages.map(toWireMessage),
                    model: this.options.model,
                    ...(tools?.length ? { tool_choice: "auto", tools: tools.map(toWireTool) } : {}),
                }),
                headers: {
                    "content-type": "application/json",
                    ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
                },
                method: "POST",
                signal,
            });
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }
            throw new LlmError("Network request to LLM failed", true);
        }
        if (!response.ok) {
            throw new LlmError(
                `LLM returned HTTP ${response.status}`,
                response.status === 429 || response.status >= 500,
            );
        }
        const payload: unknown = await response.json();
        const message = (payload as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message;
        if (!message || typeof message !== "object") {
            throw new LlmError("LLM response has no assistant message", false);
        }
        return normalizeAssistantMessage(message as Record<string, unknown>);
    }
}

function toWireMessage(message: AgentMessage): Record<string, unknown> {
    if (message.role === "tool") {
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
        return {
            role: "assistant",
            content: message.content,
            tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
            })),
        };
    }
    return { role: message.role, content: message.content };
}

function toWireTool(tool: ToolSpec): Record<string, unknown> {
    return {
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    };
}

function normalizeAssistantMessage(message: Record<string, unknown>): AssistantTurn {
    const calls = Array.isArray(message.tool_calls)
        ? message.tool_calls
        : message.function_call
          ? [message.function_call]
          : [];
    return {
        content:
            typeof message.content === "string" ? message.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : "",
        toolCalls: calls.map((call, index) => normalizeToolCall(call, index)),
    };
}

function normalizeToolCall(value: unknown, index: number): ToolCall {
    const call = value as {
        function?: { arguments?: unknown; name?: unknown };
        id?: unknown;
        arguments?: unknown;
        name?: unknown;
    };
    const functionCall = call.function ?? call;
    const argumentsValue = functionCall.arguments ?? {};
    return {
        arguments: typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue),
        id: String(call.id ?? `call_${index}`),
        name: String(functionCall.name ?? ""),
    };
}
