import { describe, expect, it, vi } from "vitest";

import { CurrentDateTimeTool } from "../src/tools/CurrentDateTimeTool.js";

const signal = new AbortController().signal;
// Тот самый момент из живого прогона, на котором модель ошиблась.
const ISTANBUL_MOMENT = Date.UTC(2026, 7, 31, 13, 10, 41);
const toolAt = (moment: number) => new CurrentDateTimeTool(() => moment);

describe("CurrentDateTimeTool", () => {
    // Регрессия на живой отказ: имея верное 13:10:41Z, модель сообщила пользователю
    // «17:10 (UTC+3)». Правильный ответ — 16:10, и считать его должен инструмент, а не модель.
    it("converts UTC to the requested zone instead of leaving arithmetic to the model", async () => {
        const result = await toolAt(ISTANBUL_MOMENT).execute("run-1", { timeZone: "Europe/Istanbul" }, signal);

        expect(result).toEqual({
            ok: true,
            output: "31 августа 2026 г. в 16:10 (понедельник, Europe/Istanbul, GMT+3)",
        });
    });

    // Разные зоны от одного и того же момента — смещения не должны путаться.
    it("resolves several zones from the same instant", async () => {
        const tool = toolAt(ISTANBUL_MOMENT);

        const bishkek = await tool.execute("run-1", { timeZone: "Asia/Bishkek" }, signal);
        const almaty = await tool.execute("run-1", { timeZone: "Asia/Almaty" }, signal);

        expect(bishkek).toMatchObject({ ok: true, output: expect.stringContaining("в 19:10") });
        expect(bishkek).toMatchObject({ output: expect.stringContaining("GMT+6") });
        expect(almaty).toMatchObject({ ok: true, output: expect.stringContaining("в 18:10") });
        expect(almaty).toMatchObject({ output: expect.stringContaining("GMT+5") });
    });

    // Без аргументов — UTC и русская локаль, чтобы пустой вызов не падал.
    it("defaults to UTC and the ru-RU locale", async () => {
        const result = await toolAt(ISTANBUL_MOMENT).execute("run-1", {}, signal);

        expect(result).toEqual({
            ok: true,
            output: "31 августа 2026 г. в 13:10 (понедельник, UTC, GMT)",
        });
    });

    // Локаль управляет языком вывода: бот отвечает на языке пользователя.
    it("formats in the requested locale", async () => {
        const result = await toolAt(ISTANBUL_MOMENT).execute(
            "run-1",
            { timeZone: "Europe/Istanbul", locale: "en-US" },
            signal,
        );

        expect(result).toMatchObject({ ok: true, output: expect.stringContaining("August 31, 2026") });
        expect(result).toMatchObject({ output: expect.stringContaining("Monday") });
    });

    // Ответ намеренно не содержит ISO-метки: иначе модель снова покажет её
    // пользователю и начнёт пересчитывать время вручную.
    it("never returns a raw ISO timestamp", async () => {
        const result = await toolAt(ISTANBUL_MOMENT).execute("run-1", { timeZone: "Europe/Istanbul" }, signal);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
            expect(result.output).not.toContain("Z");
        }
    });

    // Выдуманная зона — внятная ошибка, а не молчаливый UTC.
    // В sandbox `date` на неизвестной зоне отдал бы UTC, то есть уверенно неверный ответ.
    it("rejects an unknown time zone with a usable message", async () => {
        const result = await toolAt(ISTANBUL_MOMENT).execute("run-1", { timeZone: "Europe/Bishkek" }, signal);

        expect(result).toEqual({
            ok: false,
            error: {
                code: "unknown_time_zone",
                message:
                    "Unknown time zone: Europe/Bishkek. Use an IANA name such as Europe/Istanbul, " +
                    "Asia/Bishkek or UTC.",
            },
        });
    });

    // Неверная локаль отличается от неверной зоны: модель должна знать, что именно править.
    it("rejects an unknown locale separately from the time zone", async () => {
        const result = await toolAt(ISTANBUL_MOMENT).execute("run-1", { locale: "не-локаль" }, signal);

        expect(result).toEqual({
            ok: false,
            error: { code: "unknown_locale", message: "Unknown locale: не-локаль. Use a tag such as ru-RU." },
        });
    });

    // Время берётся из переданных часов, а не из Date.now(): иначе тест был бы недетерминирован.
    it("reads the moment from the injected clock on every call", async () => {
        const now = vi.fn(() => ISTANBUL_MOMENT);
        const tool = new CurrentDateTimeTool(now);

        await tool.execute("run-1", {}, signal);
        await tool.execute("run-1", {}, signal);

        expect(now).toHaveBeenCalledTimes(2);
    });
});
