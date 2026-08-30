export type Skill = { name: string; description: string; body: string };

export interface SkillCatalog {
    all(): Skill[];
    find(name: string): Skill | undefined;
}
