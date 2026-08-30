export class ParticipantQueue {
    private readonly tails = new Map<string, Promise<unknown>>();

    public run<T>(participantId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(participantId) ?? Promise.resolve();
        const next = previous.then(task, task);
        this.tails.set(
            participantId,
            next.catch(() => undefined),
        );
        void next.finally(() => {
            if (this.tails.get(participantId) === next) {
                this.tails.delete(participantId);
            }
        });
        return next;
    }

    public async drain(participantId: string): Promise<void> {
        await this.tails.get(participantId);
    }
}
