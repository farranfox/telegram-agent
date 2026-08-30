export class LlmError extends Error {
    public constructor(
        message: string,
        public readonly retryable: boolean,
    ) {
        super(message);
    }
}
