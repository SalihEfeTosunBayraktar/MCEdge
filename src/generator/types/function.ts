import type { Element } from "../../elements/model.ts";
import { str } from "../java.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";

/** Functions: the code as a .mcfunction file in the mod's or the minecraft namespace. */
function element(fn: Element, env: GenEnv): ElementContext {
  const ns = fn.namespace === "minecraft" ? "minecraft" : env.modId;
  const folder = env.mc === "1.16.5" ? "functions" : "function";
  const code = str(fn.code).replace(/\r\n/g, "\n");
  return { files: [{ path: `data/${ns}/${folder}/${str(fn.name) || fn.id}.mcfunction`, json: code.endsWith("\n") ? code : `${code}\n` }] };
}

export default { element } satisfies TypeModule;
