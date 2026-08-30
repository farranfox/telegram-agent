import { fileURLToPath } from "node:url";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

import { Agent } from "./agent/Agent.js";
import { systemClock } from "./agent/Clock.js";
import { loadConfig } from "./config/Config.js";
import { OpenAICompatibleClient } from "./llm/OpenAICompatibleClient.js";
import { DialogRunService } from "./runtime/DialogRunService.js";
import { FileSkillCatalog } from "./skills/FileSkillCatalog.js";
import { SQLiteDatabase } from "./storage/SQLiteDatabase.js";
import { SQLiteDialogStorage } from "./storage/SQLiteDialogStorage.js";
import { SQLiteMessageStorage } from "./storage/SQLiteMessageStorage.js";
import { toTelegramMessage } from "./telegram/TelegramMessage.js";
import { TelegramMessageHandler } from "./telegram/TelegramMessageHandler.js";
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
        systemPromptProvider: {
            build: () =>
                `Ты полезный агент. Не выдумывай результаты инструментов.\n${skills
                    .all()
                    .map((skill) => `- ${skill.name}: ${skill.description}`)
                    .join("\n")}`,
        },
        toolRunner: tools,
    });
    const handler = new TelegramMessageHandler(
        new DialogRunService({ agent, dialogStorage: new SQLiteDialogStorage(database) }),
    );
    const bot = new Telegraf(config.telegramBotToken);
    bot.on(message("text"), async (context) => {
        const incoming = toTelegramMessage(context);
        if (incoming) {
            await handler.handle(incoming, async (text) => await context.reply(text));
        }
    });
    await bot.launch();
}

if (process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js")) {
    void main();
}
