import { describe, expect, it } from "vitest";

import { MessageValidator } from "../src/MessageValidator.js";

const validator = new MessageValidator();
describe("MessageValidator", () => {
    it.each([{ chatId: 1 }, { chatId: 1, text: "   " }, { chatId: 1, text: "" }, { text: "hi" }])(
        "rejects invalid input %#",
        (input) => expect(validator.validate(input)).toMatchObject({ valid: false }),
    );
    it("accepts one-character and 1024-character Unicode text", () => {
        expect(validator.validate({ chatId: 1, text: "🙂" }).valid).toBe(true);
        expect(validator.validate({ chatId: 1, text: "a".repeat(1024) }).valid).toBe(true);
    });
    it("rejects text over 1024 Unicode code points", () =>
        expect(validator.validate({ chatId: 1, text: "🙂".repeat(1025) }).valid).toBe(false));
});
