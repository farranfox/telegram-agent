import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/Config.js";

const env = {
    TELEGRAM_BOT_TOKEN: "token",
    LLM_PROVIDER: "ollama",
    LLM_BASE_URL: "http://localhost:11434/v1",
    LLM_MODEL: "llama",
    LOG_LEVEL: "debug",
};
describe("loadConfig", () => {
    it("parses valid configuration without an API key", () =>
        expect(loadConfig(env)).toMatchObject({
            telegramBotToken: "token",
            llm: { provider: "ollama", model: "llama" },
        }));
    it("adds the OpenAI-compatible path for Ollama", () =>
        expect(loadConfig({ ...env, LLM_BASE_URL: "http://localhost:11434" }).llm.baseUrl).toBe(
            "http://localhost:11434/v1",
        ));
    it("does not duplicate the OpenAI-compatible path for Ollama", () =>
        expect(loadConfig({ ...env, LLM_BASE_URL: "http://localhost:11434/v1/" }).llm.baseUrl).toBe(
            "http://localhost:11434/v1",
        ));
    it("rejects missing required values", () =>
        expect(() => loadConfig({ ...env, LLM_MODEL: "" })).toThrow("LLM_MODEL"));
    it("rejects an invalid base URL", () =>
        expect(() => loadConfig({ ...env, LLM_BASE_URL: "not-url" })).toThrow("valid URL"));
});
