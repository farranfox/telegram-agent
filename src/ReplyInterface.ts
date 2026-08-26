export interface ReplyInterface {
    send(chatId: number | string, text: string): Promise<void>;
}
