export interface AppConfig {
    telegramBotToken: string;
    llm: { provider: string; baseUrl: string; model: string; apiKey?: string };
    logLevel: string;
}

const required = (environment: NodeJS.ProcessEnv, name: string): string => {
    const value = environment[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

function normalizeBaseUrl(provider: string, baseUrl: string): string {
    const url = new URL(baseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");

    if (provider.toLowerCase() === "ollama" && !pathname.endsWith("/v1")) {
        url.pathname = `${pathname}/v1`;
    } else {
        url.pathname = pathname;
    }

    return url.toString().replace(/\/$/, "");
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
    const provider = required(environment, "LLM_PROVIDER");
    const rawBaseUrl = required(environment, "LLM_BASE_URL");
    let baseUrl: string;

    try {
        baseUrl = normalizeBaseUrl(provider, rawBaseUrl);
    } catch {
        throw new Error("LLM_BASE_URL must be a valid URL");
    }

    const logLevel = required(environment, "LOG_LEVEL").toLowerCase();
    if (!["error", "warn", "info", "http", "verbose", "debug", "silly"].includes(logLevel)) {
        throw new Error("LOG_LEVEL must be a valid Winston log level");
    }

    const apiKey = environment.LLM_API_KEY?.trim();

    return {
        telegramBotToken: required(environment, "TELEGRAM_BOT_TOKEN"),
        llm: {
            provider,
            baseUrl,
            model: required(environment, "LLM_MODEL"),
            ...(apiKey ? { apiKey } : {}),
        },
        logLevel,
    };
}
