import { describe, expect, it, vi } from "vitest";

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
