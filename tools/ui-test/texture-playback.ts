/**
 * Q229: playback modes of animated textures. First the shared model (src/resources/textureAnimation.ts): ping-pong
 * reverses, the once modes hold their frame, the generated vanilla .mcmeta plays the mode with a frame list. Then the
 * texture editor: the Playback picker plays the chosen mode on the main canvas (ping-pong goes back, hold last stops on
 * the last frame, hold first returns to the first) and Save keeps it in the .mcmeta's "mcedge" section; a GUI image
 * shows its texture's mode and its Animation start. Screenshots go to design/229/ (dark, light, Turkish).
 *   npm run build:app && node tools/ui-test/texture-playback.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writePng } from "../../src/generator/png.ts";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { showInApp } from "../../src/live/show.ts";
import { animationSchedule, frameAt, HOLD_TICKS, vanillaMcmeta } from "../../src/resources/textureAnimation.ts";
import { widgetSchedule } from "../../src/resources/widgetAnimation.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/229");

// ---- the model
const meta = (mode?: string) => JSON.stringify({ animation: { frametime: 2 }, ...(mode ? { mcedge: { playback: mode } } : {}) });
const order = (mode: string | undefined, ticks: number[]) => ticks.map((t) => frameAt(animationSchedule(meta(mode), 16, 64)!, t * 50).index).join("");
assert(order(undefined, [0, 2, 4, 6, 8, 10]) === "012301", "loop");
assert(order("ping_pong", [0, 2, 4, 6, 8, 10, 12, 14]) === "01232101", `ping-pong ${order("ping_pong", [0, 2, 4, 6, 8, 10, 12, 14])}`);
assert(order("hold_last", [0, 2, 4, 6, 8, 100, 10000]) === "0123333", "hold last");
assert(order("hold_first", [0, 2, 4, 6, 8, 100]) === "012300", "hold first");
assert(widgetSchedule("image", 16, 64, meta("ping_pong"))!.frames.map((f) => f.index).join("") === "012321", "GUI images play the mode");
assert(widgetSchedule("toggle", 16, 64, meta("hold_last"))!.hold === 3, "toggle textures hold too");
const baked = (mode: string) => JSON.parse(vanillaMcmeta(meta(mode), 16, 64));
assert(JSON.stringify(baked("ping_pong").animation.frames) === "[0,1,2,3,2,1]" && !baked("ping_pong").mcedge, "vanilla ping-pong is a frame list, no mcedge section");
assert(JSON.stringify(baked("hold_last").animation.frames) === JSON.stringify([0, 1, 2, { index: 3, time: HOLD_TICKS }]), "vanilla hold last");
assert(JSON.stringify(baked("hold_first").animation.frames) === JSON.stringify([0, 1, 2, 3, { index: 0, time: HOLD_TICKS }]), "vanilla hold first");
assert(vanillaMcmeta(meta(), 16, 64) === meta(), "a loop .mcmeta is copied as it is");
console.log("model: loop, ping-pong, hold last, hold first, vanilla frame lists OK");

// ---- the editor
const project = exampleProject();
const COLOURS = [[220, 40, 40], [40, 200, 60], [50, 80, 230], [240, 210, 40]];
const strip = new Uint8Array(16 * 64 * 4);
for (let i = 0; i < 16 * 64; i++) strip.set([...COLOURS[Math.floor(i / 256)], 255], i * 4);
writeFileSync(join(project, "textures/pong.png"), writePng({ width: 16, height: 64, data: strip }));
writeFileSync(join(project, "textures/pong.png.mcmeta"), JSON.stringify({ animation: { frametime: 3 } }));
// A GUI with the texture as an image started by a procedure.
const guiType = typeRegistry().byId.get("gui")!;
mkdirSync(join(project, "elements", guiType.folder), { recursive: true });
writeFileSync(join(project, "elements", guiType.folder, "playback.json"), JSON.stringify({ ...newElement(guiType, "playback"),
  components: [{ kind: "image", name: "pong", x: 20, y: 20, width: 32, height: 32, image: "textures/pong.png", animationStart: "procedure" }] }, null, 2));

/** The frames the main canvas shows over `ms`, one entry per change. */
async function frames(app: App, ms: number): Promise<string> {
  let seen = "";
  for (const end = Date.now() + ms; Date.now() < end; await app.sleep(20)) {
    const f = await app.eval<string>(`document.querySelector(".paintcanvas").getAttribute("data-frame") ?? ""`);
    if (f && !seen.endsWith(f)) seen += f;
  }
  return seen;
}
const play = async (app: App, mode: string) => {
  if (await app.eval<boolean>(`!!document.querySelector(".playbadge")`)) await app.click(".actions .abtn", "Stop");
  await app.setValue(".paintform select.playbackmode", mode);
  await app.click(".actions .abtn", "Play");
  await app.waitFor(`!!document.querySelector(".playbadge")`);
  await showPicker(app);
};
/** Scrolls the side panel to the Playback picker, for the screenshots. */
const showPicker = (app: App) => app.eval(`document.querySelector(".paintform select.playbackmode").scrollIntoView({ block: "center" })`);
async function open(app: App) {
  await app.eval(`[...document.querySelectorAll(".rtab")].find((b) => /Resources|Kaynaklar/.test(b.textContent)).click()`);
  await app.waitFor(`[...document.querySelectorAll(".texcell")].some((c) => c.textContent.includes("pong.png"))`, 10000);
  await app.click(".texcell", "pong.png", { double: true });
  await app.waitFor(`document.querySelectorAll(".framecell").length === 4`);
}

await run(async (app) => {
  await open(app);
  assert(await app.eval<string>(`document.querySelector(".paintform select.playbackmode").value`) === "loop", "a texture without a mode loops");
  const options = await app.eval<string[]>(`[...document.querySelectorAll(".paintform select.playbackmode option")].map((o) => o.textContent)`);
  assert(options.length === 4, `four modes ${JSON.stringify(options)}`);

  await play(app, "ping_pong");
  const pong = await frames(app, 1500);
  assert(pong.includes("0123210") || pong.includes("1232101"), `ping-pong goes back from the last frame, saw ${pong}`);
  console.log(`ping-pong: ${pong}`);

  await play(app, "hold_last");
  const last = await frames(app, 1300);
  assert(/^0?123$/.test(last) || last.endsWith("123"), `hold last plays once and stops, saw ${last}`);
  const still = await frames(app, 600);
  assert(still === "3", `hold last stays on the last frame, saw ${still}`);
  console.log(`hold last: ${last} then ${still}`);
  await app.shot(`${OUT}/editor-hold-last-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/editor-hold-last-light.png`);
  await app.setTheme("dark");

  await play(app, "hold_first");
  const first = await frames(app, 1300);
  assert(first.endsWith("1230") && (await frames(app, 500)) === "0", `hold first returns to the first frame, saw ${first}`);
  console.log(`hold first: ${first}`);

  // Save keeps the mode in the .mcmeta's own section, vanilla keys as they were.
  await play(app, "ping_pong");
  await app.click(".actions .abtn", "Stop");
  await app.key("s", 2);
  await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10000);
  const saved = JSON.parse(readFileSync(join(project, "textures/pong.png.mcmeta"), "utf8"));
  assert(saved.mcedge?.playback === "ping_pong" && saved.animation.frametime === 3 && !saved.animation.frames, `saved ${JSON.stringify(saved)}`);
  await app.click(".actions .abtn", "Play");
  await showPicker(app);
  await app.sleep(400);
  await app.shot(`${OUT}/editor-ping-pong-dark.png`);

  // The GUI image shows the texture's mode and its animation start.
  await app.key("Escape");
  await showInApp(project, "gui/playback", 20000);
  await app.waitFor(`document.querySelector('.guistage .gwidget[data-index="0"]')`, 15000);
  await app.click('.guistage .gwidget[data-index="0"]');
  await app.waitFor(`!!document.querySelector(".playbacknote")`, 10000);
  const note = await app.eval<string>(`document.querySelector(".playbacknote").getAttribute("data-mode")`);
  assert(note === "ping_pong", `the GUI image shows the texture's mode, saw ${note}`);
  const start = await app.eval<string>(`(() => {
    const s = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "On procedure call"));
    s?.scrollIntoView({ block: "center" });
    return s?.selectedOptions[0]?.textContent ?? "";
  })()`);
  assert(start === "On procedure call", `the GUI image shows its animation start, saw ${start}`);
  await app.shot(`${OUT}/gui-image-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/gui-image-light.png`);
  await app.setTheme("dark");
}, { project, width: 1440, height: 900 });

// Turkish screenshots.
await run(async (app) => {
  await open(app);
  await app.click(".actions .abtn", "Oynat");
  await app.waitFor(`!!document.querySelector(".playbadge")`);
  await showPicker(app);
  await app.sleep(300);
  await app.shot(`${OUT}/editor-tr-dark.png`);
  await showInApp(project, "gui/playback", 20000);
  await app.waitFor(`document.querySelector('.guistage .gwidget[data-index="0"]')`, 15000);
  await app.click('.guistage .gwidget[data-index="0"]');
  await app.waitFor(`!!document.querySelector(".playbacknote")`, 10000);
  await app.eval(`document.querySelector(".playbacknote").scrollIntoView({ block: "start" })`);
  await app.shot(`${OUT}/gui-image-tr-dark.png`);
}, { project, language: "tr", width: 1440, height: 900 });
