export interface Clock {
    now(): number;
    sleep(milliseconds: number): Promise<void>;
}

export const systemClock: Clock = {
    now: () => Date.now(),
    sleep: async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)),
};
