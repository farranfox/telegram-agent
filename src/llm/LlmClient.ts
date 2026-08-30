import type { AgentMessage, AssistantTurn } from "../agent/AgentMessage.js";
import type { ToolSpec } from "../tools/Tool.js";

export interface LlmClient {
    complete(messages: AgentMessage[], tools: ToolSpec[] | null, signal: AbortSignal): Promise<AssistantTurn>;
}
