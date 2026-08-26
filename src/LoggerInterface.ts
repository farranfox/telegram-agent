export type SafeMetadata = Record<string, unknown>;

export interface LoggerInterface {
    debug(message: string, metadata?: SafeMetadata): void;
    info(message: string, metadata?: SafeMetadata): void;
    warn(message: string, metadata?: SafeMetadata): void;
    error(message: string, metadata?: SafeMetadata): void;
}
