import { Telegraf } from "telegraf";

import { type AppConfig, loadConfig } from "./Config.js";
import type { LoggerInterface } from "./LoggerInterface.js";
import { MessageValidator } from "./MessageValidator.js";
import { OpenAiLlmClient } from "./OpenAiLlmClient.js";
import { TelegramMessageHandler } from "./TelegramMessageHandler.js";
import { registerTelegramTextHandler, type TelegramBotInterface } from "./TelegramUpdateAdapter.js";
import { WinstonLogger } from "./WinstonLogger.js";

export interface MainDependencies {
    config?: AppConfig;
    logger?: LoggerInterface;
    bot?: TelegramBotInterface;
    registerShutdown?: (signal: "SIGINT" | "SIGTERM", callback: () => void) => void;
}

export async function main(dependencies: MainDependencies = {}): Promise<void> {
    const config = dependencies.config ?? loadConfig();
    const logger = dependencies.logger ?? new WinstonLogger(config.logLevel);
    const llm = new OpenAiLlmClient(config.llm, logger);
    const handler = new TelegramMessageHandler(new MessageValidator(), llm, logger);
    const bot = dependencies.bot ?? (new Telegraf(config.telegramBotToken) as unknown as TelegramBotInterface);
    registerTelegramTextHandler(bot, handler, logger);
    logger.info("Starting Telegram bot", {
        provider: config.llm.provider,
        model: config.llm.model,
    });
    await bot.launch();
    logger.info("Telegram polling started");
    const registerShutdown = dependencies.registerShutdown ?? ((signal, callback) => process.once(signal, callback));
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        registerShutdown(signal, () => {
            logger.info("Stopping Telegram polling", { signal });
            bot.stop(signal);
        });
    }
}

if (process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js")) {
    void main().catch((error) => {
        console.error("Application startup failed:", error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
