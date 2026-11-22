/**
 * KUYRUK 133: the texture editor's rectangle selection (move by dragging inside it, copy, cut, paste, delete), canvas
 * resize with an anchor, hue shift and desaturate, each one undo step; and the same through MCP edit_texture_region,
 * resize_texture_canvas and adjust_texture. LIGHT=1 also takes the light screenshot. Screenshots go to design/133/.
 */
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/133");
const PATH = "textures/item/selection.png";

async function cell(app: App, x: number, y: number, size = 16): Promise<[number, number]> {
  const r = await app.rect(".paintcanvas");
  const step = r.width / size;
  return [r.x + (x + 0.5) * step, r.y + (y + 0.5) * step];
}
const CTRL = 2;
type Mcp = Awaited<ReturnType<typeof connect>>;
const rows = async (mcp: Mcp, path = PATH) => (await mcp.call("read_texture", { path })).rows as string[];
/** Opaque pixels of the texture on disk as "x,y" strings. */
const opaque = async (mcp: Mcp, path = PATH) => {
  const out: string[] = [];
  (await rows(mcp, path)).forEach((row, y) => row.split(" ").forEach((c, x) => !c.endsWith("00") && out.push(`${x},${y}`)));
  return out;
};
const square = (x0: number, y0: number, n = 4) => Array.from({ length: n * n }, (_, i) => `${x0 + (i % n)},${y0 + Math.floor(i / n)}`).sort().join(" ");
const pixel = async (mcp: Mcp, x: number, y: number, path = PATH) => (await rows(mcp, path))[y].split(" ")[x];
const save = async (app: App) => {
  await app.key("s", CTRL);
  await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10000);
};

await run(async (app) => {
  const mcp = await connect(project);
  try {
    await app.click(".rtab", "Resources");
    await app.click(".abtn", "New texture");
    await app.click(".dialog input");
    await app.type("selection");
    await app.setValue(".dialog select", "item");
    await app.click(".dialog .abtn.primary");
    await app.waitFor(`document.querySelector(".paintcanvas")`);
    await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#b02e26").click()`);
    await app.click(".abtn", "Filled");
    await app.click(".abtn", "Rectangle");
    await app.drag(await cell(app, 1, 1), await cell(app, 4, 4));
    await save(app);
    assert((await opaque(mcp)).sort().join(" ") === square(1, 1), "a 4x4 square at 1,1");

    // Select it and drag it 8 right, 6 down.
    assert(await app.eval<boolean>(`[...document.querySelectorAll(".abtn")].find((b) => b.getAttribute("aria-label") === "Copy").disabled`), "Copy needs a selection");
    await app.click(".abtn", "Select");
    await app.drag(await cell(app, 1, 1), await cell(app, 4, 4));
    await app.drag(await cell(app, 2, 2), await cell(app, 10, 8), 6);
    await app.shot(`${OUT}/after-moved-dark.png`);
    const bar = await app.eval<number[]>(`[...document.querySelectorAll(".painter .actions .abtn")].map((b) => Math.round(b.getBoundingClientRect().top))`);
    assert(new Set(bar).size === 1, `the toolbar is one row: ${[...new Set(bar)]}`);
    await save(app);
    assert((await opaque(mcp)).sort().join(" ") === square(9, 7), `moved to 9,7: ${(await opaque(mcp)).join(" ")}`);

    // Copy, then paste at a one-pixel selection in the bottom left corner.
    await app.key("c", CTRL);
    await app.drag(await cell(app, 0, 12), await cell(app, 0, 12));
    await app.key("v", CTRL);
    await save(app);
    assert((await opaque(mcp)).sort().join(" ") === [square(9, 7), square(0, 12)].join(" ").split(" ").sort().join(" "), "pasted at 0,12");

    // Delete the pasted copy (it stays selected after the paste), then undo brings it back.
    await app.key("Delete");
    await save(app);
    assert((await opaque(mcp)).sort().join(" ") === square(9, 7), "pasted copy deleted");
    await app.key("z", CTRL);
    await save(app);
    assert((await opaque(mcp)).length === 32, "undo restores the deleted pixels");
    await app.key("z", CTRL);
    await save(app);
    assert((await opaque(mcp)).sort().join(" ") === square(9, 7), "undo takes back the paste");

    // Hue +120 turns the red green; desaturate makes it grey; both on every frame without a selection.
    await app.key("d", CTRL);
    await app.setValue(".paintform input[type=range][aria-label=Hue]", "120");
    await app.click(".abtn.applyhue");
    await save(app);
    const green = await pixel(mcp, 9, 7);
    assert(parseInt(green.slice(3, 5), 16) > parseInt(green.slice(1, 3), 16) * 2, `hue shifted to green: ${green}`);
    await app.click(".abtn.desaturate");
    await save(app);
    const grey = await pixel(mcp, 9, 7);
    assert(grey.slice(1, 3) === grey.slice(3, 5) && grey.slice(3, 5) === grey.slice(5, 7), `desaturated: ${grey}`);

    // Canvas 32 x 32 with the picture in the centre: the square moves 8 right and down, the size doubles, no scaling.
    await app.setField("Canvas size", "32");
    await app.setValue(".paintform input[aria-label='Canvas height']", "32");
    await app.setValue(".paintform select[aria-label='Keep the picture at']", "center");
    await app.click(".abtn.resizecanvas");
    await save(app);
    const big = await rows(mcp);
    assert(big.length === 32 && big[0].split(" ").length === 32, "canvas 32 x 32");
    assert((await opaque(mcp)).sort().join(" ") === square(17, 15), `picture kept in the centre: ${(await opaque(mcp)).join(" ")}`);
    await app.shot(`${OUT}/after-canvas-dark.png`);
    // Q274: Trim to drawing cuts the empty margins away: back to the 4 x 4 square, its pixels unchanged; one undo step.
    const colour = await pixel(mcp, 17, 15);
    await app.click(".abtn.trimcanvas");
    await save(app);
    const trimmed = await rows(mcp);
    assert(trimmed.length === 4 && trimmed[0].split(" ").length === 4, `trimmed to 4 x 4: ${trimmed.length} x ${trimmed[0].split(" ").length}`);
    assert((await opaque(mcp)).sort().join(" ") === square(0, 0) && (await pixel(mcp, 0, 0)) === colour, "the drawing kept, not scaled");
    await app.shot(evidence(`design/274/trimmed-dark.png`));
    await app.key("z", CTRL);
    await save(app);
    assert((await rows(mcp)).length === 32 && (await opaque(mcp)).sort().join(" ") === square(17, 15), "undo brings the margins back");
    if (process.env.LIGHT) {
      await app.setTheme("light");
      await app.click(".abtn", "Select");
      await app.drag(await cell(app, 17, 15, 32), await cell(app, 20, 18, 32));
      await app.sleep(300);
      await app.shot(`${OUT}/after-selection-light.png`);
      await app.setTheme("dark");
    }
    await app.key("z", CTRL);
    await save(app);
    assert((await rows(mcp)).length === 16, "undo takes back the canvas resize");

    // MCP: the same edits on another texture.
    await mcp.call("create_texture", { path: "textures/item/mcp_sel.png", width: 8, height: 8 });
    await mcp.call("write_texture_pixels", { path: "textures/item/mcp_sel.png", rects: [{ x: 0, y: 0, width: 2, height: 2, color: "#b02e26" }] });
    await mcp.call("edit_texture_region", { path: "textures/item/mcp_sel.png", action: "move", rect: { x: 0, y: 0, width: 2, height: 2 }, to: { x: 5, y: 5 } });
    assert((await opaque(mcp, "textures/item/mcp_sel.png")).sort().join(" ") === square(5, 5, 2), "mcp move");
    await mcp.call("edit_texture_region", { path: "textures/item/mcp_sel.png", action: "copy", rect: { x: 5, y: 5, width: 2, height: 2 }, to: { x: 0, y: 0 } });
    assert((await opaque(mcp, "textures/item/mcp_sel.png")).length === 8, "mcp copy");
    await mcp.call("edit_texture_region", { path: "textures/item/mcp_sel.png", action: "clear", rect: { x: 0, y: 0, width: 2, height: 2 } });
    await mcp.call("resize_texture_canvas", { path: "textures/item/mcp_sel.png", width: 16, height: 16, anchor: "top-left" });
    assert((await opaque(mcp, "textures/item/mcp_sel.png")).sort().join(" ") === square(5, 5, 2), "mcp canvas resize keeps pixels");
    await mcp.call("adjust_texture", { path: "textures/item/mcp_sel.png", desaturate: 1 });
    const g = await pixel(mcp, 5, 5, "textures/item/mcp_sel.png");
    assert(g.slice(1, 3) === g.slice(3, 5), `mcp desaturate ${g}`);
  } finally {
    await mcp.close();
  }
}, { project });
