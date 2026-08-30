import type { SkillCatalog } from "../skills/Skill.js";
import type { Tool, ToolResult } from "./Tool.js";

export class LoadSkillTool implements Tool {
    public readonly spec = {
        name: "load_skill",
        description: "Loads the complete instruction for a named installed skill.",
        parameters: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
        },
    };

    public constructor(private readonly skills: SkillCatalog) {}

    public async execute(_runId: string, input: Record<string, unknown>, _signal: AbortSignal): Promise<ToolResult> {
        const name = typeof input.name === "string" ? input.name : "";
        const skill = this.skills.find(name);
        return skill
            ? { ok: true, output: skill.body }
            : { ok: false, error: { code: "unknown_skill", message: `Unknown skill: ${name}` } };
    }
}
