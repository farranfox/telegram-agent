import type { ToolCall } from "../agent/AgentMessage.js";
import type { Tool, ToolResult, ToolSpec } from "./Tool.js";
import type { ToolRunner } from "./ToolRunner.js";

type ParameterSchema = {
    properties?: Record<string, { type?: string }>;
    required?: string[];
    additionalProperties?: boolean;
};

export class ToolRegistry implements ToolRunner {
    private readonly tools = new Map<string, Tool>();

    public constructor(tools: Tool[]) {
        for (const tool of tools) {
            this.tools.set(tool.spec.name, tool);
        }
    }

    public specs(): ToolSpec[] {
        return [...this.tools.values()].map((tool) => tool.spec);
    }

    public async run(runId: string, call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
        const tool = this.tools.get(call.name);
        if (!tool) {
            return {
                ok: false,
                error: {
                    code: "unknown_tool",
                    message: `Unknown tool: ${call.name}. Available tools: ${[...this.tools.keys()].join(", ")}.`,
                },
            };
        }
        let input: Record<string, unknown>;
        try {
            input = parseArguments(call.arguments);
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: "invalid_tool_arguments",
                    message: error instanceof Error ? error.message : "Invalid arguments",
                },
            };
        }
        // Аргументы сверяются со схемой инструмента до вызова: иначе неверное имя
        // параметра доходит до инструмента и превращается в непонятную ошибку
        // вроде "Command must not be empty", по которой модель не может понять, что исправить.
        const problems = validateArguments(tool.spec, input);
        if (problems.length) {
            return { ok: false, error: { code: "invalid_tool_arguments", message: problems.join(" ") } };
        }
        try {
            return await tool.execute(runId, input, signal);
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: "tool_failed",
                    message: error instanceof Error ? error.message : "Tool execution failed",
                },
            };
        }
    }

    public async disposeRun(runId: string): Promise<void> {
        await Promise.all([...this.tools.values()].map(async (tool) => await tool.disposeRun?.(runId)));
    }
}

function parseArguments(argumentsJson: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(argumentsJson || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Tool arguments must be a JSON object");
    }
    return parsed as Record<string, unknown>;
}

export function validateArguments(spec: ToolSpec, input: Record<string, unknown>): string[] {
    const schema = spec.parameters as ParameterSchema;
    const properties = schema.properties ?? {};
    const expected = Object.keys(properties);
    const problems: string[] = [];

    const missing = (schema.required ?? []).filter((key) => input[key] === undefined);
    if (missing.length) {
        problems.push(`Missing required parameter(s): ${missing.join(", ")}.`);
    }

    if (schema.additionalProperties === false) {
        const unknown = Object.keys(input).filter((key) => !expected.includes(key));
        if (unknown.length) {
            problems.push(`Unknown parameter(s): ${unknown.join(", ")}.`);
        }
    }

    const wrongTypes = expected.flatMap((key) => {
        const declared = properties[key]?.type;
        const value = input[key];
        if (value === undefined || !declared) {
            return [];
        }
        const actual = typeName(value);
        return actual === declared ? [] : [`${key} must be ${declared} but was ${actual}`];
    });
    if (wrongTypes.length) {
        problems.push(`Wrong parameter type(s): ${wrongTypes.join("; ")}.`);
    }

    if (problems.length) {
        problems.push(`Expected parameter(s): ${expected.join(", ") || "none"}.`);
    }
    return problems;
}

function typeName(value: unknown): string {
    if (Array.isArray(value)) {
        return "array";
    }
    if (value === null) {
        return "null";
    }
    return typeof value;
}
