import { describe, expect, it, vi } from "vitest";

import type { Tool } from "../src/tools/Tool.js";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";

const signal = new AbortController().signal;

const execTool = (execute = vi.fn(async () => ({ ok: true as const, output: "ran" }))): Tool => ({
    spec: {
        name: "exec",
        description: "Runs a shell command.",
        parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
            additionalProperties: false,
        },
    },
    execute,
});

const call = (name: string, argumentsJson: string) => ({ id: "1", name, arguments: argumentsJson });

describe("ToolRegistry", () => {
    // Неизвестный инструмент: модели полезно увидеть, что вообще доступно.
    it("lists the available tools when the name is unknown", async () => {
        const registry = new ToolRegistry([execTool()]);

        await expect(registry.run("run", call("weather", "{}"), signal)).resolves.toEqual({
            ok: false,
            error: { code: "unknown_tool", message: "Unknown tool: weather. Available tools: exec." },
        });
    });

    // Битый JSON в arguments — не падение, а результат с ошибкой.
    it("returns an error result for malformed JSON arguments", async () => {
        const registry = new ToolRegistry([execTool()]);

        await expect(registry.run("run", call("exec", "{"), signal)).resolves.toMatchObject({
            ok: false,
            error: { code: "invalid_tool_arguments" },
        });
    });

    // Регрессия на живой отказ: модель прислала {"cmd": …} вместо {"command": …}.
    // Раньше это доходило до ExecTool и превращалось в "Command must not be empty",
    // по которому невозможно понять, что не так. Инструмент не должен вызываться вообще.
    it("rejects a wrong parameter name before calling the tool", async () => {
        const execute = vi.fn(async () => ({ ok: true as const, output: "ran" }));
        const registry = new ToolRegistry([execTool(execute)]);

        const result = await registry.run("run", call("exec", '{"cmd":"curl -fsSL https://wttr.in"}'), signal);

        expect(result).toEqual({
            ok: false,
            error: {
                code: "invalid_tool_arguments",
                message:
                    "Missing required parameter(s): command. Unknown parameter(s): cmd. " +
                    "Expected parameter(s): command.",
            },
        });
        expect(execute).not.toHaveBeenCalled();
    });

    // Регрессия на живой отказ: llama3.2 передавала массив там, где схема требует string.
    it("rejects a wrong parameter type", async () => {
        const execute = vi.fn(async () => ({ ok: true as const, output: "ran" }));
        const registry = new ToolRegistry([execTool(execute)]);

        const result = await registry.run("run", call("exec", '{"command":["a","b"]}'), signal);

        expect(result).toEqual({
            ok: false,
            error: {
                code: "invalid_tool_arguments",
                message:
                    "Wrong parameter type(s): command must be string but was array. " +
                    "Expected parameter(s): command.",
            },
        });
        expect(execute).not.toHaveBeenCalled();
    });

    // Валидные аргументы доходят до инструмента без изменений.
    it("passes validated arguments to the tool", async () => {
        const execute = vi.fn(async () => ({ ok: true as const, output: "Antalya: +31°C" }));
        const registry = new ToolRegistry([execTool(execute)]);

        const result = await registry.run("run-7", call("exec", '{"command":"curl -fsSL https://wttr.in"}'), signal);

        expect(result).toEqual({ ok: true, output: "Antalya: +31°C" });
        expect(execute).toHaveBeenCalledWith("run-7", { command: "curl -fsSL https://wttr.in" }, signal);
    });

    // Исключение внутри инструмента не должно валить run.
    it("converts a thrown tool error into a result", async () => {
        const execute = vi.fn(() => Promise.reject(new Error("docker died")));
        const registry = new ToolRegistry([execTool(execute as never)]);

        await expect(registry.run("run", call("exec", '{"command":"ls"}'), signal)).resolves.toEqual({
            ok: false,
            error: { code: "tool_failed", message: "docker died" },
        });
    });

    // disposeRun должен дойти до каждого инструмента, который его поддерживает,
    // и не падать на тех, у которых метода нет.
    it("disposes every tool that supports it", async () => {
        const disposeRun = vi.fn(async () => undefined);
        const disposable: Tool = { ...execTool(), disposeRun };
        const plain: Tool = { ...execTool(), spec: { ...execTool().spec, name: "load_skill" } };
        const registry = new ToolRegistry([disposable, plain]);

        await expect(registry.disposeRun("run-1")).resolves.toBeUndefined();

        expect(disposeRun).toHaveBeenCalledWith("run-1");
    });
});
