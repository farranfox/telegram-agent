import type { ToolCall } from "../agent/AgentMessage.js";
import type { Tool, ToolResult, ToolSpec } from "./Tool.js";
import type { ToolRunner } from "./ToolRunner.js";

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
            return { ok: false, error: { code: "unknown_tool", message: `Unknown tool: ${call.name}` } };
        }
        try {
            const input = parseArguments(call.arguments);
            return await tool.execute(runId, input, signal);
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: "invalid_tool_arguments",
                    message: error instanceof Error ? error.message : "Invalid arguments",
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
