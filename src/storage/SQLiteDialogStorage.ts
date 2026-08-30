import { randomUUID } from "node:crypto";

import type { Dialog, DialogStorage } from "./DialogStorage.js";
import { SQLiteDatabase } from "./SQLiteDatabase.js";

export class SQLiteDialogStorage implements DialogStorage {
    public constructor(private readonly database: SQLiteDatabase) {}

    public async getOrCreateActiveDialog(participantId: string): Promise<Dialog> {
        const existing = this.findActive(participantId);
        return await (existing ?? this.startNewDialog(participantId));
    }

    public async startNewDialog(participantId: string): Promise<Dialog> {
        const dialog: Dialog = { id: randomUUID(), participantId };
        const now = Date.now();
        this.database.transaction(() => {
            this.database.connection
                .prepare("INSERT INTO dialogs (dialog_id, participant_id, created_at) VALUES (?, ?, ?)")
                .run(dialog.id, participantId, now);
            this.database.connection
                .prepare(
                    `INSERT INTO active_dialogs (participant_id, dialog_id, updated_at) VALUES (?, ?, ?)
                     ON CONFLICT(participant_id) DO UPDATE SET
                       dialog_id = excluded.dialog_id,
                       updated_at = excluded.updated_at`,
                )
                .run(participantId, dialog.id, now);
        });
        return dialog;
    }

    private findActive(participantId: string): Dialog | undefined {
        const row = this.database.connection
            .prepare(
                `SELECT active.dialog_id, dialogs.participant_id
                 FROM active_dialogs AS active JOIN dialogs ON dialogs.dialog_id = active.dialog_id
                 WHERE active.participant_id = ?`,
            )
            .get(participantId) as { dialog_id: string; participant_id: string } | undefined;
        return row ? { id: row.dialog_id, participantId: row.participant_id } : undefined;
    }
}
