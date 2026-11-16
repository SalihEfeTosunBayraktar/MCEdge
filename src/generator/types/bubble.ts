import type { TypeModule } from "../typeModule.ts";

/**
 * Bubble elements (Q216) are data, not code: src/generator/bubbles.ts writes every bubble element (its images and an
 * entry of assets/<modid>/bubbles.json) and one renderer draws them all, so an element adds nothing of its own here.
 */
export default {
  element: () => ({}),
} satisfies TypeModule;
