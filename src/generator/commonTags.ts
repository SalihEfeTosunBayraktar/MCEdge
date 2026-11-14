import commonTags from "../../config/common-tags.json" with { type: "json" };
import type { GenEnv } from "./typeModule.ts";

const VANILLA: Record<string, string> = commonTags.vanilla;
const MODERN: Record<string, string> = commonTags.modern;
/** A modern tag and the first Forge tag listed for it, for 1.16.5. */
const LEGACY = new Map<string, string>();
for (const [forge, modern] of Object.entries(MODERN)) if (!LEGACY.has(modern)) LEGACY.set(modern, forge);

/**
 * A tag id ("forge:crops", no "#") as the engine has it: a tag the project defines itself stays; a forge: name of a
 * vanilla tag is that tag everywhere; NeoForge and Fabric share c: tags, and on 1.16.5 a c: tag is its Forge tag.
 */
export function commonTag(env: Pick<GenEnv, "mc" | "ownTags">, id: string): string {
  if (env.ownTags?.has(id)) return id;
  if (VANILLA[id]) return VANILLA[id];
  const path = id.slice(id.indexOf(":") + 1);
  if (env.mc === "1.16.5") return LEGACY.get(id) ?? (id.startsWith("c:") ? `forge:${path}` : id);
  if (!id.startsWith("forge:")) return id;
  return MODERN[id] ?? `c:${path}`;
}
