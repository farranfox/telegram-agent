import type { LlmClientInterface } from "./LlmClientInterface.js";
import type { LoggerInterface } from "./LoggerInterface.js";
import { MessageValidator, type TelegramMessageInput } from "./MessageValidator.js";
import type { ReplyInterface } from "./ReplyInterface.js";

export const VALIDATION_REPLY = "Please send a non-empty text message up to 1024 characters.";
export const LLM_FAILURE_REPLY = "I could not get a response right now. Please try again later.";
export const START_REPLY = "Здравствуйте, поговорим?";

export class TelegramMessageHandler {
    constructor(
        private readonly validator: MessageValidator,
        private readonly llm: LlmClientInterface,
        private readonly logger: LoggerInterface,
    ) {}
    async handle(input: TelegramMessageInput, reply: ReplyInterface): Promise<void> {
        const validated = this.validator.validate(input);
        if (!validated.valid) {
            this.logger.warn("Telegram message validation failed", {
                reason: validated.reason,
                hasChatId: input.chatId !== undefined,
            });
            if (input.chatId !== undefined && input.chatId !== null && input.chatId !== "")
                await this.sendSafely(reply, input.chatId, VALIDATION_REPLY);
            return;
        }
        if (isStartCommand(validated.text)) {
            await this.sendSafely(reply, validated.chatId, START_REPLY);
            return;
        }
        try {
            const answer = await this.llm.complete(validated.text);
            await this.sendSafely(reply, validated.chatId, answer);
        } catch (error) {
            this.logger.error("LLM request failed", {
                category: "llm_request",
                error: error instanceof Error ? error.message : "unknown",
            });
            await this.sendSafely(reply, validated.chatId, LLM_FAILURE_REPLY);
        }
    }
    private async sendSafely(reply: ReplyInterface, chatId: number | string, text: string): Promise<void> {
        try {
            await reply.send(chatId, text);
        } catch (error) {
            this.logger.error("Telegram reply failed", {
                category: "telegram_reply",
                chatId,
                error: error instanceof Error ? error.message : "unknown",
            });
        }
    }
}

function isStartCommand(text: string): boolean {
    return /^\/?start(?:\s|$)/i.test(text.trim());
}
