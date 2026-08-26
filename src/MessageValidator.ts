export interface TelegramMessageInput {
    chatId?: number | string;
    text?: unknown;
}
export type ValidationResult =
    { valid: true; chatId: number | string; text: string } | { valid: false; reason: string };

export class MessageValidator {
    validate(input: TelegramMessageInput): ValidationResult {
        if (input.chatId === undefined || input.chatId === null || input.chatId === "")
            return { valid: false, reason: "missing_chat_id" };
        if (typeof input.text !== "string") return { valid: false, reason: "missing_text" };
        const count = Array.from(input.text).length;
        if (count < 1 || input.text.trim().length === 0 || count > 1024)
            return { valid: false, reason: "invalid_text_length" };
        return { valid: true, chatId: input.chatId, text: input.text };
    }
}
