export interface SystemPromptProvider {
    build(now: number): string;
}
