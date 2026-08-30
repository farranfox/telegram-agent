import type { AgentMessage, ToolCall } from "../agent/AgentMessage.js";

export interface MessageStorage {
    loadContext(dialogId: string, limit: number): Promise<AgentMessage[]>;
    appendUser(dialogId: string, content: string): Promise<void>;
    appendAssistant(dialogId: string, content: string): Promise<void>;
    appendToolTurn(
        dialogId: string,
        content: string,
        calls: ToolCall[],
        results: Array<{ toolCallId: string; content: string }>,
    ): Promise<void>;
}
