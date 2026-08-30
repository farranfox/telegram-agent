import type { ToolCall } from "../agent/AgentMessage.js";
import type { ToolResult, ToolSpec } from "./Tool.js";

export interface ToolRunner {
    specs(): ToolSpec[];
    run(runId: string, call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
    disposeRun(runId: string): Promise<void>;
}
