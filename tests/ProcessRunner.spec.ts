import { describe, expect, it } from "vitest";

import { ChildProcessRunner } from "../src/tools/ProcessRunner.js";

const runner = new ChildProcessRunner();
const defaults = { maxOutputBytes: 64 * 1024, signal: new AbortController().signal, timeoutMs: 10_000 };
const activeTimers = (): number => process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

describe("ChildProcessRunner", () => {
    // Команда читается из stdin — так строка от LLM никогда не попадает в argv хоста.
    it("feeds the input to stdin and collects stdout with the exit code", async () => {
        const result = await runner.run("sh", ["-c", "cat"], { ...defaults, input: "Antalya: +27°C" });

        expect(result).toEqual({ exitCode: 0, output: "Antalya: +27°C", timedOut: false, truncated: false });
    });

    // stderr попадает в тот же поток вывода: модели нужен текст ошибки, а не пустая строка.
    it("captures stderr and a non-zero exit code", async () => {
        const result = await runner.run("sh", ["-c", "echo boom >&2; exit 3"], { ...defaults, input: "" });

        expect(result.exitCode).toBe(3);
        expect(result.output).toContain("boom");
        expect(result.timedOut).toBe(false);
    });

    // Вывод режется по maxOutputBytes, флаг truncated поднимается.
    it("truncates output beyond maxOutputBytes", async () => {
        const result = await runner.run("sh", ["-c", "printf 'ABCDEFGHIJ'"], {
            ...defaults,
            input: "",
            maxOutputBytes: 4,
        });

        expect(result.output).toBe("ABCD");
        expect(result.truncated).toBe(true);
    });

    // Зависшая команда убивается по таймауту и помечается timedOut.
    it("kills a command that exceeds the timeout", async () => {
        const result = await runner.run("sh", ["-c", "sleep 5"], { ...defaults, input: "", timeoutMs: 100 });

        expect(result.timedOut).toBe(true);
        expect(result.exitCode).not.toBe(0);
    });

    // Запись в stdin процесса, который уже вышел (например, docker сразу упал), не должна ломать run.
    it("survives a process that exits without reading stdin", async () => {
        const result = await runner.run("sh", ["-c", "exit 0"], { ...defaults, input: "x".repeat(1024 * 1024) });

        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
    });

    // Регрессия: при ошибке spawn таймер раньше не снимался и держал event loop до timeoutMs.
    it("rejects on a spawn error without leaking the timeout timer", async () => {
        const before = activeTimers();

        await expect(
            runner.run("definitely-not-an-executable", [], { ...defaults, input: "", timeoutMs: 60_000 }),
        ).rejects.toThrow();

        expect(activeTimers()).toBe(before);
    });

    // Отмена run'а (например /stop) должна завершать дочерний процесс, а не ждать таймаута.
    it("kills the child when the signal is aborted", async () => {
        const controller = new AbortController();
        const pending = runner.run("sh", ["-c", "sleep 5"], {
            ...defaults,
            input: "",
            signal: controller.signal,
            timeoutMs: 60_000,
        });
        setTimeout(() => controller.abort(), 50);

        const result = await pending;

        expect(result.exitCode).not.toBe(0);
        expect(result.timedOut).toBe(false);
    });
});
