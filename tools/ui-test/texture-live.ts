/**
 * KUYRUK #17: a PNG open in the texture editor changes through MCP. Without unsaved strokes the editor reloads (and
 * Undo brings the old pixels back); with a stroke in progress saving pauses, the conflict is marked, and the user
 * keeps their strokes or reloads. Resources previews follow too. Screenshots go to design/texture-editor/.
 */
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const project = exampleProject();
const PATH = "textures/ruby.png";
const OUT = "design/texture-editor";

/** [r,g,b,a] of a pixel of the editor's 1:1 preview canvas. */
const shown = (app: App, x: number, y: number) =>
  app.eval<number[]>(`[...document.querySelector(".edhead canvas").getContext("2d").getImageData(${x}, ${y}, 1, 1).data]`);
const cell = async (app: App, x: number, y: number): Promise<[number, number]> => {
  const r = await app.rect(".paintcanvas");
  const step = r.width / 16;
  return [r.x + (x + 0.5) * step, r.y + (y + 0.5) * step];
};

await run(async (app) => {
  const mcp = await connect(project);
  const disk = async (x: number, y: number) => (await mcp.call("read_texture", { path: PATH, x, y, width: 1, height: 1 })).rows[0] as string;
  try {
    await app.click(".rtab", "Resources");
    await app.click(".texcell", "ruby.png", { double: true });
    await app.waitFor(`document.querySelector(".paintcanvas")`);
    const before = await shown(app, 1, 1);

    // 1. No unsaved strokes: the agent's change shows up, Undo brings the old pixels back.
    await mcp.call("write_texture_pixels", { path: PATH, rects: [{ x: 0, y: 0, width: 4, height: 4, color: "#00ff00" }] });
    await app.waitFor(`document.querySelector(".livechip")`, 10000);
    assert((await shown(app, 1, 1)).join() === "0,255,0,255", "agent's pixels shown in the open editor");
    await app.shot(`${OUT}/live-reload-dark.png`);
    await app.key("z", 2);
    assert((await shown(app, 1, 1)).join() === before.join(), "Undo restores the pixels before the reload");
    await app.key("y", 2);
    await app.key("s", 2);
    await app.waitFor(`!document.querySelector(".edname .unsaved")`);
    assert((await disk(1, 1)) === "#00ff00ff", "redo and Save wrote the agent's version again");

    // 2. A stroke in progress when the agent writes: saving pauses and the conflict is marked.
    await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#3c44aa").click()`);
    const [x, y] = await cell(app, 10, 10);
    await app.mouse("mousePressed", x, y);
    await mcp.call("write_texture_pixels", { path: PATH, pixels: [{ x: 12, y: 12, color: "#ffff00" }] });
    await app.waitFor(`document.querySelector(".livechip.conflict")`, 10000);
    await app.mouse("mouseReleased", x, y);
    await app.sleep(1000);
    assert((await disk(10, 10)) !== "#3c44aaff" && (await disk(12, 12)) === "#ffff00ff", "while in conflict the disk keeps the agent's version");
    assert((await shown(app, 10, 10)).join() === "60,68,170,255", "the user's stroke stays in the editor");
    await app.shot(`${OUT}/live-conflict-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/live-conflict-light.png`);
    await app.setTheme("dark");
    await app.click(".abtn", "Keep my strokes");
    await app.waitFor(`!document.querySelector(".livechip.conflict")`);
    await app.sleep(800);
    assert((await disk(10, 10)) === "#3c44aaff", "Keep my strokes saves the user's version");

    // 3. Conflict again, this time Reload from disk takes the agent's version.
    await app.mouse("mousePressed", x, y + 20);
    await mcp.call("write_texture_pixels", { path: PATH, pixels: [{ x: 3, y: 14, color: "#ff00ff" }] });
    await app.waitFor(`document.querySelector(".livechip.conflict")`, 10000);
    await app.mouse("mouseReleased", x, y + 20);
    await app.click(".abtn", "Reload from disk");
    await app.waitFor(`!document.querySelector(".livechip.conflict")`);
    assert((await shown(app, 3, 14)).join() === "255,0,255,255", "Reload from disk shows the agent's pixel");

    // 4. Previews elsewhere follow outside changes. (Reload from disk left the editor clean, so Back does not ask.)
    await app.click(".abtn", "Back to resources");
    const src = await app.eval<string>(`[...document.querySelectorAll(".texcell")].find((c) => c.title === "${PATH}").querySelector("img").src`);
    await mcp.call("write_texture_pixels", { path: PATH, pixels: [{ x: 0, y: 15, color: "#123456" }] });
    await app.waitFor(`[...document.querySelectorAll(".texcell")].find((c) => c.title === "${PATH}").querySelector("img").src !== ${JSON.stringify(src)}`, 10000);
  } finally {
    await mcp.close();
  }
}, { project });
