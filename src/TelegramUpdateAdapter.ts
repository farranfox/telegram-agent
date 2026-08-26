import type { LoggerInterface } from "./LoggerInterface.js";
import type { ReplyInterface } from "./ReplyInterface.js";
import type { TelegramMessageHandler } from "./TelegramMessageHandler.js";

export interface TelegramContext {
    chat?: { id?: number | string };
    message?: { text?: unknown };
    telegram: {
        sendMessage(chatId: number | string, text: string): Promise<unknown>;
    };
}
export interface TelegramBotInterface {
    use(handler: (context: TelegramContext, next: () => Promise<void>) => Promise<void>): unknown;
    on(event: "text", handler: (context: TelegramContext) => Promise<void>): unknown;
    catch(handler: (error: unknown) => void): unknown;
    launch(): Promise<void>;
    stop(reason?: string): void;
}

export function registerTelegramTextHandler(
    bot: TelegramBotInterface,
    handler: TelegramMessageHandler,
    logger: LoggerInterface,
): void {
    bot.use(async (context, next) => {
        if (typeof context.message?.text !== "string") {
            logger.debug("Ignoring unsupported Telegram update");
        }
        await next();
    });
    bot.on("text", async (context) => {
        const reply: ReplyInterface = {
            send: async (chatId, text) => {
                await context.telegram.sendMessage(chatId, text);
            },
        };
        await handler.handle({ chatId: context.chat?.id, text: context.message?.text }, reply);
    });
    bot.catch((error) =>
        logger.error("Telegram polling error", {
            category: "telegram_polling",
            error: error instanceof Error ? error.message : "unknown",
        }),
    );
}
