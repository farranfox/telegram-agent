import type { SandboxExecutor } from "./SandboxExecutor.js";
import type { Tool, ToolResult } from "./Tool.js";

export class ExecTool implements Tool {
    public readonly spec = {
        name: "exec",
        description: "Runs a shell command inside an isolated temporary Docker workspace.",
        parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
            additionalProperties: false,
        },
    };

    public constructor(private readonly executor: SandboxExecutor) {}

    public async execute(runId: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
        const command = typeof input.command === "string" ? input.command : "";
        if (!command.trim()) {
            return { ok: false, error: { code: "invalid_command", message: "Command must not be empty" } };
        }
        if (command.length > 8192) {
            return { ok: false, error: { code: "command_too_long", message: "Command exceeds 8192 characters" } };
        }
        try {
            const result = await this.executor.execute(runId, command, signal);
            const output = JSON.stringify({
                exitCode: result.exitCode,
                output: result.output,
                timedOut: result.timedOut,
                truncated: result.truncated,
            });
            return result.exitCode === 0 && !result.timedOut
                ? { ok: true, output }
                : {
                      ok: false,
                      error: { code: result.timedOut ? "command_timed_out" : "command_failed", message: output },
                  };
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: "sandbox_unavailable",
                    message: error instanceof Error ? error.message : "Sandbox unavailable",
                },
            };
        }
    }

    public async disposeRun(runId: string): Promise<void> {
        await this.executor.disposeRun(runId);
    }
}
