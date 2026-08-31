import { describe, expect, it } from "vitest";

import { SkillSystemPromptProvider } from "../src/skills/SkillSystemPromptProvider.js";

const catalogWith = (body: string, description = "Current weather from the public wttr.in service.") => ({
    all: () => [{ body, description, name: "weather" }],
    find: () => undefined,
});

describe("SkillSystemPromptProvider", () => {
    // Прогрессивное раскрытие: в системный промпт попадает только summary skill'а,
    // тело инструкции модель обязана получить через load_skill.
    it("lists skill summaries without embedding their bodies", () => {
        const body = 'Используй exec: curl -fsSL "https://wttr.in/{город}?format=1".';

        const prompt = new SkillSystemPromptProvider(catalogWith(body)).build(0);

        expect(prompt).toContain("- weather: Current weather from the public wttr.in service.");
        expect(prompt).not.toContain(body);
    });

    // Порядок вызовов: load_skill идёт отдельным шагом, exec — только командой из инструкции.
    it("requires load_skill alone first and exec with the command from the instruction", () => {
        const prompt = new SkillSystemPromptProvider(catalogWith("body")).build(0);

        expect(prompt).toContain("call load_skill with that skill name");
        expect(prompt).toContain("Call nothing else in that same step");
        expect(prompt).toContain("call exec with exactly the command from that instruction");
    });

    // Регрессия на разрыв A: прежняя формулировка «если инструмент вернул ошибку — сообщи
    // о невозможности» заставляла модель сдаваться, ещё не выполнив команду skill'а.
    it("forbids reporting failure before the skill command has been executed", () => {
        const prompt = new SkillSystemPromptProvider(catalogWith("body")).build(0);

        expect(prompt).toContain("Until the instruction command has actually run through exec");
        expect(prompt).toContain("If exec returns an error");
        expect(prompt).toContain("fix it and call");
        expect(prompt).toContain("Never invent an answer in either case");
    });

    // Разрыв B: замеры показали, что модель выписывает вызов инструмента текстом.
    // Негативное правило должно быть в промпте явно.
    it("forbids writing a tool call as message text", () => {
        const prompt = new SkillSystemPromptProvider(catalogWith("body")).build(0);

        expect(prompt).toContain("Never describe, announce or write out a command as message text");
        expect(prompt).toContain("to use a tool you must emit a tool call");
        expect(prompt).toContain("JSON that imitates a tool call");
    });

    // Регрессия на живой отказ: «Сегодня в Стамбуле +27°C. Теперь давайте посмотрим, сколько
    // времени сейчас.» — модель объявила следующий шаг вместо вызова, и прогон на этом кончился.
    // Правило протокола (текст без вызова завершает прогон) модель знать не может — говорим прямо.
    it("states that a message without a tool call ends the run", () => {
        const prompt = new SkillSystemPromptProvider(catalogWith("body")).build(0);

        expect(prompt).toContain("A message with no tool call ends the run");
        expect(prompt).toContain("never announce a tool call, a next step or what you are about to check");
        expect(prompt).toContain("gather the data for every part before writing the answer");
    });

    // Промпт английский, но пользователь пишет по-русски — язык ответа задаётся явно,
    // иначе модель отвечает на языке промпта.
    it("pins the answer language to the language of the user", () => {
        const prompt = new SkillSystemPromptProvider(catalogWith("body")).build(0);

        expect(prompt).toContain("in the same language the user used");
    });

    // Регрессия на живой отказ: имея 13:10:41Z, модель сама пересчитала его в «17:10 (UTC+3)»
    // вместо 16:10 и показала пользователю сырую ISO-метку. Пересчёт запрещён явно.
    it("routes date and time questions to the tool instead of the model", () => {
        const prompt = new SkillSystemPromptProvider(catalogWith("body")).build(0);

        expect(prompt).toContain("call\ncurrent_datetime");
        expect(prompt).toContain("never convert time zones or compute dates yourself");
        expect(prompt).toContain("never show the user a raw ISO timestamp");
    });

    // Без даты модель не может ответить на «какая погода сегодня» — время берётся из Clock.
    it("includes the current date passed by the clock", () => {
        const prompt = new SkillSystemPromptProvider(catalogWith("body")).build(Date.UTC(2026, 7, 31, 12, 30));

        expect(prompt).toContain("Current date and time: 2026-08-31T12:30:00.000Z (UTC).");
    });

    // Пустой каталог не должен ломать промпт молчаливо — модель должна видеть, что skills нет.
    it("states explicitly that no skills are installed", () => {
        const prompt = new SkillSystemPromptProvider({ all: () => [], find: () => undefined }).build(0);

        expect(prompt).toContain("- no skills installed");
    });
});
