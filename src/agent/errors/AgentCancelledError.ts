export class AgentCancelledError extends Error {
    public constructor() {
        super("Agent run cancelled");
    }
}
