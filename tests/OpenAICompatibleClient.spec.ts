import { describe, expect, it, vi } from "vitest";

import { OpenAICompatibleClient } from "../src/llm/OpenAICompatibleClient.js";

describe("OpenAICompatibleClient", () => {
    it("normalizes object tool arguments from an OpenAI-compatible provider", async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: null,
                                    tool_calls: [{ function: { arguments: { city: "Minsk" }, name: "weather" } }],
                                },
                            },
                        ],
                    }),
                    { status: 200 },
                ),
        );
        const client = new OpenAICompatibleClient({ baseUrl: "https://llm.example/v1", fetchImpl, model: "test" });

        await expect(
            client.complete([{ role: "user", content: "weather" }], [], new AbortController().signal),
        ).resolves.toEqual({
            content: "",
            toolCalls: [{ arguments: '{"city":"Minsk"}', id: "call_0", name: "weather" }],
        });
    });
});
