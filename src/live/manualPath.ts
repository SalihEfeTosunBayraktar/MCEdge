import MANUAL from "../../config/manual-paths.json" with { type: "json" };

/** What the path needs from the app: its strings and the element types it has loaded. */
export interface PathContext {
  t: (key: string) => string;
  /** The element type's name, and for a field key its label and the title of the page it is on. */
  typeName: (typeId: string) => string | undefined;
  field: (typeId: string, key: string) => { label: string; page: string } | undefined;
  /** A UI string key Simple mode hides (config/experience.json). */
  hidden: (key: string) => boolean;
}

export interface PathCall {
  tool: string;
  /** "item/ruby", "textures/x.png", ... */
  target?: string;
  /** Top-level fields the call changed. */
  fields?: string[];
}

const RULES = MANUAL.rules.map((r) => ({ tools: new RegExp(r.tools), steps: r.steps }));

/**
 * The manual path to what an AI action did (Q251): the menu, section and field names the user clicks to make the same
 * change, from config/manual-paths.json. Undefined when the tool has no rule or the path would go through something
 * Simple mode hides.
 */
export function manualPath(call: PathCall, ctx: PathContext): string | undefined {
  const rule = RULES.find((r) => r.tools.test(call.tool));
  if (!rule) return undefined;
  const slash = call.target?.indexOf("/") ?? -1;
  const [typeId, id] = call.target && slash > 0 && !call.target.includes(".") ? [call.target.slice(0, slash), call.target.slice(slash + 1)] : [undefined, undefined];
  const fields = typeId ? (call.fields ?? []).flatMap((k) => ctx.field(typeId, k) ?? []) : [];
  const values: Record<string, string | undefined> = {
    type: typeId && (ctx.typeName(typeId) ?? typeId),
    id,
    path: call.target,
    page: fields[0]?.page,
    field: fields.length ? [...new Set(fields.map((f) => f.label))].join(", ") : undefined,
  };
  const steps: string[] = [];
  for (const step of rule.steps) {
    if (step.startsWith("@")) {
      if (ctx.hidden(step.slice(1))) return undefined;
      steps.push(ctx.t(step.slice(1)));
    } else {
      const value = values[step.slice(1, -1)];
      if (value) steps.push(value);
    }
  }
  return steps.join(MANUAL.separator);
}
