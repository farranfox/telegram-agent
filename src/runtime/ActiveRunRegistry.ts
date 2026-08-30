export class ActiveRunRegistry {
    private readonly controllers = new Map<string, AbortController>();

    public start(participantId: string): AbortController | undefined {
        if (this.controllers.has(participantId)) return undefined;
        const controller = new AbortController();
        this.controllers.set(participantId, controller);
        return controller;
    }

    public abort(participantId: string): boolean {
        const controller = this.controllers.get(participantId);
        if (!controller) return false;
        controller.abort();
        return true;
    }

    public finish(participantId: string, controller: AbortController): void {
        if (this.controllers.get(participantId) === controller) this.controllers.delete(participantId);
    }
}
