import { describe, expect, it, vi } from "vitest";

import { WinstonLogger } from "../src/WinstonLogger.js";

describe("WinstonLogger", () => {
    it("forwards all contract log levels to Winston", () => {
        const winstonLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const logger = new WinstonLogger("debug", winstonLogger as never);
        logger.debug("debug", { safe: true });
        logger.info("info");
        logger.warn("warn");
        logger.error("error");
        expect(winstonLogger.debug).toHaveBeenCalledWith("debug", { safe: true });
        expect(winstonLogger.info).toHaveBeenCalledWith("info", undefined);
        expect(winstonLogger.warn).toHaveBeenCalledWith("warn", undefined);
        expect(winstonLogger.error).toHaveBeenCalledWith("error", undefined);
    });
});
