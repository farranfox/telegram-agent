import { describe, expect, it, vi } from "vitest";

import { main } from "../src/main.js";
import type { TelegramBotInterface } from "../src/TelegramUpdateAdapter.js";

describe("main", () => {
    it("registers the text handler, launches polling, and installs clean shutdown", async () => {
        const use = vi.fn();
        const on = vi.fn();
        const catchError = vi.fn();
        const launch = vi.fn().mockResolvedValue(undefined);
        const stop = vi.fn();
        const bot: TelegramBotInterface = {
            use,
            on,
            catch: catchError,
            launch,
            stop,
        };
        const registerShutdown = vi.fn();
        const logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        await main({
            config: {
                telegramBotToken: "token",
                logLevel: "debug",
                llm: {
                    provider: "local",
                    baseUrl: "http://localhost/v1",
                    model: "model",
                },
            },
            bot,
            logger,
            registerShutdown,
        });
        expect(use).toHaveBeenCalledOnce();
        expect(on).toHaveBeenCalledWith("text", expect.any(Function));
        expect(catchError).toHaveBeenCalledOnce();
        expect(launch).toHaveBeenCalledOnce();
        expect(registerShutdown).toHaveBeenCalledTimes(2);
        const shutdown = registerShutdown.mock.calls[0][1] as () => void;
        shutdown();
        expect(stop).toHaveBeenCalledWith("SIGINT");
    });
});
