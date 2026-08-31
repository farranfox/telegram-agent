import type { SandboxExecutor } from "./SandboxExecutor.js";
import type { Tool, ToolResult } from "./Tool.js";

const MAX_COMMAND_CHARS = 8192;
const TRUNCATION_NOTE = "\n[output truncated]";
// Терминальные управляющие последовательности: CSI (цвета, курсор), OSC (заголовок окна),
// одиночные escape-команды и звонок. Для модели это чистый шум — в выводе wttr.in?format=v2
// на них уходит 72% байт, и они съедают бюджет обрезки вместо полезного текста.
const TERMINAL_CONTROL_SEQUENCES = new RegExp(
    [
        "\\u001B\\[[0-9;?]*[ -/]*[@-~]", // CSI: \u001B[38;5;203m, \u001B[2m, \u001B[0m
        "\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)", // OSC: \u001B]0;title\u0007
        "\\u001B[@-Z\\\\-_]", // одиночные: \u001BM, \u001B=
        "\\u0007", // звонок
    ].join("|"),
    "g",
);

/** Убирает терминальную разметку: модель читает текст, а не управляет курсором. */
export function stripTerminalControls(text: string): string {
    return text.replace(TERMINAL_CONTROL_SEQUENCES, "");
}

export class ExecTool implements Tool {
    public readonly spec = {
        name: "exec",
        description:
            "Runs a ready-to-use shell command inside an isolated temporary Docker workspace. " +
            "Follow the matching skill instruction before calling it.",
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
        if (command.length > MAX_COMMAND_CHARS) {
            return {
                ok: false,
                error: { code: "command_too_long", message: `Command exceeds ${MAX_COMMAND_CHARS} characters` },
            };
        }
        try {
            const result = await this.executor.execute(runId, command, signal);
            const clean = stripTerminalControls(result.output);
            const output = result.truncated ? `${clean}${TRUNCATION_NOTE}` : clean;
            if (result.timedOut) {
                return {
                    ok: false,
                    error: {
                        code: "command_timed_out",
                        message: `Command did not finish in time. Retrying will not help. Output:\n${output}`,
                    },
                };
            }
            if (result.exitCode !== 0) {
                return {
                    ok: false,
                    error: {
                        code: "command_failed",
                        message: `Command exited with code ${result.exitCode ?? "unknown"}. Output:\n${output}`,
                    },
                };
            }
            return { ok: true, output };
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: "sandbox_unavailable",
                    message:
                        "The sandbox is unavailable, retrying will not help. " +
                        (error instanceof Error ? error.message : "Sandbox unavailable"),
                },
            };
        }
    }

    public async disposeRun(runId: string): Promise<void> {
        await this.executor.disposeRun(runId);
    }
}
