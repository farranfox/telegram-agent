import OpenAI from "openai";

import type { LlmClientInterface } from "./LlmClientInterface.js";
import type { LoggerInterface } from "./LoggerInterface.js";

export const SYSTEM_PROMPT =
    "Provide a helpful answer in no more than 1024 characters. Do not claim to have performed actions you did not perform.";
export const EMPTY_COMPLETION_REPLY = "I could not get a useful response right now. Please try again later.";

type ChatCompletionClient = {
    chat: {
        completions: {
            create(request: { model: string; messages: Array<{ role: "system" | "user"; content: string }> }): Promise<{
                choices: Array<{ message?: { content?: string | null } }>;
            }>;
        };
    };
};

export class OpenAiLlmClient implements LlmClientInterface {
    private readonly client: ChatCompletionClient;
    constructor(
        settings: {
            baseUrl: string;
            model: string;
            apiKey?: string;
            provider: string;
        },
        private readonly logger: LoggerInterface,
        client?: ChatCompletionClient,
    ) {
        this.settings = settings;
        this.client =
            client ??
            new OpenAI({
                baseURL: settings.baseUrl,
                apiKey: settings.apiKey || "not-needed",
            });
    }
    private readonly settings: {
        baseUrl: string;
        model: string;
        apiKey?: string;
        provider: string;
    };

    async complete(prompt: string): Promise<string> {
        const result = await this.client.chat.completions.create({
            model: this.settings.model,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: prompt },
            ],
        });
        const content = result.choices[0]?.message?.content?.trim();
        if (!content) {
            this.logger.warn("LLM returned empty completion", {
                provider: this.settings.provider,
                model: this.settings.model,
            });
            return EMPTY_COMPLETION_REPLY;
        }
        return content;
    }
}
