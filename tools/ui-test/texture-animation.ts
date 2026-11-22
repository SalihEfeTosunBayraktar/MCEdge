/**
 * KUYRUK #62: animated textures. Creates one in the texture editor (frames, frame time, interpolate, playing
 * preview), saves the PNG strip with its .mcmeta, undoes a frame change, reopens it, makes it still again; imports
 * a PNG with its .mcmeta from Resources; MCP list_textures / set_texture_animation / import_texture.
 * Screenshots go to design/texture-editor/.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPng } from "../../src/generator/png.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/texture-editor");
const PATH = "textures/block/glow.png";

async function cell(app: App, x: number, y: number): Promise<[number, number]> {
  const r = await app.rect(".paintcanvas");
  const step = r.width / 16;
  return [r.x + (x + 0.5) * step, r.y + (y + 0.5) * step];
}
const press = async (app: App, x: number, y: number) => {
  const [px, py] = await cell(app, x, y);
  await app.mouse("mousePressed", px, py);
  await app.mouse("mouseReleased", px, py);
};
const frames = (app: App) => app.eval<number>(`document.querySelectorAll(".framecell").length`);
const save = async (app: App) => {
  await app.key("s", 2);
  await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10000);
};
const png = (path: string) => readPng(readFileSync(join(project, path)));
const pixel = (path: string, x: number, y: number) => {
  const img = png(path);
  return [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
};

await run(async (app) => {
  const mcp = await connect(project);
  try {
    // New texture, animated with 2 frames.
    await app.click(".rtab", "Resources");
    await app.click(".abtn", "New texture");
    await app.click(".dialog input");
    await app.type("glow");
    await app.setValue(".dialog select", "block");
    await app.eval(`(() => { const s = [...document.querySelectorAll(".dialog select")].find((s) => [...s.options].some((o) => o.textContent.includes("frames"))); s.id = "framesel"; })()`);
    await app.setValue("#framesel", "2");
    await app.click(".dialog .abtn.primary");
    await app.waitFor(`document.querySelectorAll(".framecell").length === 2`);

    // Frame 1: red dot; frame 2: blue dot; then a new empty frame 3.
    await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#b02e26").click()`);
    await press(app, 0, 0);
    await app.click(".framecell", "2");
    await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#3c44aa").click()`);
    await press(app, 1, 1);
    await app.click(".abtn", "New frame");
    assert(await frames(app) === 3, "three frames");
    await app.key("z", 2);
    assert(await frames(app) === 2, "undo removes the new frame");
    await app.key("y", 2);
    assert(await frames(app) === 3, "redo brings it back");
    await app.setValue(".paintform input[aria-label='Frame time']", "5");
    await app.eval(`(() => { const c = [...document.querySelectorAll(".paintform .frow")].find((r) => r.textContent.includes("Interpolate")).querySelector("input"); c.click(); })()`);
    await app.click(".abtn", "Play");
    await app.waitFor(`document.querySelector(".playbadge")`);
    await app.sleep(400);
    await app.shot(`${OUT}/animation-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/animation-light.png`);
    await app.setTheme("dark");
    await app.click(".abtn", "Stop");
    await save(app);

    let img = png(PATH);
    assert(img.width === 16 && img.height === 48, `strip of 3 frames, got ${img.width}x${img.height}`);
    assert(pixel(PATH, 0, 0)[0] === 0xb0 && pixel(PATH, 1, 17)[2] === 0xaa && pixel(PATH, 1, 33)[3] === 0, "frames in order, the new one empty");
    const meta = JSON.parse(readFileSync(join(project, `${PATH}.mcmeta`), "utf8"));
    assert(meta.animation.frametime === 5 && meta.animation.interpolate === true, `mcmeta ${JSON.stringify(meta)}`);

    // MCP sees it; reopening shows the frames.
    const listed = (await mcp.call("list_textures")).find((t: { path: string }) => t.path === PATH);
    assert(listed.animation?.frames === 3 && listed.animation.frametime === 5, `list_textures ${JSON.stringify(listed)}`);
    await app.click(".abtn", "Back to resources");
    await app.click(".texcell", "glow.png", { double: true });
    await app.waitFor(`document.querySelectorAll(".framecell").length === 3`);

    // Make still: the .mcmeta goes and one 16x16 frame stays.
    await app.click(".abtn", "Make still");
    await save(app);
    img = png(PATH);
    assert(img.height === 16 && !existsSync(join(project, `${PATH}.mcmeta`)), "still again, .mcmeta removed");
    await app.click(".abtn", "Back to resources");

    // Import a PNG strip with its .mcmeta from Resources.
    await app.click(".abtn", "Import");
    await app.click(".menulist button", "Animated texture");
    await app.waitFor(`document.querySelector(".dialog input[type=file]")`);
    await app.eval(`(async () => {
      const c = document.createElement("canvas"); c.width = 16; c.height = 32;
      const g = c.getContext("2d"); g.fillStyle = "#f9801d"; g.fillRect(0, 0, 16, 16); g.fillStyle = "#fed83d"; g.fillRect(0, 16, 16, 16);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "Fire Anim.png", { type: "image/png" }));
      dt.items.add(new File([JSON.stringify({ animation: { frametime: 2 } })], "Fire Anim.png.mcmeta"));
      const input = document.querySelector(".dialog input[type=file]");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await app.waitFor(`document.querySelector(".importlist")?.textContent.includes("2 frames")`);
    await app.shot(`${OUT}/import-animated-dark.png`);
    await app.click(".dialog .abtn.primary");
    await app.waitFor(`!document.querySelector(".dialog")`);
    assert(existsSync(join(project, "textures/block/fire_anim.png")) && existsSync(join(project, "textures/block/fire_anim.png.mcmeta")), "PNG and .mcmeta imported");
    await app.waitFor(`[...document.querySelectorAll(".texcell")].some((c) => c.title === "textures/block/fire_anim.png")`);

    // MCP: change the animation, import with .mcmeta from a file outside the project.
    await mcp.call("set_texture_animation", { path: "textures/block/fire_anim.png", frametime: 3, interpolate: true, frames: [1, 0] });
    const changed = JSON.parse(readFileSync(join(project, "textures/block/fire_anim.png.mcmeta"), "utf8")).animation;
    assert(changed.frametime === 3 && changed.interpolate === true && changed.frames.join() === "1,0", `set_texture_animation ${JSON.stringify(changed)}`);
    const outside = mkdtempSync(join(tmpdir(), "mcedge-anim-"));
    copyFileSync(join(project, "textures/block/fire_anim.png"), join(outside, "lava.png"));
    copyFileSync(join(project, "textures/block/fire_anim.png.mcmeta"), join(outside, "lava.png.mcmeta"));
    const imported = await mcp.call("import_texture", { file: join(outside, "lava.png"), to: "textures/block/lava.png" });
    assert(imported.animation?.frames === 2, `import_texture ${JSON.stringify(imported)}`);
    const refused = await mcp.call("import_texture", { file: join(outside, "lava.png"), to: "textures/block/lava.png" }, true);
    assert(String(refused).includes("exists"), "import_texture does not replace silently");
  } finally {
    await mcp.close();
  }
}, { project });
