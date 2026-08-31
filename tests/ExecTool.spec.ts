import { describe, expect, it, vi } from "vitest";

import { ExecTool, stripTerminalControls } from "../src/tools/ExecTool.js";
import type { SandboxExecution, SandboxExecutor } from "../src/tools/SandboxExecutor.js";

const signal = new AbortController().signal;

const executorReturning = (execution: Partial<SandboxExecution>): SandboxExecutor => ({
    disposeRun: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({
        exitCode: 0,
        output: "",
        timedOut: false,
        truncated: false,
        ...execution,
    })),
});

describe("ExecTool", () => {
    // Успешный запуск отдаёт модели чистый stdout, а не JSON-обёртку:
    // Agent сам заворачивает результат один раз, второй уровень кодирования модель только путал.
    it("returns the raw command output on success", async () => {
        const executor = executorReturning({ output: "Antalya: ☀️  +27°C\n" });

        const result = await new ExecTool(executor).execute("run-1", { command: "curl -fsSL wttr.in" }, signal);

        expect(result).toEqual({ ok: true, output: "Antalya: ☀️  +27°C\n" });
        expect(executor.execute).toHaveBeenCalledWith("run-1", "curl -fsSL wttr.in", signal);
    });

    // Регрессия на живой прогон: модель вызвала wttr.in?format=v2, и 72% вывода
    // оказались ANSI-кодами. Для модели это шум, который ещё и съедает бюджет обрезки.
    it("strips terminal control sequences from the output", async () => {
        const coloured = "\u001B[38;5;203m\u001B[39m▲ 39°\u001B[0m\n\u001B[2mWeather: \u001B[0m☀️ Sunny, +37°C";
        const executor = executorReturning({ output: coloured });

        const result = await new ExecTool(executor).execute("run-1", { command: "curl -fsSL wttr.in" }, signal);

        expect(result).toEqual({ ok: true, output: "▲ 39°\nWeather: ☀️ Sunny, +37°C" });
    });

    // Разметка снимается и в ошибках: текст падения тоже читает модель.
    it("strips terminal control sequences from a failed command output", async () => {
        const executor = executorReturning({ exitCode: 1, output: "\u001B[31mcurl: (6) Could not resolve\u001B[0m" });

        const result = await new ExecTool(executor).execute("run-1", { command: "curl nope" }, signal);

        expect(result).toEqual({
            ok: false,
            error: {
                code: "command_failed",
                message: "Command exited with code 1. Output:\ncurl: (6) Could not resolve",
            },
        });
    });

    // Переводы строк и табы — это данные, их трогать нельзя.
    it("keeps newlines and tabs intact", () => {
        expect(stripTerminalControls("a\n\tb\r\nc")).toBe("a\n\tb\r\nc");
    });

    // OSC-последовательности и звонок тоже шум.
    it("strips OSC sequences and the bell character", () => {
        expect(stripTerminalControls("\u001B]0;title\u0007data\u0007")).toBe("data");
    });

    // Обрезанный вывод помечается явно, иначе модель примет хвост за конец данных.
    it("marks truncated output", async () => {
        const executor = executorReturning({ output: "начало", truncated: true });

        const result = await new ExecTool(executor).execute("run-1", { command: "cat big" }, signal);

        expect(result).toEqual({ ok: true, output: "начало\n[output truncated]" });
    });

    // Ненулевой exit code — ошибка с кодом и выводом команды в человекочитаемом виде.
    it("reports a non-zero exit code with the command output", async () => {
        const executor = executorReturning({ exitCode: 6, output: "curl: (6) Could not resolve host" });

        const result = await new ExecTool(executor).execute("run-1", { command: "curl -fsSL nope" }, signal);

        expect(result).toEqual({
            ok: false,
            error: {
                code: "command_failed",
                message: "Command exited with code 6. Output:\ncurl: (6) Could not resolve host",
            },
        });
    });

    // Таймаут отличается от обычного падения: у него свой код и exitCode может быть null.
    it("reports a timeout separately from a failed command", async () => {
        const executor = executorReturning({ exitCode: null, output: "частичный", timedOut: true });

        const result = await new ExecTool(executor).execute("run-1", { command: "sleep 999" }, signal);

        expect(result).toEqual({
            ok: false,
            error: {
                code: "command_timed_out",
                message: "Command did not finish in time. Retrying will not help. Output:\nчастичный",
            },
        });
    });

    // Пустая команда отсекается до запуска Docker.
    it("rejects an empty command without touching the sandbox", async () => {
        const executor = executorReturning({});

        const result = await new ExecTool(executor).execute("run-1", { command: "   " }, signal);

        expect(result).toEqual({
            ok: false,
            error: { code: "invalid_command", message: "Command must not be empty" },
        });
        expect(executor.execute).not.toHaveBeenCalled();
    });

    // Слишком длинная команда тоже отсекается заранее.
    it("rejects a command longer than 8192 characters", async () => {
        const executor = executorReturning({});

        const result = await new ExecTool(executor).execute("run-1", { command: "x".repeat(8193) }, signal);

        expect(result).toEqual({
            ok: false,
            error: { code: "command_too_long", message: "Command exceeds 8192 characters" },
        });
        expect(executor.execute).not.toHaveBeenCalled();
    });

    // Недоступный Docker — это отказ инфраструктуры, а не результат команды.
    it("maps an executor failure to sandbox_unavailable", async () => {
        const executor: SandboxExecutor = {
            disposeRun: vi.fn(async () => undefined),
            execute: vi.fn(() => Promise.reject(new Error("Docker sandbox workspace is unavailable"))),
        };

        const result = await new ExecTool(executor).execute("run-1", { command: "ls" }, signal);

        expect(result).toEqual({
            ok: false,
            error: {
                code: "sandbox_unavailable",
                message: "The sandbox is unavailable, retrying will not help. Docker sandbox workspace is unavailable",
            },
        });
    });

    // disposeRun обязан доходить до executor'а, иначе Docker volume останется висеть.
    it("forwards disposeRun to the executor", async () => {
        const executor = executorReturning({});

        await new ExecTool(executor).disposeRun("run-1");

        expect(executor.disposeRun).toHaveBeenCalledWith("run-1");
    });
});
