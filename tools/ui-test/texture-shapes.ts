/**
 * KUYRUK #60: shape tools (line, rectangle, ellipse, polygon; outline and filled), mirrored drawing and flips in
 * the texture editor, and the same through MCP draw_texture_shapes / flip_texture. Screenshots go to
 * design/texture-editor/.
 */
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/texture-editor");
const PATH = "textures/item/shapes.png";

async function cell(app: App, x: number, y: number): Promise<[number, number]> {
  const r = await app.rect(".paintcanvas");
  const step = r.width / 16;
  return [r.x + (x + 0.5) * step, r.y + (y + 0.5) * step];
}
const press = async (app: App, x: number, y: number) => {
  const [px, py] = await cell(app, x, y);
  await app.mouse("mouseMoved", px, py, 0);
  await app.mouse("mousePressed", px, py);
  await app.mouse("mouseReleased", px, py);
};
/** Alpha of every pixel of the texture on disk, as rows of "#" (opaque) and "." (transparent). */
const mask = async (mcp: Awaited<ReturnType<typeof connect>>) =>
  ((await mcp.call("read_texture", { path: PATH })).rows as string[]).map((row) => row.split(" ").map((c) => (c.endsWith("00") ? "." : "#")).join(""));

await run(async (app) => {
  const mcp = await connect(project);
  try {
    await app.click(".rtab", "Resources");
    await app.click(".abtn", "New texture");
    await app.click(".dialog input");
    await app.type("shapes");
    await app.setValue(".dialog select", "item");
    await app.click(".dialog .abtn.primary");
    await app.waitFor(`document.querySelector(".paintcanvas")`);
    await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#b02e26").click()`);

    // Rectangle outline (1,1)-(5,4), filled ellipse (8,1)-(14,5), line (1,7)-(6,12).
    await app.click(".abtn", "Rectangle");
    await app.drag(await cell(app, 1, 1), await cell(app, 5, 4));
    await app.click(".abtn", "Filled");
    await app.click(".abtn", "Ellipse");
    await app.drag(await cell(app, 8, 1), await cell(app, 14, 5));
    await app.click(".abtn", "Filled");
    await app.click(".abtn", "Line");
    await app.drag(await cell(app, 1, 7), await cell(app, 6, 12));
    // Filled polygon (triangle) clicked out, closed with Enter.
    await app.click(".abtn", "Filled");
    await app.click(".abtn", "Polygon");
    await press(app, 9, 8);
    await press(app, 14, 13);
    await press(app, 9, 13);
    await app.shot(`${OUT}/shapes-polygon-open-dark.png`);
    await app.key("Enter");
    await app.click(".abtn", "Filled");
    // Mirrored pencil: a dot at (0,15) also lands at (15,15).
    await app.click(".abtn", "Mirror left-right");
    await app.click(".abtn", "Pencil");
    await press(app, 0, 15);
    await app.shot(`${OUT}/shapes-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/shapes-light.png`);
    await app.setTheme("dark");
    await app.key("s", 2);
    await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10000);

    let m = await mask(mcp);
    console.log(m.join("\n"));
    assert(m[1].slice(1, 6) === "#####" && m[2][1] === "#" && m[2][5] === "#" && m[2][3] === ".", "rectangle outline");
    assert(m[3][11] === "#" && m[1][11] === "#" && m[3][8] === "#", "filled ellipse");
    assert(m[7][1] === "#" && m[12][6] === "#" && m[9][6] === ".", "line");
    assert(m[12][10] === "#" && m[13][9] === "#" && m[13][14] === "#" && m[8][14] === ".", "filled polygon");
    assert(m[15][0] === "#" && m[15][15] === "#", "mirrored drawing");

    // Flip horizontally: the rectangle moves to the right side.
    await app.click(".abtn", "Flip horizontally");
    await app.key("s", 2);
    await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10000);
    m = await mask(mcp);
    assert(m[1].slice(10, 15) === "#####" && m[1][1] === ".", "flipped horizontally");

    // MCP: the same tools for agents.
    await mcp.call("create_texture", { path: "textures/item/mcp_shapes.png" });
    await mcp.call("draw_texture_shapes", {
      path: "textures/item/mcp_shapes.png",
      shapes: [{ type: "rect", points: [[0, 0], [3, 3]], filled: true, color: "#ff0000" }, { type: "ellipse", points: [[8, 8], [15, 15]], color: "#00ff00" }],
      mirror: { y: true },
    });
    await mcp.call("flip_texture", { path: "textures/item/mcp_shapes.png", axis: "vertical" });
    const rows = (await mcp.call("read_texture", { path: "textures/item/mcp_shapes.png" })).rows as string[];
    assert(rows[0].split(" ")[0] === "#ff0000ff" && rows[15].split(" ")[3] === "#ff0000ff", "MCP filled rect mirrored top-bottom, then flipped");
    assert(rows[5].split(" ")[0] === "#00000000" && rows.some((r) => r.includes("#00ff00ff")), "MCP ellipse outline");
  } finally {
    await mcp.close();
  }
}, { project });
