export type Dialog = { id: string; participantId: string };

export interface DialogStorage {
    getOrCreateActiveDialog(participantId: string): Promise<Dialog>;
    startNewDialog(participantId: string): Promise<Dialog>;
}
