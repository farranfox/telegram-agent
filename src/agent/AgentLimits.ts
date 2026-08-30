export type AgentLimits = {
    maxRounds: number;
    toolRoundLimit: number;
    maxToolCallsPerResponse: number;
    maxToolExecutions: number;
    maxLlmAttempts: number;
    toolOutputChars: number;
    contextMessages: number;
    wallClockMs: number;
};

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
    maxRounds: 6,
    toolRoundLimit: 5,
    maxToolCallsPerResponse: 3,
    maxToolExecutions: 8,
    maxLlmAttempts: 8,
    toolOutputChars: 2000,
    contextMessages: 30,
    wallClockMs: 120_000,
};
