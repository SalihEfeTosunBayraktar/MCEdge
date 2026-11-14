import type { BlockDef } from "../blockTypes.ts";
import { AI_BLOCKS } from "./ai.ts";
import { BASIC_BLOCKS } from "./basics.ts";
import { MINECRAFT_BLOCKS } from "./minecraft.ts";

/** Every procedure block, in toolbox order within each category. */
export const BLOCKS: readonly BlockDef[] = [...BASIC_BLOCKS, ...MINECRAFT_BLOCKS, ...AI_BLOCKS];

export const BLOCKS_BY_ID: ReadonlyMap<string, BlockDef> = new Map(BLOCKS.map((b) => [b.id, b]));
