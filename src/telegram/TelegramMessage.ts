import type { Context } from "telegraf";

export type TelegramMessage = { chatId: number; text: string; updateId: number; userId: number };

export function toTelegramMessage(context: Context): TelegramMessage | undefined {
    if (!context.message || !("text" in context.message) || !context.chat || !context.from) {
        return undefined;
    }
    return {
        chatId: context.chat.id,
        text: context.message.text,
        updateId: context.update.update_id,
        userId: context.from.id,
    };
}
