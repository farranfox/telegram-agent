import { describe, expect, it, vi } from "vitest";

import { DockerSandboxExecutor } from "../src/tools/DockerSandboxExecutor.js";
import type { ProcessResult, ProcessRunner } from "../src/tools/ProcessRunner.js";

const signal = new AbortController().signal;

const runnerReturning = (...results: Array<Partial<ProcessResult>>): ProcessRunner & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    let index = 0;
    return {
        calls,
        run: vi.fn(async (executable, argumentsList, options) => {
            calls.push([executable, argumentsList, options]);
            const result = results[Math.min(index, results.length - 1)];
            index += 1;
            return { exitCode: 0, output: "", timedOut: false, truncated: false, ...result };
        }),
    };
};

const executorWith = (runner: ProcessRunner) =>
    new DockerSandboxExecutor({
        composeFile: "/repo/sandbox-runner/compose.yaml",
        maxOutputBytes: 1024,
        processRunner: runner,
        timeoutMs: 5_000,
    });

describe("DockerSandboxExecutor", () => {
    // Регрессия: без --progress quiet compose пишет "Container … Creating/Created" в stderr,
    // и этот шум попадал в tool-результат, который читает модель.
    it("silences compose progress output", async () => {
        const runner = runnerReturning({}, { output: "Antalya: +31°C\n" });

        await executorWith(runner).execute("run-1", "curl -fsSL https://wttr.in", signal);

        const composeArguments = runner.calls[1][1] as string[];
        expect(composeArguments.slice(0, 3)).toEqual(["compose", "--progress", "quiet"]);
    });

    // Команда уходит контейнеру через stdin, а не через argv: строку от модели
    // не должен разбирать shell хоста.
    it("passes the command through stdin and mounts a per-run volume", async () => {
        const runner = runnerReturning({}, { output: "ok" });

        const result = await executorWith(runner).execute("run-1", "echo hi", signal);

        const [volumeExecutable, volumeArguments] = runner.calls[0] as [string, string[]];
        expect(volumeExecutable).toBe("docker");
        expect(volumeArguments).toEqual(["volume", "create", "agent-sandbox-run-1"]);

        const [, composeArguments, composeOptions] = runner.calls[1] as [string, string[], { input: string }];
        expect(composeArguments).toContain("--volume");
        expect(composeArguments).toContain("agent-sandbox-run-1:/workspace");
        expect(composeArguments).toContain("-T");
        expect(composeOptions.input).toBe("echo hi");
        expect(result.output).toBe("ok");
    });

    // Volume создаётся один раз на run: два exec'а в одном run видят общий workspace.
    it("reuses the volume within one run and removes it on dispose", async () => {
        const runner = runnerReturning({});
        const executor = executorWith(runner);

        await executor.execute("run-1", "echo 1", signal);
        await executor.execute("run-1", "echo 2", signal);
        await executor.disposeRun("run-1");

        const volumeCreates = runner.calls.filter((call) => (call[1] as string[])[0] === "volume").length;
        expect(volumeCreates).toBe(2); // один create + один rm
        expect(runner.calls.at(-1)?.[1]).toEqual(["volume", "rm", "-f", "agent-sandbox-run-1"]);
    });

    // Недоступный Docker — это отказ инфраструктуры, наружу должно уйти исключение,
    // которое ExecTool превратит в sandbox_unavailable.
    it("throws when the workspace volume cannot be created", async () => {
        const runner = runnerReturning({ exitCode: 1 });

        await expect(executorWith(runner).execute("run-1", "echo hi", signal)).rejects.toThrow(
            "Docker sandbox workspace is unavailable",
        );
    });
});
