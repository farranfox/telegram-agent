export interface LlmClientInterface {
    complete(prompt: string): Promise<string>;
}
