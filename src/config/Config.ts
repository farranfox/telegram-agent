export type Config = {
    llm: { apiKey?: string; baseUrl: string; model: string };
    logLevel: string;
    sqlitePath: string;
    telegramBotToken: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
    const required = (name: string): string => {
        const value = environment[name]?.trim();
        if (!value) {
            throw new Error(`Missing required environment variable: ${name}`);
        }
        return value;
    };
    return {
        llm: {
            apiKey: environment.LLM_API_KEY?.trim() || undefined,
            baseUrl: required("LLM_BASE_URL"),
            model: required("LLM_MODEL"),
        },
        logLevel: environment.LOG_LEVEL?.trim() || "info",
        sqlitePath: environment.SQLITE_PATH?.trim() || "data/agent.sqlite",
        telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    };
}
