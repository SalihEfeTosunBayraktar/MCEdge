import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findAllReferences, referencesOf, REFERENCE_DRIVEN_TYPES, sourceLabel, unusedElements, type Reference } from "../ir/references.ts";
import { elementKey } from "../ir/folders.ts";
import { loadReferenceInput } from "../ir/referenceInput.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** One line per source and form: where inside the source the places are. */
function grouped(refs: Reference[], side: "from" | "to", limit: number) {
  const groups = new Map<string, { element: string; form: string; places: string[]; ambiguous?: boolean }>();
  for (const r of refs) {
    const element = side === "from" ? sourceLabel(r.from) : `${r.to.type}/${r.to.id}`;
    const key = `${element}|${r.form}`;
    const group = groups.get(key) ?? { element, form: r.form, places: [], ...(r.ambiguous ? { ambiguous: true } : {}) };
    group.places.push(r.path);
    groups.set(key, group);
  }
  const all = [...groups.values()];
  return { total: refs.length, sources: all.length, shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/**
 * Find references: who uses an element, what it uses, and which procedures and GUIs nothing uses (src/ir/references.ts).
 * The app's Usages and Unused buttons use the same functions.
 */
export function registerReferenceTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool(
    "find_references",
    {
      description: "Where an element is used and what it uses. `usedBy` lists the elements, tags and datapack files that name it; `uses` lists the elements it names. "
        + "Forms: procedure_field, element_field, registry_field (also recipe slots), program_procedure (call_procedure and other procedure block fields), program_id (gui_open and other "
        + "block id fields), java_code (generated class names and quoted ids in java_code blocks), namespaced_id (any \"modid:id\" string), tag_entry, datapack_file. "
        + "Each group gives the source, the form and the places inside it (\"program.stacks[0].blocks[2].fields.procedure\").",
      inputSchema: { type: z.string(), id: z.string(), limit: z.number().int().min(1).max(500).default(50).describe("Groups shown per direction") },
    },
    ({ type, id, limit }) => guard(() => {
      const input = loadReferenceInput(root);
      const element = input.elements[type]?.find((e) => e.id === id);
      if (!element) throw new Error(`no ${type} "${id}"`);
      const report = referencesOf(findAllReferences(input), { type, id });
      const triggered = type === "procedure" && String(element.globalTrigger ?? "no_ext_trigger") !== "no_ext_trigger";
      return json({
        element: `${type}/${id}`,
        folder: input.project.folders?.placement[elementKey(type, id)] ?? "",
        ...(type === "procedure" ? { globalTrigger: String(element.globalTrigger ?? "no_ext_trigger") } : {}),
        unused: !report.usedBy.length && !triggered && REFERENCE_DRIVEN_TYPES.includes(type),
        usedBy: grouped(report.usedBy, "from", limit),
        uses: grouped(report.uses, "to", limit),
      });
    }),
  );
  server.registerTool(
    "unused_elements",
    {
      description: "Elements nothing uses: no other element, tag or datapack file names them and (procedures) no global trigger runs them. "
        + "Default types are procedure and gui, which do nothing until something points at them; blocks, items and the like are entry points in the game, "
        + "so other types are listed only when asked for by `types` and mean only \"no reference\". Nothing is deleted. "
        + "`transitive` also lists elements used only by unused ones (flagged reachableOnlyFromUnused).",
      inputSchema: {
        types: z.array(z.string()).optional().describe("Element type ids; default procedure and gui"),
        transitive: z.boolean().default(false),
        limit: z.number().int().min(1).max(2000).default(200), offset: z.number().int().min(0).default(0),
      },
    },
    ({ types, transitive, limit, offset }) => guard(() => {
      const input = loadReferenceInput(root);
      const wanted = types?.length ? types : REFERENCE_DRIVEN_TYPES;
      const unknown = wanted.filter((t) => !input.types.has(t));
      if (unknown.length) throw new Error(`unknown element type ${unknown.join(", ")}; see list_element_types`);
      const report = unusedElements(input, findAllReferences(input), wanted, transitive);
      const placement = input.project.folders?.placement ?? {};
      const page = report.unused.slice(offset, offset + limit).map((u) => ({ ...u, folder: placement[elementKey(u.type, u.id)] ?? "" }));
      return json({ summary: report.summary, total: report.unused.length, offset, unused: page });
    }),
  );
}
