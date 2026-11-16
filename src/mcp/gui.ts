import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadProject, saveElement } from "../ir/storage.ts";
import { ANCHORS, OVERLAY_SIZE, overlayAnchor, overlayPositions, overlayScreen, RESOLUTIONS, scaleModeOf, fixedScaleOf } from "../elements/overlayLayout.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const widget = z.object({
  kind: z.enum(["label", "button", "image_button", "toggle_button", "text_field", "checkbox", "image", "state_image", "slot"]),
  name: z.string().regex(/^[a-z0-9_]*$/).optional().describe("Lang key part gui.<modid>.<gui>.<name>"),
  x: z.number().int(), y: z.number().int(),
  width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional(),
  text: z.string().optional().describe("label/button/checkbox text, text_field hint"),
  color: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional().describe("label colour"),
  procedure: z.string().optional().describe("button / image_button / toggle_button: procedure element id run on click (on the server)"),
  textProcedure: z.string().optional().describe("label: procedure returning the text; read every frame on the client, or computed by the server and synced when it has a server-side block"),
  condition: z.string().optional().describe("label, image, state_image, button, image_button, toggle_button: logic procedure; the widget shows while it is true"),
  checked: z.boolean().optional(),
  image: z.string().optional().describe("image: project PNG path; toggle_button: the off state; image_button: the normal state (with hoverImage), or without hoverImage (or with hoverImage the same file) the old layout, one PNG with the normal state above the hover state"),
  hoverImage: z.string().optional().describe("image_button: project PNG of the hover state; set it for new buttons (two files, like MCreator). toggle_button: off with the mouse over it"),
  onImage: z.string().optional().describe("toggle_button: project PNG of the on state (default: image)"),
  onHoverImage: z.string().optional().describe("toggle_button: project PNG of on with the mouse over it (default: onImage)"),
  stateProcedure: z.string().optional().describe("toggle_button: logic procedure read every frame on the client; the button is on (draws onImage / onHoverImage) while it is true. The click procedure usually flips what it reads. "
    + "state_image: number procedure read on the client that picks the state shown (see stateValue); without it the first state whose condition holds"),
  states: z.array(z.object({
    image: z.string().describe("project PNG; a vertical strip with a .mcmeta animation plays"),
    frame: z.number().int().min(0).optional().describe("only this square frame (from 0) of a vertical strip, still; leave out for the whole texture"),
    condition: z.string().optional().describe("logic procedure, used without stateProcedure: the first state whose condition is true is shown; a state without one always qualifies; none: nothing drawn"),
  }).strict()).min(1).optional().describe("state_image (KUYRUK 186): the pictures it switches between, drawn at width x height"),
  stateValue: z.enum(["index", "percent"]).optional().describe("state_image: what stateProcedure returns: the state's index from 0 (default; kept inside the list) or a percentage 0-100 spread evenly over the states (progress bars)"),
  updateTicks: z.number().int().min(0).max(1200).optional().describe("state_image: read the state once every N ticks (default 0: every frame)"),
  restartAnimation: z.boolean().optional().describe("state_image: an animated state starts from its first frame when it becomes the shown one (default: the game clock)"),
  animationStart: z.enum(["open", "always", "procedure"]).optional().describe("image in a GUI (Q229): when an animated image's animation starts: open (default, when the screen opens), always (the game clock) or procedure (the gui_image_restart block; the first frame until then). It plays in the texture's playback mode (set_texture_animation mode)"),
  previewState: z.number().int().min(0).optional().describe("state_image, editor only: the state the canvas shows"),
  id: z.number().int().min(0).optional().describe("slot index"), output: z.boolean().optional(), limit: z.string().optional().describe("slot: only this item"),
  locked: z.boolean().optional().describe("slot: no placing or taking"), lockCondition: z.string().optional().describe("slot: logic procedure, locked while it is true"),
  keepOnClose: z.boolean().optional().describe("slot: an unbound GUI does not give this item back when it closes (display slots)"),
  layer: z.string().optional().describe("editor layer name (see layers); none or unknown means the first layer"),
  editLocked: z.boolean().optional().describe("editor only: the canvas selects but does not move or resize this widget"),
  editHidden: z.boolean().optional().describe("editor only: not drawn on the canvas (a hidden group)"),
  group: z.string().min(1).optional().describe("editor only: named group; the editor selects, moves, aligns, locks, hides and copies a group as one. The generator ignores it"),
  invisible: z.boolean().optional().describe("button: draws nothing, only its area is clickable"),
  textScale: z.number().min(0.25).max(8).optional().describe("label, button: text size, 1 = the normal font; the generated screen scales the text around its position (a button: its centre)"),
  z: z.number().int().min(-99).max(99).optional().describe("image, state_image, label: drawing order, higher on top, list order among equal ones. Above 0 draws over slots, items and buttons; 0 (default) and below keeps the normal place: images under buttons and items, labels under items"),
  background: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional().describe("label: a box behind the text in this colour (\"\" none), as wide as the text and 8 pixels high plus the padding, scaled with the text"),
  backgroundOpacity: z.number().int().min(0).max(100).optional().describe("label: the background's opacity in percent (default 50)"),
  align: z.enum(["left", "center", "right"]).optional().describe("label: x is the text's left edge (default), centre or right edge; the generated screen measures the text every frame, so a changing text keeps that point"),
  backgroundPadding: z.number().int().min(0).max(8).optional().describe("label: pixels of background around the text (default 1)"),
  anchor: z.union([z.enum(ANCHORS), z.literal("")]).optional().describe("overlay label, image: the screen point the widget keeps its distance to when the screen is not 427x240 (its distance to the same canvas point); leave out (or \"\") to use the overlay's `anchor` field (default center)"),
}).strict();

/**
 * The GUI / overlay layout editor for agents. Positions are relative to the GUI's top left (overlays: a 427x240
 * canvas placed on the screen by anchors, src/elements/overlayLayout.ts); docs/ELEMENT-TYPES.md "GUI widgets" lists every key.
 */
export function registerGuiTools(server: McpServer, root: string, guard: Guard): void {
  const element = (type: "gui" | "overlay", id: string) => {
    const found = loadProject(root).elements[type]?.find((e) => e.id === id);
    if (!found) throw new Error(`no ${type} "${id}"`);
    return found;
  };
  server.registerTool(
    "read_gui_layout",
    {
      description: "Widgets of a GUI or overlay with the canvas size, the player inventory frames (GUIs with slots) and the grid settings; overlays also give their anchor, scale mode and fixed GUI scale (see overlay_layout).",
      inputSchema: { type: z.enum(["gui", "overlay"]).default("gui"), id: z.string() },
    },
    ({ type, id }) => guard(() => {
      const e = element(type, id);
      const width = type === "overlay" ? OVERLAY_SIZE.width : Number(e.width ?? 176), height = type === "overlay" ? OVERLAY_SIZE.height : Number(e.height ?? 166);
      const inventory = type === "gui" && Number(e.type) === 1
        ? { x: Math.floor((width - 176) / 2) + 7 + Number(e.inventoryOffsetX ?? 0), y: height - 83 + Number(e.inventoryOffsetY ?? 0), width: 162, height: 76 }
        : undefined;
      const screen = type === "overlay" ? { anchor: overlayAnchor(e), scaleMode: scaleModeOf(e), fixedScale: fixedScaleOf(e) } : {};
      return json({ type, id, width, height, ...screen, inventory, grid: { sx: e.gridSx, sy: e.gridSy, ox: e.gridOx, oy: e.gridOy }, layers: e.layers ?? [], widgets: e.components ?? [] });
    }),
  );
  server.registerTool(
    "write_gui_layout",
    {
      description: "Replace the widgets of a GUI or overlay. Overlays take labels, images and state images only. Slot indexes must be unique; images and procedures must exist. "
        + "Optional layers (bottom first) group widgets in the editor; widgets are saved sorted by layer, which is the order the screen draws them.",
      inputSchema: {
        type: z.enum(["gui", "overlay"]).default("gui"), id: z.string(), widgets: z.array(widget),
        layers: z.array(z.object({ name: z.string().min(1), hidden: z.boolean().optional(), locked: z.boolean().optional() }).strict()).optional()
          .describe("editor layers, bottom first; leave out to keep the current ones"),
      },
    },
    ({ type, id, widgets, layers }) => guard(() => {
      const e = element(type, id);
      const problems: string[] = [];
      const procedures = new Set((loadProject(root).elements.procedure ?? []).map((p) => p.id));
      const slots = new Set<number>();
      widgets.forEach((w, i) => {
        if (type === "overlay" && w.kind !== "label" && w.kind !== "image" && w.kind !== "state_image") problems.push(`${i}: overlays draw labels, images and state images only`);
        if (type === "gui" && w.anchor) problems.push(`${i}: anchor is for overlay widgets only`);
        if (w.kind !== "label" && (w.background || w.backgroundOpacity !== undefined || w.backgroundPadding !== undefined)) problems.push(`${i}: background is for labels only`);
        if (w.kind !== "label" && w.align) problems.push(`${i}: align is for labels only`);
        if ((w.kind === "image" || w.kind === "image_button") && (!w.image || !existsSync(join(root, w.image)))) problems.push(`${i}: image "${w.image ?? ""}" not in the project`);
        if (w.hoverImage && w.kind !== "image_button" && w.kind !== "toggle_button") problems.push(`${i}: hoverImage is for image_button and toggle_button only`);
        if ((w.onImage || w.onHoverImage) && w.kind !== "toggle_button") problems.push(`${i}: onImage and onHoverImage are for toggle_button only`);
        if (w.stateProcedure && w.kind !== "toggle_button" && w.kind !== "state_image") problems.push(`${i}: stateProcedure is for toggle_button and state_image only`);
        if ((w.states || w.stateValue || w.updateTicks !== undefined || w.restartAnimation !== undefined || w.previewState !== undefined) && w.kind !== "state_image") problems.push(`${i}: states, stateValue, updateTicks, restartAnimation and previewState are for state_image only`);
        if (w.animationStart && w.kind !== "image") problems.push(`${i}: animationStart is for image only`);
        if (w.kind === "state_image" && !w.states?.length) problems.push(`${i}: a state_image needs states`);
        (w.states ?? []).forEach((s, k) => {
          if (!existsSync(join(root, s.image))) problems.push(`${i}: state ${k} image "${s.image}" not in the project`);
          if (s.condition && !procedures.has(s.condition)) problems.push(`${i}: state ${k}: no procedure "${s.condition}"`);
        });
        if (w.kind === "toggle_button" && (!w.image || !existsSync(join(root, w.image)))) problems.push(`${i}: image "${w.image ?? ""}" not in the project`);
        for (const key of ["hoverImage", "onImage", "onHoverImage"] as const) if (w[key] && !existsSync(join(root, w[key]))) problems.push(`${i}: ${key} "${w[key]}" not in the project`);
        for (const key of ["procedure", "textProcedure", "condition", "lockCondition", "stateProcedure"] as const) if (w[key] && !procedures.has(w[key])) problems.push(`${i}: no procedure "${w[key]}"`);
        if (w.kind === "slot") {
          const slot = w.id ?? 0;
          if (slots.has(slot)) problems.push(`${i}: slot index ${slot} used twice`);
          slots.add(slot);
        }
      });
      const names = (layers ?? (Array.isArray(e.layers) ? e.layers as { name: string }[] : [])).map((l) => l.name);
      if (new Set(names).size !== names.length) problems.push("layer names must be unique");
      if (problems.length) throw new Error(problems.join("\n"));
      const rank = (w: { layer?: string }) => Math.max(0, names.indexOf(w.layer ?? ""));
      const ordered = widgets.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).map((x) => x.w);
      saveElement(root, type, { ...e, components: ordered, ...(layers ? { layers } : {}) });
      return json({ type, id, widgets: widgets.length });
    }),
  );
  server.registerTool(
    "overlay_layout",
    {
      description: "Where an overlay's widgets land on players' screens (KUYRUK 170), as the generated code places them: for each window size "
        + "and GUI scale setting, the GUI scale the game picks, the screen in canvas pixels, window pixels per canvas pixel, and each widget's "
        + "anchor and top left there (canvas pixels), flagged when it reaches past the screen. Change the overlay's anchor / scaleMode / "
        + "fixedScale with update_element and a widget's anchor with write_gui_layout.",
      inputSchema: {
        id: z.string(),
        screens: z.array(z.object({ width: z.number().int().min(320), height: z.number().int().min(240) }).strict()).optional()
          .describe(`window sizes in pixels; default ${RESOLUTIONS.map((r) => `${r.width}x${r.height}`).join(", ")}`),
        guiScale: z.number().int().min(0).max(8).default(0).describe("the player's GUI scale setting; 0 = auto"),
      },
    },
    ({ id, screens, guiScale }) => guard(() => {
      const e = element("overlay", id);
      const widgets = Array.isArray(e.components) ? e.components as { kind?: string; name?: string; width?: number; height?: number; text?: string }[] : [];
      const result = (screens ?? RESOLUTIONS).map(({ width, height }) => {
        const screen = overlayScreen(e, width, height, guiScale);
        const placed = overlayPositions(e, screen).map((p, index) => {
          const w = widgets[index] ?? {};
          // Labels: about 6 canvas pixels per character and 9 high; images their size (16 when unset).
          const size = w.kind === "label" ? { width: Math.max(6, [...(w.text ?? "")].length * 6), height: 9 } : { width: Number(w.width ?? 16), height: Number(w.height ?? 16) };
          // A centred or right-aligned label stands around its point (KUYRUK 183).
          if (w.kind === "label") p.x -= (w as { align?: string }).align === "center" ? Math.floor(size.width / 2) : (w as { align?: string }).align === "right" ? size.width : 0;
          const outside = p.x < 0 || p.y < 0 || p.x + size.width > screen.screenWidth || p.y + size.height > screen.screenHeight;
          return { index, kind: w.kind, name: w.name, ...p, ...size, ...(outside ? { outside: true } : {}) };
        });
        return { window: `${width}x${height}`, guiScale: screen.guiScale, screen: { width: screen.screenWidth, height: screen.screenHeight }, pixels: screen.pixels, widgets: placed };
      });
      return json({ id, canvas: OVERLAY_SIZE, anchor: overlayAnchor(e), scaleMode: scaleModeOf(e), fixedScale: fixedScaleOf(e), screens: result });
    }),
  );
}
