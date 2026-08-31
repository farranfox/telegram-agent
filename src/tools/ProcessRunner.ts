import { spawn } from "node:child_process";

export type ProcessResult = { exitCode: number | null; output: string; timedOut: boolean; truncated: boolean };
export type ProcessOptions = { input: string; maxOutputBytes: number; signal: AbortSignal; timeoutMs: number };

export interface ProcessRunner {
    run(executable: string, argumentsList: string[], options: ProcessOptions): Promise<ProcessResult>;
}

export class ChildProcessRunner implements ProcessRunner {
    public async run(executable: string, argumentsList: string[], options: ProcessOptions): Promise<ProcessResult> {
        return await new Promise((resolve, reject) => {
            const child = spawn(executable, argumentsList, { stdio: ["pipe", "pipe", "pipe"] });
            const chunks: Buffer[] = [];
            let outputBytes = 0;
            let timedOut = false;
            let truncated = false;
            const append = (chunk: Buffer): void => {
                const available = options.maxOutputBytes - outputBytes;
                if (available <= 0) {
                    truncated = true;
                    return;
                }
                const written = chunk.subarray(0, available);
                chunks.push(written);
                outputBytes += written.length;
                if (written.length < chunk.length) {
                    truncated = true;
                }
            };
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
            }, options.timeoutMs);
            const abort = (): void => {
                child.kill("SIGTERM");
            };
            const release = (): void => {
                clearTimeout(timer);
                options.signal.removeEventListener("abort", abort);
            };
            options.signal.addEventListener("abort", abort, { once: true });
            child.stdout.on("data", append);
            child.stderr.on("data", append);
            // Защита: ошибка записи в stdin умершего процесса не должна всплывать наружу.
            // Node 22 гасит EPIPE на stdio ребёнка сам, но настоящая причина сбоя всё равно
            // приходит через "error" или ненулевой exit code, поэтому стрим глушим молча.
            child.stdin.on("error", () => undefined);
            child.once("error", (error) => {
                release();
                reject(error);
            });
            child.once("close", (exitCode) => {
                release();
                resolve({ exitCode, output: Buffer.concat(chunks).toString("utf8"), timedOut, truncated });
            });
            child.stdin.end(options.input);
        });
    }
}
