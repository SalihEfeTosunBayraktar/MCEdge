/**
 * Q272: the GUI design tools over MCP, on a copy of examples/hello. A sloppy machine GUI is checked (each mistake
 * found), fixed with arrange_gui_widgets and rebuilt as a clean layout with a panel texture made by
 * create_panel_texture; an overlay widget over the hotbar is reported. Previews go to tools/mcp-test/out/gui-design/.
 *   node tools/mcp-test/gui-design.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const out = join(import.meta.dirname, "out", "gui-design");
mkdirSync(out, { recursive: true });
const mcp = await connect(project);
const kinds = (r: { findings: { kind: string }[] }) => r.findings.map((f) => f.kind);
const shot = async (args: Record<string, unknown>, name: string) => {
  const info = await mcp.call("preview_gui", args);
  assert(mcp.lastImages.length === 1, `preview ${name}: ${JSON.stringify(info)}`);
  const png = Buffer.from(mcp.lastImages[0], "base64");
  writeFileSync(join(out, `${name}.png`), png);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};
try {
  for (const t of ["gui_design_guide", "preview_gui", "check_gui_layout", "arrange_gui_widgets", "create_panel_texture"]) assert(mcp.tools.includes(t), `tool ${t} is listed`);
  const guide = await mcp.call("gui_design_guide");
  assert(guide.workflow.length >= 5 && guide.topics.includes("slots") && guide.topics.includes("overlays"), `guide: ${guide.topics.join(", ")}`);
  assert((await mcp.call("gui_design_guide", { topic: "text" })).rules.some((r: string) => r.includes("#404040")), "text topic gives the label colour");

  await mcp.call("create_element", { type: "gui", id: "machine", values: { type: 1 } });
  const read = await mcp.call("read_gui_layout", { id: "machine" });
  assert(read.inventory?.y === 83, `GUI with the player inventory: ${JSON.stringify(read.inventory)}`);

  // Panel textures.
  const inset = await mcp.call("create_panel_texture", { path: "textures/screens/output_frame.png", width: 26, height: 26, style: "inset" });
  assert(inset.width === 26, "inset frame drawn");
  await mcp.call("create_panel_texture", { path: "textures/screens/arrow_track.png", width: 24, height: 10, style: "inset" });
  const again = await mcp.call("create_panel_texture", { path: "textures/screens/output_frame.png", width: 26, height: 26 }, true);
  assert(String(again).includes("overwrite"), "no silent overwrite");
  await mcp.call("create_panel_texture", { path: "textures/screens/dark_panel.png", width: 64, height: 32, style: "dark" });

  // A sloppy layout: every mistake the check should name.
  await mcp.call("write_gui_layout", { id: "machine", widgets: [
    { kind: "label", name: "title", x: 8, y: 6, text: "Ruby Press", color: "#c8c8c8" },
    { kind: "slot", id: 0, x: 40, y: 34 },
    { kind: "slot", id: 1, x: 60, y: 34 },
    { kind: "button", name: "press", x: 118, y: 34, width: 30, height: 20, text: "Press now" },
    { kind: "slot", id: 2, x: 10, y: 78 },
    { kind: "label", name: "hint", x: 9, y: 60, text: "Insert rubies" },
  ] });
  const before = await mcp.call("check_gui_layout", { id: "machine" });
  console.log("sloppy:", JSON.stringify(kinds(before)));
  for (const k of ["low_contrast", "slot_pitch", "text_too_wide", "overlaps_inventory", "almost_aligned"]) assert(kinds(before).includes(k), `check finds ${k}`);
  const big = await shot({ id: "machine", numbers: true }, "machine-before");
  assert(big.width === (176 + 16) * 3 && big.height === (166 + 16) * 3, `preview size ${big.width}x${big.height}`);

  // Arrange: dry run first, then align the labels, put the slots on the 18 px pitch, move the stray slot off the inventory.
  const dry = await mcp.call("arrange_gui_widgets", { id: "machine", dryRun: true, steps: [{ action: "align", widgets: ["title", "hint"], to: "left" }] });
  assert(dry.saved === false && (await mcp.call("read_gui_layout", { id: "machine" })).widgets[5].x === 9, "dry run saves nothing");
  const fixed = await mcp.call("arrange_gui_widgets", { id: "machine", steps: [
    { action: "align", widgets: ["title", "hint"], to: "left" },
    { action: "distribute", widgets: [1, 2], axis: "x", gap: 0 },
    { action: "move", widgets: [4], dx: 66, dy: -44 },
  ] });
  const after = (await mcp.call("read_gui_layout", { id: "machine" })).widgets;
  assert(after[5].x === 8 && after[2].x - after[1].x === 18 && after[4].x === 76 && after[4].y === 34, `arranged: ${JSON.stringify(fixed.widgets)}`);
  assert(!["slot_pitch", "overlaps_inventory", "almost_aligned", "overlap"].some((k) => kinds(fixed).includes(k)), `arranged findings: ${JSON.stringify(kinds(fixed))}`);
  const dup = await mcp.call("arrange_gui_widgets", { id: "machine", steps: [{ action: "slot_grid", x: 8, y: 20, rows: 1, columns: 2, firstId: 0 }] }, true);
  assert(String(dup).includes("used twice"), "slot_grid refuses a used index");

  // A clean design built with the tools: input row of 3 slots, an arrow, a framed output slot, a button and labels.
  await mcp.call("write_gui_layout", { id: "machine", widgets: [
    { kind: "label", name: "title", x: 8, y: 6, text: "Ruby Press" },
    { kind: "image", x: 105, y: 27, width: 26, height: 26, image: "textures/screens/output_frame.png" },
    { kind: "slot", id: 3, x: 109, y: 31 },
    { kind: "image", x: 74, y: 35, width: 24, height: 10, image: "textures/screens/arrow_track.png" },
    { kind: "button", name: "press", x: 138, y: 30, width: 30, height: 20, text: "Go" },
    { kind: "label", name: "hint", x: 8, y: 60, text: "Ruby + 2 coal" },
  ] });
  const grid = await mcp.call("arrange_gui_widgets", { id: "machine", steps: [
    { action: "slot_grid", x: 8, y: 31, rows: 1, columns: 3, firstId: 0 },
    { action: "align", widgets: [3, 1, 4], to: "center_y" },
  ] });
  console.log("clean design findings:", JSON.stringify(grid.findings));
  const clean = await mcp.call("check_gui_layout", { id: "machine" });
  assert(clean.clean === true, `clean design passes the check: ${JSON.stringify(clean.findings)}`);
  await shot({ id: "machine" }, "machine-after");
  await shot({ id: "machine", highlight: ["press"], numbers: true }, "machine-numbers");

  // Overlay: a label over the hotbar is reported.
  await mcp.call("create_element", { type: "overlay", id: "coins" });
  await mcp.call("write_gui_layout", { type: "overlay", id: "coins", widgets: [
    { kind: "label", x: 200, y: 225, text: "Coins: 12", color: "#ffd84a", background: "#000000" },
    { kind: "label", x: 6, y: 6, text: "Coins: 12", color: "#ffd84a", background: "#000000", anchor: "top_left" },
  ] });
  const hud = await mcp.call("check_gui_layout", { type: "overlay", id: "coins" });
  assert(kinds(hud).includes("under_hud") && hud.findings.find((f: { kind: string; widgets: number[] }) => f.kind === "under_hud").widgets.join() === "0", `HUD overlap: ${JSON.stringify(hud.findings)}`);
  const o = await shot({ type: "overlay", id: "coins" }, "overlay");
  assert(o.width === 427 * 2 && o.height === 240 * 2, `overlay preview ${o.width}x${o.height}`);
  console.log(`previews in ${out}`);
} finally {
  await mcp.close();
}
