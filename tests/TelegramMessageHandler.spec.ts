import { describe, expect, it, vi } from "vitest";

import { MessageValidator } from "../src/MessageValidator.js";
import {
    LLM_FAILURE_REPLY,
    START_REPLY,
    TelegramMessageHandler,
    VALIDATION_REPLY,
} from "../src/TelegramMessageHandler.js";

const logger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
});
describe("TelegramMessageHandler", () => {
    it("replies to invalid input without calling the LLM", async () => {
        const llm = { complete: vi.fn() };
        const send = vi.fn().mockResolvedValue(undefined);
        await new TelegramMessageHandler(new MessageValidator(), llm, logger()).handle(
            { chatId: 8, text: " " },
            { send },
        );
        expect(llm.complete).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(8, VALIDATION_REPLY);
    });
    it("calls the LLM once and answers in the original chat", async () => {
        const llm = { complete: vi.fn().mockResolvedValue("hello") };
        const send = vi.fn().mockResolvedValue(undefined);
        await new TelegramMessageHandler(new MessageValidator(), llm, logger()).handle(
            { chatId: 8, text: "hi" },
            { send },
        );
        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(8, "hello");
    });
    it.each(["start", "/start", "/start invite-code"])(
        "greets a new user on %s without calling the LLM",
        async (text) => {
            const llm = { complete: vi.fn() };
            const send = vi.fn().mockResolvedValue(undefined);
            await new TelegramMessageHandler(new MessageValidator(), llm, logger()).handle(
                { chatId: 8, text },
                { send },
            );
            expect(llm.complete).not.toHaveBeenCalled();
            expect(send).toHaveBeenCalledWith(8, START_REPLY);
        },
    );
    it("logs LLM failures and replies safely", async () => {
        const logs = logger();
        const send = vi.fn().mockResolvedValue(undefined);
        await new TelegramMessageHandler(
            new MessageValidator(),
            { complete: vi.fn().mockRejectedValue(new Error("down")) },
            logs,
        ).handle({ chatId: 8, text: "hi" }, { send });
        expect(send).toHaveBeenCalledWith(8, LLM_FAILURE_REPLY);
        expect(logs.error).toHaveBeenCalled();
    });
});
