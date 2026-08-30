export type ToolCall = {
    id: string;
    name: string;
    arguments: string;
};

export type AgentMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
    | { role: "tool"; content: string; toolCallId: string };

export type AssistantTurn = {
    content: string;
    toolCalls: ToolCall[];
};
