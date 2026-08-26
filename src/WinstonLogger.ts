import winston from "winston";

import type { LoggerInterface, SafeMetadata } from "./LoggerInterface.js";

export class WinstonLogger implements LoggerInterface {
    private readonly logger: winston.Logger;

    constructor(level: string, logger?: winston.Logger) {
        this.logger =
            logger ??
            winston.createLogger({
                level,
                transports: [new winston.transports.Console()],
            });
    }
    debug(message: string, metadata?: SafeMetadata): void {
        this.logger.debug(message, metadata);
    }
    info(message: string, metadata?: SafeMetadata): void {
        this.logger.info(message, metadata);
    }
    warn(message: string, metadata?: SafeMetadata): void {
        this.logger.warn(message, metadata);
    }
    error(message: string, metadata?: SafeMetadata): void {
        this.logger.error(message, metadata);
    }
}
