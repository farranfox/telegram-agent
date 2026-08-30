export class SeenUpdates {
    private readonly identifiers = new Set<number>();

    public isNew(updateId: number): boolean {
        if (this.identifiers.has(updateId)) return false;
        this.identifiers.add(updateId);
        return true;
    }
}
