import type { Tool, ToolResult } from "./Tool.js";

const DEFAULT_TIME_ZONE = "UTC";
const DEFAULT_LOCALE = "ru-RU";

/**
 * Отдаёт текущее время уже пересчитанным в нужную зону и уже отформатированным.
 *
 * Модель считает время плохо: получив из промпта верное `13:10:41Z`, она сообщила
 * пользователю «17:10 (UTC+3)» вместо 16:10. Поэтому инструмент возвращает готовую
 * строку и намеренно не отдаёт ISO-метку — иначе модель снова начнёт пересчитывать
 * вручную и показывать пользователю технический формат.
 */
export class CurrentDateTimeTool implements Tool {
    public readonly spec = {
        name: "current_datetime",
        description:
            "Returns the current date and time already converted to the requested IANA time zone and " +
            "formatted for the requested locale. Use it for any question about the current date, the " +
            "weekday, or the local time somewhere. Never convert time zones yourself.",
        parameters: {
            type: "object",
            properties: {
                timeZone: { type: "string" },
                locale: { type: "string" },
            },
            required: [],
            additionalProperties: false,
        },
    };

    public constructor(private readonly now: () => number) {}

    public async execute(_runId: string, input: Record<string, unknown>, _signal: AbortSignal): Promise<ToolResult> {
        const timeZone = text(input.timeZone) ?? DEFAULT_TIME_ZONE;
        const locale = text(input.locale) ?? DEFAULT_LOCALE;

        if (!supported({ timeZone })) {
            return {
                ok: false,
                error: {
                    code: "unknown_time_zone",
                    message:
                        `Unknown time zone: ${timeZone}. Use an IANA name such as Europe/Istanbul, ` +
                        "Asia/Bishkek or UTC.",
                },
            };
        }
        if (!supported({ locale })) {
            return {
                ok: false,
                error: { code: "unknown_locale", message: `Unknown locale: ${locale}. Use a tag such as ru-RU.` },
            };
        }

        const moment = new Date(this.now());
        const dateTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "long", timeStyle: "short" }).format(
            moment,
        );
        const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(moment);
        return { ok: true, output: `${dateTime} (${weekday}, ${timeZone}, ${offsetOf(moment, timeZone)})` };
    }
}

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Intl бросает RangeError и на неизвестную зону, и на неизвестную локаль. */
function supported(options: { timeZone?: string; locale?: string }): boolean {
    try {
        new Intl.DateTimeFormat(options.locale ?? "en-US", { timeZone: options.timeZone ?? DEFAULT_TIME_ZONE });
        return true;
    } catch {
        return false;
    }
}

function offsetOf(moment: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(moment);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
}
