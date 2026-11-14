import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadProject } from "../ir/storage.ts";
import { loadTags, qualifyTagRef, saveTags, TAG_TYPES, validateTags } from "../tags/tags.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** The Element tags section for agents: tag lists in tags.json, generated as data/<ns>/tags/... on every engine. */
export function registerTagTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool("list_tags", {
    description: "Element tags: type (item, block, entity_type, fluid, biome, function, damage_type, enchantment, game_event), id and entries.",
  }, () => guard(() => json(loadTags(root))));
  server.registerTool(
    "set_tag",
    {
      description: "Create or replace a tag. A <modid>:... id defines a tag of this mod; another namespace (minecraft:logs, c:gems) adds the entries "
        + "to that tag. Entries: a mod element id (ruby), a vanilla id (minecraft:diamond) or #ns:tag. 1.16.5 has only item, block, entity_type, "
        + "fluid and function tags. Returns the tag's problems.",
      inputSchema: { type: z.enum(TAG_TYPES), id: z.string(), entries: z.array(z.string()) },
    },
    ({ type, id, entries }) => guard(() => {
      const project = loadProject(root);
      const full = qualifyTagRef(project.mod.id, id);
      const tags = loadTags(root).filter((t) => !(t.type === type && qualifyTagRef(project.mod.id, t.id) === full));
      const tag = { type, id: full, entries };
      saveTags(root, [...tags, tag]);
      const all = loadTags(root);
      const index = all.findIndex((t) => t.type === type && t.id === full);
      return json({ tag, issues: validateTags(all, project).filter((i) => i.path.startsWith(`tags[${index}]`)) });
    }),
  );
  server.registerTool(
    "delete_tag",
    { description: "Delete a tag.", inputSchema: { type: z.enum(TAG_TYPES), id: z.string() } },
    ({ type, id }) => guard(() => {
      const modId = loadProject(root).mod.id;
      const full = qualifyTagRef(modId, id);
      const tags = loadTags(root);
      const rest = tags.filter((t) => !(t.type === type && qualifyTagRef(modId, t.id) === full));
      if (rest.length === tags.length) throw new Error(`no ${type} tag ${full}`);
      saveTags(root, rest);
      return json({ deleted: `${type} ${full}` });
    }),
  );
}
