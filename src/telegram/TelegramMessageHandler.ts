import type { DialogRunService } from "../runtime/DialogRunService.js";
import type { TelegramMessage } from "./TelegramMessage.js";

export class TelegramMessageHandler {
    public constructor(private readonly runs: DialogRunService) {}

    public async handle(message: TelegramMessage, reply: (text: string) => Promise<unknown>): Promise<void> {
        if (!message.text.trim() || Array.from(message.text).length > 1024) {
            await reply("Отправьте непустое текстовое сообщение до 1024 символов.");
            return;
        }
        const participantId = `tg:${message.chatId}:${message.userId}`;
        if (command(message.text, "start")) {
            return void (await reply("Здравствуйте! Чем могу помочь?"));
        }
        if (command(message.text, "stop")) {
            return void (await reply(this.runs.stop(participantId) ? "Останавливаю задачу." : "Активной задачи нет."));
        }
        if (command(message.text, "new")) {
            await this.runs.startNewDialog(participantId);
            await reply("Начали новый диалог.");
            return;
        }
        const result = await this.runs.run(participantId, message.text);
        if (result.type === "busy") {
            return void (await reply("Агент сейчас занят, попробуйте после ответа."));
        }
        if (result.type === "success") {
            await reply(result.response);
        }
    }
}

function command(text: string, value: string): boolean {
    return new RegExp(`^/${value}(?:@\\w+)?(?:\\s|$)`, "i").test(text.trim());
}
