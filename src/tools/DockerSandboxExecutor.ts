import type { ProcessRunner } from "./ProcessRunner.js";
import type { SandboxExecution, SandboxExecutor } from "./SandboxExecutor.js";

export class DockerSandboxExecutor implements SandboxExecutor {
    private readonly volumes = new Map<string, string>();

    public constructor(
        private readonly options: {
            composeFile: string;
            maxOutputBytes: number;
            processRunner: ProcessRunner;
            timeoutMs: number;
        },
    ) {}

    public async execute(runId: string, command: string, signal: AbortSignal): Promise<SandboxExecution> {
        const volume = await this.volumeFor(runId, signal);
        return await this.options.processRunner.run(
            "docker",
            [
                "compose",
                "-f",
                this.options.composeFile,
                "run",
                "--rm",
                "-T",
                "--volume",
                `${volume}:/workspace`,
                "sandbox-runner",
            ],
            { input: command, maxOutputBytes: this.options.maxOutputBytes, signal, timeoutMs: this.options.timeoutMs },
        );
    }

    public async disposeRun(runId: string): Promise<void> {
        const volume = this.volumes.get(runId);
        if (!volume) return;
        this.volumes.delete(runId);
        await this.options.processRunner.run("docker", ["volume", "rm", "-f", volume], {
            input: "",
            maxOutputBytes: this.options.maxOutputBytes,
            signal: new AbortController().signal,
            timeoutMs: this.options.timeoutMs,
        });
    }

    private async volumeFor(runId: string, signal: AbortSignal): Promise<string> {
        const previous = this.volumes.get(runId);
        if (previous) return previous;
        const volume = `agent-sandbox-${runId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 64)}`;
        const result = await this.options.processRunner.run("docker", ["volume", "create", volume], {
            input: "",
            maxOutputBytes: this.options.maxOutputBytes,
            signal,
            timeoutMs: this.options.timeoutMs,
        });
        if (result.exitCode !== 0 || result.timedOut) throw new Error("Docker sandbox workspace is unavailable");
        this.volumes.set(runId, volume);
        return volume;
    }
}
