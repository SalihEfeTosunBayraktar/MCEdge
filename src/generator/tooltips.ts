import type { Element } from "../elements/model.ts";
import { elementTriggers, triggerCode } from "../procedures/triggers.ts";
import { buildWarning, procedureBuild, procedureCallById } from "./procedures.ts";
import type { GenEnv } from "./typeModule.ts";

/**
 * A tooltip procedure on an item form that is not an item element (block items, plants, armor pieces): the item's
 * appendHoverText override, the same one items use (trigger item_tooltip). Each line of the returned text becomes a
 * tooltip line. Undefined when the field is empty or its procedure cannot be used (reported as a build warning).
 */
export function tooltipProcedureMember(env: GenEnv, typeId: string, element: Element, fieldKey: string): string | undefined {
  const id = element[fieldKey];
  if (typeof id !== "string" || !id) return undefined;
  const where = `${typeId}/${element.id}: ${fieldKey}`;
  const build = procedureBuild(env);
  const unit = build.scope.procedures.get(id);
  if (unit && unit.returnType !== "text") {
    buildWarning(env, `${where} needs procedure "${id}" to return text`);
    return undefined;
  }
  const trigger = elementTriggers(build.env.pkg).find((t) => t.id === "item_tooltip")!;
  const code = triggerCode(trigger.member, build.env.gen, build.env.loader);
  let missing = false;
  const member = code?.({
    call: (deps) => {
      const call = procedureCallById(env, id, deps, where);
      if (!call) missing = true;
      return call ?? "\"\"";
    },
    returns: "text",
  });
  return missing ? undefined : member;
}
