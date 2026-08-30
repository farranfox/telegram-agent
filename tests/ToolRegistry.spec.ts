import { describe, expect, it } from "vitest";

import { ToolRegistry } from "../src/tools/ToolRegistry.js";

describe("ToolRegistry", () => {
    it("returns an error result for malformed tool arguments", async () => {
        const registry = new ToolRegistry([]);

        await expect(
            registry.run("run", { id: "1", name: "missing", arguments: "{" }, new AbortController().signal),
        ).resolves.toEqual({
            error: { code: "unknown_tool", message: "Unknown tool: missing" },
            ok: false,
        });
    });
});
