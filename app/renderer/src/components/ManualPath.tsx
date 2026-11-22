import { hidden } from "../experience.ts";
import { manualPath, type PathCall, type PathContext } from "../../../../src/live/manualPath.ts";
import { t } from "../strings.ts";
import { typeOf } from "../types.ts";

const context: PathContext = {
  t: (key) => t(key as Parameters<typeof t>[0]),
  typeName: (id) => typeOf(id)?.name,
  field: (typeId, key) => {
    for (const page of typeOf(typeId)?.pages ?? []) {
      for (const group of page.groups) {
        const field = group.fields.find((f) => f.key === key);
        if (field) return { label: field.label, page: page.title };
      }
    }
    return undefined;
  },
  hidden: (key) => (key.startsWith("section.") ? hidden("sections", key.slice(8)) : hidden("menu", key)),
};

/** How to do by hand what an AI action did (Q251): the menu / section / field path, from config/manual-paths.json. */
export function ManualPath({ call }: { call: PathCall }) {
  const path = manualPath(call, context);
  if (!path) return null;
  return <div className="manualpath" data-testid="manual-path"><span className="dim">{t("manual.label")}:</span> <code>{path}</code></div>;
}
