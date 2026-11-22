/**
 * KUYRUK 194: an animated texture plays on the main canvas of the texture editor. Play shows the frames at the
 * frame time (and blends them with interpolate on), drawing is locked while it plays, Stop or Escape returns to the
 * frame being edited. Screenshots go to design/194/.
 *   npm run build:app && node tools/ui-test/texture-play.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { writePng } from "../../src/generator/png.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/194");
const RED = [200, 40, 40], BLUE = [40, 60, 200], GREEN = [0x5e, 0x7c, 0x16];

// A 16x16 animation of two frames, red then blue, 4 ticks (200 ms) each.
const strip = new Uint8Array(16 * 32 * 4);
for (let i = 0; i < 16 * 32; i++) strip.set([...(i < 256 ? RED : BLUE), 255], i * 4);
writeFileSync(join(project, "textures/pulse.png"), writePng({ width: 16, height: 32, data: strip }));
writeFileSync(join(project, "textures/pulse.png.mcmeta"), JSON.stringify({ animation: { frametime: 4 } }));

/** Colour [r, g, b] shown by the main canvas at texture pixel (x, y). */
const shown = (app: App, x: number, y: number) => app.eval<number[]>(`(() => {
  const c = document.querySelector(".paintcanvas"), z = c.width / 16;
  return [...c.getContext("2d").getImageData(${x} * z + z / 2, ${y} * z + z / 2, 1, 1).data].slice(0, 3);
})()`);
const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
/** Every distinct colour the canvas shows at (x, y) over `ms`. */
async function sample(app: App, x: number, y: number, ms: number): Promise<number[][]> {
  const seen: number[][] = [];
  for (const end = Date.now() + ms; Date.now() < end; await app.sleep(30)) {
    const c = await shown(app, x, y);
    if (!seen.some((s) => same(s, c))) seen.push(c);
  }
  return seen;
}
async function click(app: App, x: number, y: number) {
  const r = await app.rect(".paintcanvas"), step = r.width / 16;
  await app.mouse("mousePressed", r.x + (x + 0.5) * step, r.y + (y + 0.5) * step);
  await app.mouse("mouseReleased", r.x + (x + 0.5) * step, r.y + (y + 0.5) * step);
}
const playing = (app: App) => app.eval<boolean>(`!!document.querySelector(".playbadge") && document.querySelector(".paintcanvas").classList.contains("playing")`);
async function open(app: App) {

  await app.eval(`[...document.querySelectorAll(".rtab")].find((b) => /Resources|Kaynaklar/.test(b.textContent)).click()`);
  await app.waitFor(`[...document.querySelectorAll(".texcell")].some((c) => c.textContent.includes("pulse.png"))`, 10000);
  await app.click(".texcell", "pulse.png", { double: true });
  await app.waitFor(`document.querySelectorAll(".framecell").length === 2`);
}

await run(async (app) => {
  await open(app);
  // A green pencil, the frame being edited is frame 1 (red).
  await app.eval(`[...document.querySelectorAll(".sw")].find((b) => b.title === "#5e7c16").click()`);
  assert(same(await shown(app, 3, 3), RED), "editing shows frame 1");

  await app.click(".actions .abtn", "Play");
  await app.waitFor(`!!document.querySelector(".playbadge")`);
  const seen = await sample(app, 3, 3, 1200);
  assert(seen.some((c) => same(c, RED)) && seen.some((c) => same(c, BLUE)), `both frames play on the canvas, saw ${JSON.stringify(seen)}`);
  assert(seen.length === 2, `no blending with interpolate off, saw ${JSON.stringify(seen)}`);
  console.log(`playing without interpolate: ${JSON.stringify(seen)}`);

  // Read only while playing: a click, the eraser key, undo and frame buttons change nothing.
  await click(app, 3, 3);
  await app.key("e");
  await click(app, 4, 4);
  assert(await playing(app), "still playing after clicks");
  const locked = await app.eval<{ tools: boolean; undo: boolean; addFrame: boolean; frame: boolean; unsaved: boolean; pencil: boolean }>(`(() => ({
    tools: [...document.querySelectorAll(".ptools .abtn")].every((b) => b.disabled),
    undo: [...document.querySelectorAll(".actions .abtn")].find((b) => b.textContent.includes("Undo")).disabled,
    addFrame: [...document.querySelectorAll(".framebtns .abtn")].find((b) => b.textContent.includes("New frame")).disabled,
    frame: [...document.querySelectorAll(".framecell")].every((b) => b.disabled),
    unsaved: !!document.querySelector(".edname .unsaved"),
    pencil: [...document.querySelectorAll(".ptools .abtn")].find((b) => b.textContent.includes("Pencil")).classList.contains("pressed"),
  }))()`);
  assert(locked.tools && locked.undo && locked.addFrame && locked.frame, `editing controls disabled ${JSON.stringify(locked)}`);
  assert(!locked.unsaved && locked.pencil, `nothing drawn and the E key did not switch tools ${JSON.stringify(locked)}`);
  await app.shot(`${OUT}/playing-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/playing-light.png`);
  await app.setTheme("dark");

  // Stop returns to frame 1 as it was; drawing works again.
  await app.click(".actions .abtn", "Stop");
  assert(!(await playing(app)), "stopped");
  const after = await sample(app, 3, 3, 500);
  assert(after.length === 1 && same(after[0], RED), `stop shows the edited frame, saw ${JSON.stringify(after)}`);
  await click(app, 3, 3);
  assert(same(await shown(app, 3, 3), GREEN) && await app.eval<boolean>(`!!document.querySelector(".edname .unsaved")`), "drawing works after Stop");
  assert(same(await shown(app, 4, 4), RED), "the click while playing drew nothing");
  await app.shot(`${OUT}/stopped-dark.png`);

  // Interpolate blends between the frames; Escape stops.
  await app.setValue(".paintform input[aria-label='Frame time']", "10");
  await app.eval(`[...document.querySelectorAll(".paintform .frow")].find((r) => r.textContent.includes("Interpolate")).querySelector("input").click()`);
  await app.click(".actions .abtn", "Play");
  const blended = await sample(app, 8, 8, 1200);
  assert(blended.some((c) => !same(c, RED) && !same(c, BLUE)), `interpolate shows colours between the frames, saw ${blended.length} colours`);
  console.log(`playing with interpolate: ${blended.length} distinct colours`);
  await app.key("Escape");
  assert(!(await playing(app)), "Escape stops");
  assert(same(await shown(app, 3, 3), GREEN), "Escape returns to the edited frame");
}, { project });

// Turkish screenshot.
await run(async (app) => {
  await open(app);
  await app.click(".actions .abtn", "Oynat");
  await app.waitFor(`!!document.querySelector(".playbadge")`);
  await app.sleep(300);
  await app.shot(`${OUT}/playing-tr-dark.png`);
}, { project, language: "tr" });
