import { describe, expect, it, vi } from "vitest";

import type { TelegramMessageHandler } from "../src/TelegramMessageHandler.js";
import {
    registerTelegramTextHandler,
    type TelegramBotInterface,
    type TelegramContext,
} from "../src/TelegramUpdateAdapter.js";

describe("registerTelegramTextHandler", () => {
    it("logs unsupported updates at debug level", async () => {
        let middleware: ((context: TelegramContext, next: () => Promise<void>) => Promise<void>) | undefined;
        const bot: TelegramBotInterface = {
            use: (callback) => {
                middleware = callback;
            },
            on: vi.fn(),
            catch: vi.fn(),
            launch: vi.fn(),
            stop: vi.fn(),
        };
        const logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        registerTelegramTextHandler(bot, { handle: vi.fn() } as unknown as TelegramMessageHandler, logger);
        if (!middleware) {
            throw new Error("Expected middleware to be registered");
        }
        await middleware({ telegram: { sendMessage: vi.fn() } }, async () => undefined);
        expect(logger.debug).toHaveBeenCalledWith("Ignoring unsupported Telegram update");
    });
});
