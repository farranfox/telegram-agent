import { describe, expect, it } from "vitest";

import { SQLiteDatabase } from "../src/storage/SQLiteDatabase.js";
import { SQLiteDialogStorage } from "../src/storage/SQLiteDialogStorage.js";
import { SQLiteMessageStorage } from "../src/storage/SQLiteMessageStorage.js";

describe("SQLite storage", () => {
    it("switches the active dialog without deleting old messages", async () => {
        const database = new SQLiteDatabase(":memory:");
        const dialogs = new SQLiteDialogStorage(database);
        const messages = new SQLiteMessageStorage(database);
        const first = await dialogs.getOrCreateActiveDialog("tg:1:2");
        await messages.appendUser(first.id, "старый вопрос");
        const second = await dialogs.startNewDialog("tg:1:2");

        expect(second.id).not.toBe(first.id);
        await expect(messages.loadContext(first.id, 10)).resolves.toEqual([{ role: "user", content: "старый вопрос" }]);
        await expect(dialogs.getOrCreateActiveDialog("tg:1:2")).resolves.toEqual(second);
        database.close();
    });

    it("stores an assistant tool call and matching tool result", async () => {
        const database = new SQLiteDatabase(":memory:");
        const dialogs = new SQLiteDialogStorage(database);
        const messages = new SQLiteMessageStorage(database);
        const dialog = await dialogs.getOrCreateActiveDialog("tg:1:2");

        await messages.appendToolTurn(
            dialog.id,
            "",
            [{ id: "call_1", name: "exec", arguments: '{"command":"date"}' }],
            [{ toolCallId: "call_1", content: "Mon" }],
        );

        await expect(messages.loadContext(dialog.id, 10)).resolves.toEqual([
            {
                content: "",
                role: "assistant",
                toolCalls: [{ id: "call_1", name: "exec", arguments: '{"command":"date"}' }],
            },
            { content: "Mon", role: "tool", toolCallId: "call_1" },
        ]);
        database.close();
    });
});
