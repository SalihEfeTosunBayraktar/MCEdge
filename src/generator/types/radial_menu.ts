import type { Element } from "../../elements/model.ts";
import { radialLang } from "../radial.ts";
import type { GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Radial menus (Q227) are data, not code: src/generator/radial.ts writes every menu (its images and an entry of
 * assets/<modid>/radial_menus.json) and one runtime opens and draws them all, so a menu adds only its texts here.
 */
export default {
  element: (menu: Element, env: GenEnv) => ({ lang: radialLang(menu, env.modId) }),
} satisfies TypeModule;
