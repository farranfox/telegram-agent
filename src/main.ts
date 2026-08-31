import { fileURLToPath } from "node:url";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

import { Agent } from "./agent/Agent.js";
import { systemClock } from "./agent/Clock.js";
import { loadConfig } from "./config/Config.js";
import { OpenAICompatibleClient } from "./llm/OpenAICompatibleClient.js";
import { DialogRunService } from "./runtime/DialogRunService.js";
import { FileSkillCatalog } from "./skills/FileSkillCatalog.js";
import { SkillSystemPromptProvider } from "./skills/SkillSystemPromptProvider.js";
import { SQLiteDatabase } from "./storage/SQLiteDatabase.js";
import { SQLiteDialogStorage } from "./storage/SQLiteDialogStorage.js";
import { SQLiteMessageStorage } from "./storage/SQLiteMessageStorage.js";
import { toTelegramMessage } from "./telegram/TelegramMessage.js";
import { TelegramMessageHandler } from "./telegram/TelegramMessageHandler.js";
import { CurrentDateTimeTool } from "./tools/CurrentDateTimeTool.js";
import { DockerSandboxExecutor } from "./tools/DockerSandboxExecutor.js";
import { ExecTool } from "./tools/ExecTool.js";
import { LoadSkillTool } from "./tools/LoadSkillTool.js";
import { ChildProcessRunner } from "./tools/ProcessRunner.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";

export async function main(): Promise<void> {
    const config = loadConfig();
    const database = new SQLiteDatabase(config.sqlitePath);
    const skills = new FileSkillCatalog(fileURLToPath(new URL("../skills", import.meta.url)));
    const tools = new ToolRegistry([
        new LoadSkillTool(skills),
        new CurrentDateTimeTool(() => systemClock.now()),
        new ExecTool(
            new DockerSandboxExecutor({
                composeFile: fileURLToPath(new URL("../sandbox-runner/compose.yaml", import.meta.url)),
                maxOutputBytes: 32_768,
                processRunner: new ChildProcessRunner(),
                timeoutMs: 30_000,
            }),
        ),
    ]);
    const agent = new Agent({
        clock: systemClock,
        llm: new OpenAICompatibleClient(config.llm),
        logger: console,
        messageStorage: new SQLiteMessageStorage(database),
        systemPromptProvider: new SkillSystemPromptProvider(skills),
        toolRunner: tools,
    });
    const handler = new TelegramMessageHandler(
        new DialogRunService({ agent, dialogStorage: new SQLiteDialogStorage(database), logger: console }),
    );
    const bot = new Telegraf(config.telegramBotToken);
    bot.on(message("text"), async (context) => {
        const incoming = toTelegramMessage(context);
        if (incoming) {
            await handler.handle(incoming, async (text) => await context.reply(text));
        }
    });
    // Предохранитель: без него любая необработанная ошибка в обработчике обновления
    // доходит до Telegraf, становится unhandled rejection и убивает процесс бота.
    bot.catch((error, context) => {
        console.error("telegram.update.failed", {
            error: error instanceof Error ? error.message : "Unknown error",
            updateId: context.update.update_id,
        });
    });
    await bot.launch();
}

if (process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js")) {
    void main();
}
