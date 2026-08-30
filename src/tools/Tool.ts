export type ToolSpec = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
};

export type ToolResult = { ok: true; output: string } | { ok: false; error: { code: string; message: string } };

export interface Tool {
    readonly spec: ToolSpec;
    execute(runId: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
    disposeRun?(runId: string): Promise<void>;
}
