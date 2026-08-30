export type SandboxExecution = { exitCode: number | null; output: string; timedOut: boolean; truncated: boolean };

export interface SandboxExecutor {
    execute(runId: string, command: string, signal: AbortSignal): Promise<SandboxExecution>;
    disposeRun(runId: string): Promise<void>;
}
