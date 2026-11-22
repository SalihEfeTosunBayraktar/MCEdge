import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readPng, writePng } from "../generator/png.ts";
import { loadProject, saveElement } from "../ir/storage.ts";
import { ROOT } from "../paths.ts";
import { arrange, check, layoutOf, panel, preview, type Arrange, type Pixels } from "../elements/guiDesign.ts";
import { textureStore } from "./textures.ts";

/**
 * GUI design tools for agents (Q272): a guide, a picture of a GUI or overlay without the app, a design check,
 * arranging widgets (slot grids, align, distribute, centre) and vanilla-style panel textures.
 */
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
const json = (value: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
/** Like the server's guard, for answers that may carry an image: a thrown error becomes an error result. */
async function guard(fn: () => Promise<Result> | Result): Promise<Result> {
  try {
    return await fn();
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

type Guide = { intro: string; topics: Record<string, string[]> };
let guide: Guide | undefined;
const loadGuide = () => (guide ??= JSON.parse(readFileSync(join(ROOT, "config", "gui-design-guide.json"), "utf8")) as Guide);

const TYPE = z.enum(["gui", "overlay"]).default("gui");
const REFS = z.array(z.union([z.number().int().min(0), z.string().min(1)])).min(1).describe("widget indexes (as read_gui_layout lists them) or names");

export function registerGuiDesignTools(server: McpServer, root: string): void {
  const element = (type: "gui" | "overlay", id: string) => {
    const found = loadProject(root).elements[type]?.find((e) => e.id === id);
    if (!found) throw new Error(`no ${type} "${id}"`);
    return found as Record<string, unknown> & { id: string };
  };
  const images = new Map<string, Pixels | undefined>();
  const loadImage = (path: string) => {
    if (!images.has(path)) images.set(path, existsSync(join(root, path)) ? readPng(readFileSync(join(root, path))) : undefined);
    return images.get(path);
  };
  const { save } = textureStore(root);

  server.registerTool(
    "gui_design_guide",
    {
      description: "How to design a good GUI or overlay with these tools: read it before laying one out. Without a topic it gives the workflow and the "
        + "topic list (layout, slots, text, buttons, colour, overlays, art).",
      inputSchema: { topic: z.string().optional() },
    },
    ({ topic }) => guard(() => {
      const g = loadGuide();
      if (!topic) return json({ intro: g.intro, workflow: g.topics.workflow, topics: Object.keys(g.topics) });
      const rules = g.topics[topic];
      if (!rules) throw new Error(`no topic "${topic}"; topics: ${Object.keys(g.topics).join(", ")}`);
      return json({ topic, rules });
    }),
  );

  server.registerTool(
    "preview_gui",
    {
      description: "Look at a GUI or overlay as a picture without the app: drawn in the generated screen's order (grey panel, slot frames, the player "
        + "inventory, images, buttons, text fields, checkboxes, labels; text in a pixel font with Minecraft's widths). Overlays show on 427x240 with "
        + "the game's hotbar, health and hunger area marked. numbers tags each widget with its index; highlight outlines widgets by index or name. "
        + "Use it after every layout change; editor_screenshot shows the app's own editor instead.",
      inputSchema: { type: TYPE, id: z.string(), scale: z.number().int().min(1).max(6).optional(), numbers: z.boolean().default(false), highlight: REFS.optional() },
    },
    ({ type, id, scale, numbers, highlight }) => guard(() => {
      const layout = layoutOf(type, element(type, id));
      const image = preview(layout, loadImage, { scale, numbers, highlight });
      return {
        content: [
          { type: "image", data: writePng(image).toString("base64"), mimeType: "image/png" },
          { type: "text", text: JSON.stringify({ type, id, width: layout.width, height: layout.height, widgets: layout.widgets.length, inventory: layout.inventory.length > 0 }) },
        ],
      };
    }),
  );

  server.registerTool(
    "check_gui_layout",
    {
      description: "Design review of a GUI or overlay: widgets outside the canvas, clickable widgets overlapping each other or the player inventory, "
        + "button text wider than the button, labels running into controls, edges 1-2 px apart (almost aligned), slots off the 18 px pitch, widgets "
        + "too close to the panel edge, labels hard to read on the panel, overlay widgets under the game's HUD. gui_design_guide explains the fixes.",
      inputSchema: { type: TYPE, id: z.string() },
    },
    ({ type, id }) => guard(() => {
      const findings = check(layoutOf(type, element(type, id)), loadImage);
      return json({ type, id, clean: findings.length === 0, findings });
    }),
  );

  const step = z.discriminatedUnion("action", [
    z.object({ action: z.literal("slot_grid"), x: z.number().int(), y: z.number().int(), rows: z.number().int().min(1).max(9), columns: z.number().int().min(1).max(9),
      firstId: z.number().int().min(0).optional().describe("first slot index; default after the highest used"), spacing: z.number().int().min(18).max(40).optional() }),
    z.object({ action: z.literal("align"), widgets: REFS, to: z.enum(["left", "right", "top", "bottom", "center_x", "center_y"]).describe("edges: to the outermost; centres: to the first widget's") }),
    z.object({ action: z.literal("distribute"), widgets: REFS, axis: z.enum(["x", "y"]), gap: z.number().int().min(0).optional().describe("fixed gap from the first widget; default: even spacing between the first and last") }),
    z.object({ action: z.literal("center"), widgets: REFS, axis: z.enum(["x", "y", "both"]).default("x").describe("centres the group's bounding box on the canvas") }),
    z.object({ action: z.literal("move"), widgets: REFS, dx: z.number().int().optional(), dy: z.number().int().optional() }),
  ]);
  server.registerTool(
    "arrange_gui_widgets",
    {
      description: "Arrange a GUI's or overlay's widgets in steps, applied in order and saved: slot_grid adds rows x columns of slots on the 18 px "
        + "pitch, align lines widgets up (left/right/top/bottom edges or centres), distribute spaces them evenly or by a gap, center centres a group "
        + "on the canvas, move shifts them. Widgets are picked by index or name. dryRun returns the result without saving.",
      inputSchema: { type: TYPE, id: z.string(), steps: z.array(step).min(1), dryRun: z.boolean().default(false) },
    },
    ({ type, id, steps, dryRun }) => guard(() => {
      const e = element(type, id);
      const layout = layoutOf(type, e);
      const widgets = arrange(layout, steps as Arrange[], loadImage);
      if (type === "overlay" && widgets.some((w) => w.kind === "slot")) throw new Error("overlays have no slots");
      const ids = widgets.filter((w) => w.kind === "slot").map((w) => Number(w.id ?? 0));
      if (new Set(ids).size !== ids.length) throw new Error("a slot index would be used twice; give slot_grid a free firstId");
      if (!dryRun) saveElement(root, type, { ...e, components: widgets } as never);
      const findings = check({ ...layout, widgets }, loadImage);
      return json({ type, id, saved: !dryRun, widgets: widgets.map((w, i) => ({ index: i, kind: w.kind, ...(w.name ? { name: w.name } : {}), x: w.x, y: w.y })), findings });
    }),
  );

  server.registerTool(
    "create_panel_texture",
    {
      description: "Draw a GUI panel PNG in the vanilla look at an exact size, for a GUI image or a background: vanilla (grey container panel, black "
        + "outline with cut corners, white and dark bevel), inset (a recessed box: progress bar track, text area, big output slot frame), dark (the same "
        + "panel in dark grey) or slot (one slot frame stretched). Refuses to overwrite unless overwrite is true; detail it with the pixel art tools.",
      inputSchema: {
        path: z.string().regex(/^textures\/[a-z0-9_./-]+\.png$/).describe("Project path, e.g. textures/screens/machine_bg.png"),
        width: z.number().int().min(4).max(512), height: z.number().int().min(4).max(512),
        style: z.enum(["vanilla", "inset", "dark", "slot"]).default("vanilla"), overwrite: z.boolean().default(false),
      },
    },
    ({ path, width, height, style, overwrite }) => guard(() => {
      if (existsSync(join(root, path)) && !overwrite) throw new Error(`${path} exists; pass overwrite: true to replace it`);
      save(path, panel(width, height, style));
      images.delete(path);
      return json({ path, width, height, style });
    }),
  );
}
