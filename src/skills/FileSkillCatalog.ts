import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Skill, SkillCatalog } from "./Skill.js";

export class FileSkillCatalog implements SkillCatalog {
    private readonly skills: Skill[];

    public constructor(directory: string) {
        this.skills = readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => parseSkill(readFileSync(join(directory, entry.name, "SKILL.md"), "utf8"), entry.name));
    }

    public all(): Skill[] {
        return [...this.skills];
    }

    public find(name: string): Skill | undefined {
        return this.skills.find((skill) => skill.name === name);
    }
}

function parseSkill(source: string, fallbackName: string): Skill {
    const [header, ...bodyLines] = source.replace(/^---\r?\n/, "").split(/\r?\n---\r?\n/);
    const fields = Object.fromEntries(
        header.split(/\r?\n/).flatMap((line) => {
            const [key, ...value] = line.split(":");
            return key && value.length ? [[key.trim(), value.join(":").trim()]] : [];
        }),
    );
    return {
        body: bodyLines.join("\n---\n").trim() || source.trim(),
        description: fields.description ?? fallbackName,
        name: fields.name ?? fallbackName,
    };
}
