import type { AgentMessage, ToolCall } from "../agent/AgentMessage.js";
import type { MessageStorage } from "./MessageStorage.js";
import { SQLiteDatabase } from "./SQLiteDatabase.js";

type MessageRow = {
    role: "user" | "assistant" | "tool";
    content: string;
    tool_calls_json: string | null;
    tool_call_id: string | null;
};

export class SQLiteMessageStorage implements MessageStorage {
    public constructor(private readonly database: SQLiteDatabase) {}

    public async loadContext(dialogId: string, limit: number): Promise<AgentMessage[]> {
        const rows = this.database.connection
            .prepare(
                `SELECT role, content, tool_calls_json, tool_call_id FROM agent_messages
                 WHERE dialog_id = ? ORDER BY id DESC LIMIT ?`,
            )
            .all(dialogId, limit) as MessageRow[];
        return rows.reverse().map((row) => this.toMessage(row));
    }

    public async appendUser(dialogId: string, content: string): Promise<void> {
        this.insert(dialogId, this.nextTurn(dialogId), "user", content, null, null);
    }

    public async appendAssistant(dialogId: string, content: string): Promise<void> {
        this.insert(dialogId, this.nextTurn(dialogId), "assistant", content, null, null);
    }

    public async appendToolTurn(
        dialogId: string,
        content: string,
        calls: ToolCall[],
        results: Array<{ toolCallId: string; content: string }>,
    ): Promise<void> {
        this.database.transaction(() => {
            const turnId = this.nextTurn(dialogId);
            this.insert(dialogId, turnId, "assistant", content, JSON.stringify(calls), null);
            for (const result of results)
                this.insert(dialogId, turnId, "tool", result.content, null, result.toolCallId);
        });
    }

    private insert(
        dialogId: string,
        turnId: number,
        role: "user" | "assistant" | "tool",
        content: string,
        toolCallsJson: string | null,
        toolCallId: string | null,
    ): void {
        this.database.connection
            .prepare(
                `INSERT INTO agent_messages
                 (dialog_id, turn_id, role, content, tool_calls_json, tool_call_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(dialogId, turnId, role, content, toolCallsJson, toolCallId, Date.now());
    }

    private nextTurn(dialogId: string): number {
        const row = this.database.connection
            .prepare("SELECT COALESCE(MAX(turn_id), 0) + 1 AS next_turn FROM agent_messages WHERE dialog_id = ?")
            .get(dialogId) as { next_turn: number };
        return row.next_turn;
    }

    private toMessage(row: MessageRow): AgentMessage {
        if (row.role === "tool") return { role: "tool", content: row.content, toolCallId: row.tool_call_id ?? "" };
        if (row.role === "assistant") {
            const toolCalls = row.tool_calls_json ? (JSON.parse(row.tool_calls_json) as ToolCall[]) : undefined;
            return { role: "assistant", content: row.content, ...(toolCalls ? { toolCalls } : {}) };
        }
        return { role: "user", content: row.content };
    }
}
