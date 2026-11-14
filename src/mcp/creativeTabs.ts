import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveTabOrder, tabMembers, type TabEntry } from "../elements/tabOrder.ts";
import { loadProject, saveElement } from "../ir/storage.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const entry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("element"), type: z.string().describe("Element type id: item, block, armor, ..."), id: z.string() }).strict(),
  z.object({ kind: z.literal("section"), title: z.string() }).strict(),
  z.object({ kind: z.literal("spacer"), slots: z.number().int().min(0).max(8).optional().describe("Empty slots; none or 0: to the end of the row") }).strict(),
  z.object({ kind: z.literal("end") }).strict().describe("Ends the open section: the rows after it stand outside sections up to the next section (without one, rows after the last section belong to it)"),
]);

/** Creative tab order for agents (KUYRUK 98): the same `order` field the tab editor writes (src/elements/tabOrder.ts). */
export function registerCreativeTabTools(server: McpServer, root: string, guard: Guard): void {
  const tabOf = (id: string) => {
    const project = loadProject(root);
    const tab = project.elements.creative_tab?.find((e) => e.id === id);
    if (!tab) throw new Error(`no creative_tab "${id}"`);
    return { project, tab, members: tabMembers(project.elements, id) };
  };
  server.registerTool("read_tab_order", {
    description: "A mod creative tab's contents in the order the tab shows them: elements (type, id) whose creativeTabs name the tab, titled "
      + "sections, section ends ({ kind: \"end\" }: the rows after it are outside sections) and spacers. Elements not ordered yet come last. "
      + "Sections and section ends start a new row and spacers leave empty slots on 1.16.5 only; from 1.20 only the order shows.",
    inputSchema: { tab: z.string().describe("creative_tab element id") },
  }, ({ tab }) => guard(() => {
    const { tab: element, members } = tabOf(tab);
    return json({ tab, order: resolveTabOrder(element.order, members) });
  }));
  server.registerTool("write_tab_order", {
    description: "Set a mod creative tab's order. Elements must be in the tab (their creativeTabs name it); members left out are appended at the "
      + "end. Add an element to the tab with update_element (creativeTabs) first. A section end with no open section is dropped. Returns the resulting order.",
    inputSchema: { tab: z.string().describe("creative_tab element id"), order: z.array(entry) },
  }, ({ tab, order }) => guard(() => {
    const { tab: element, members } = tabOf(tab);
    const known = new Set(members.map((m) => `${m.type}/${m.id}`));
    const seen = new Set<string>();
    const problems: string[] = [];
    order.forEach((e, i) => {
      if (e.kind !== "element") return;
      const key = `${e.type}/${e.id}`;
      if (!known.has(key)) problems.push(`${i}: ${key} is not in tab "${tab}" (its creativeTabs do not name it)`);
      if (seen.has(key)) problems.push(`${i}: ${key} listed twice`);
      seen.add(key);
    });
    if (problems.length) throw new Error(problems.join("\n"));
    const resolved: TabEntry[] = resolveTabOrder(order, members);
    saveElement(root, "creative_tab", { ...element, order: resolved });
    return json({ tab, order: resolved });
  }));
}
