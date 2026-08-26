import { describe, expect, it, vi } from "vitest";

import { EMPTY_COMPLETION_REPLY, OpenAiLlmClient, SYSTEM_PROMPT } from "../src/OpenAiLlmClient.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const settings = {
    provider: "ollama",
    baseUrl: "http://localhost/v1",
    model: "test",
};
describe("OpenAiLlmClient", () => {
    it("sends exactly the system and current user messages", async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: " answer " } }] });
        const client = new OpenAiLlmClient(settings, logger, {
            chat: { completions: { create } },
        });
        await expect(client.complete("now")).resolves.toBe("answer");
        expect(create).toHaveBeenCalledWith({
            model: "test",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: "now" },
            ],
        });
    });
    it("returns a safe fallback for empty completion", async () => {
        const client = new OpenAiLlmClient(settings, logger, {
            chat: {
                completions: { create: vi.fn().mockResolvedValue({ choices: [] }) },
            },
        });
        await expect(client.complete("now")).resolves.toBe(EMPTY_COMPLETION_REPLY);
        expect(logger.warn).toHaveBeenCalled();
    });
});
