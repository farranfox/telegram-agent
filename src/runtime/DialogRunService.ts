import { AgentCancelledError } from "../agent/errors/AgentCancelledError.js";
import type { Logger } from "../logging/Logger.js";
import type { Dialog, DialogStorage } from "../storage/DialogStorage.js";
import { ActiveRunRegistry } from "./ActiveRunRegistry.js";
import { ParticipantQueue } from "./ParticipantQueue.js";

export interface AgentRunner {
    run(dialogId: string, text: string, signal: AbortSignal): Promise<string>;
}

export type DialogRunResult =
    { type: "busy" } | { type: "cancelled" } | { type: "failed" } | { type: "success"; response: string };

export class DialogRunService {
    private readonly activeRuns: ActiveRunRegistry;
    private readonly queue: ParticipantQueue;

    public constructor(
        private readonly dependencies: { agent: AgentRunner; dialogStorage: DialogStorage; logger?: Logger },
        queue = new ParticipantQueue(),
        activeRuns = new ActiveRunRegistry(),
    ) {
        this.queue = queue;
        this.activeRuns = activeRuns;
    }

    public async run(participantId: string, text: string): Promise<DialogRunResult> {
        const controller = this.activeRuns.start(participantId);
        if (!controller) {
            return { type: "busy" };
        }
        try {
            return await this.queue.run(participantId, async () => {
                const dialog = await this.dependencies.dialogStorage.getOrCreateActiveDialog(participantId);
                const response = await this.dependencies.agent.run(dialog.id, text, controller.signal);
                return controller.signal.aborted ? { type: "cancelled" } : { type: "success", response };
            });
        } catch (error) {
            // Сбой одного прогона не должен ронять бота: наружу уходит результат, не исключение.
            if (error instanceof AgentCancelledError || controller.signal.aborted) {
                return { type: "cancelled" };
            }
            this.dependencies.logger?.error("dialog.run.failed", {
                error: error instanceof Error ? error.message : "Unknown error",
                participantId,
            });
            return { type: "failed" };
        } finally {
            this.activeRuns.finish(participantId, controller);
        }
    }

    public async startNewDialog(participantId: string): Promise<Dialog> {
        this.activeRuns.abort(participantId);
        const dialog = await this.dependencies.dialogStorage.startNewDialog(participantId);
        await this.queue.drain(participantId);
        return dialog;
    }

    public stop(participantId: string): boolean {
        return this.activeRuns.abort(participantId);
    }
}
