import EXPERIENCE from "../../config/experience.json" with { type: "json" };

/** How to explain things to a user of this experience level (config/experience.json), for the AI panel and outside agents. */
export function levelHint(level: string | undefined): string | undefined {
  return EXPERIENCE.levels.find((l) => l.id === level)?.agentHint;
}
