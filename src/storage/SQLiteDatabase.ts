import { DatabaseSync } from "node:sqlite";

export class SQLiteDatabase {
    public readonly connection: DatabaseSync;

    public constructor(path: string) {
        this.connection = new DatabaseSync(path);
        this.connection.exec("PRAGMA foreign_keys = ON;");
        this.connection.exec("PRAGMA journal_mode = WAL;");
        this.connection.exec("PRAGMA busy_timeout = 5000;");
        this.connection.exec(`
            CREATE TABLE IF NOT EXISTS dialogs (
                dialog_id TEXT PRIMARY KEY,
                participant_id TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS active_dialogs (
                participant_id TEXT PRIMARY KEY,
                dialog_id TEXT NOT NULL REFERENCES dialogs(dialog_id),
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dialog_id TEXT NOT NULL REFERENCES dialogs(dialog_id),
                turn_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
                content TEXT NOT NULL DEFAULT '',
                tool_calls_json TEXT,
                tool_call_id TEXT,
                created_at INTEGER NOT NULL,
                CHECK (
                    (role = 'user' AND tool_calls_json IS NULL AND tool_call_id IS NULL)
                    OR (role = 'assistant' AND tool_call_id IS NULL)
                    OR (role = 'tool' AND tool_calls_json IS NULL AND tool_call_id IS NOT NULL)
                )
            );
            CREATE INDEX IF NOT EXISTS agent_messages_dialog_id_id
                ON agent_messages(dialog_id, id);
        `);
    }

    public close(): void {
        this.connection.close();
    }

    public transaction(callback: () => void): void {
        this.connection.exec("BEGIN IMMEDIATE;");
        try {
            callback();
            this.connection.exec("COMMIT;");
        } catch (error) {
            this.connection.exec("ROLLBACK;");
            throw error;
        }
    }
}
