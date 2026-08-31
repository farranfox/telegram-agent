import { describe, expect, it, vi } from "vitest";

import { AgentCancelledError } from "../src/agent/errors/AgentCancelledError.js";
import { LlmError } from "../src/agent/errors/LlmError.js";
import { DialogRunService } from "../src/runtime/DialogRunService.js";

describe("DialogRunService", () => {
    it("rejects a second message while the participant run is active", async () => {
        let resolveRun: ((value: string) => void) | undefined;
        const service = new DialogRunService({
            agent: { run: vi.fn(async () => await new Promise<string>((resolve) => (resolveRun = resolve))) },
            dialogStorage: {
                getOrCreateActiveDialog: vi.fn(async () => ({ id: "d1", participantId: "p" })),
                startNewDialog: vi.fn(),
            },
        });
        const first = service.run("p", "one");

        await expect(service.run("p", "two")).resolves.toEqual({ type: "busy" });
        resolveRun?.("done");
        await expect(first).resolves.toEqual({ type: "success", response: "done" });
    });

    // Регрессия: LLM вернула 404, исключение прошло через все слои до Telegraf
    // и убило процесс бота. Сбой обязан превращаться в результат, а не в исключение.
    it("turns an agent failure into a failed result instead of throwing", async () => {
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const service = new DialogRunService({
            agent: { run: vi.fn(() => Promise.reject(new LlmError("LLM returned HTTP 404", false))) },
            dialogStorage: {
                getOrCreateActiveDialog: vi.fn(async () => ({ id: "d1", participantId: "p" })),
                startNewDialog: vi.fn(),
            },
            logger,
        });

        await expect(service.run("p", "one")).resolves.toEqual({ type: "failed" });
        expect(logger.error).toHaveBeenCalledWith(
            "dialog.run.failed",
            expect.objectContaining({ error: "LLM returned HTTP 404", participantId: "p" }),
        );
    });

    // Отмена через /stop — это не сбой: AgentCancelledError раньше тоже ронял бота.
    it("reports a cancelled run instead of failing", async () => {
        const service = new DialogRunService({
            agent: { run: vi.fn(() => Promise.reject(new AgentCancelledError())) },
            dialogStorage: {
                getOrCreateActiveDialog: vi.fn(async () => ({ id: "d1", participantId: "p" })),
                startNewDialog: vi.fn(),
            },
        });

        await expect(service.run("p", "one")).resolves.toEqual({ type: "cancelled" });
    });

    // После сбоя участник не должен остаться заблокированным как "занят".
    it("releases the participant slot after a failure", async () => {
        const run = vi
            .fn<(dialogId: string, text: string, signal: AbortSignal) => Promise<string>>()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce("ok");
        const service = new DialogRunService({
            agent: { run },
            dialogStorage: {
                getOrCreateActiveDialog: vi.fn(async () => ({ id: "d1", participantId: "p" })),
                startNewDialog: vi.fn(),
            },
        });

        await expect(service.run("p", "one")).resolves.toEqual({ type: "failed" });
        await expect(service.run("p", "two")).resolves.toEqual({ type: "success", response: "ok" });
    });

    it("aborts the old run before switching to a new dialog", async () => {
        let capturedSignal: AbortSignal | undefined;
        const startNewDialog = vi.fn(async () => ({ id: "d2", participantId: "p" }));
        const service = new DialogRunService({
            agent: {
                run: vi.fn(async (_dialogId, _text, signal) => {
                    capturedSignal = signal;
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    return "ignored";
                }),
            },
            dialogStorage: {
                getOrCreateActiveDialog: vi.fn(async () => ({ id: "d1", participantId: "p" })),
                startNewDialog,
            },
        });

        const pending = service.run("p", "one");
        await expect(service.startNewDialog("p")).resolves.toEqual({ id: "d2", participantId: "p" });
        expect(capturedSignal?.aborted).toBe(true);
        await pending;
    });
});
