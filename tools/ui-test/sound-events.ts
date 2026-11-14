/**
 * KUYRUK 132: Resources > Sounds edits sound events (category, subtitle as a lang key, several files) and Resources >
 * Animations lists the project's model animations. On a copy of examples/hello with two sound files and a Blockbench
 * animation export: the two files are two events; ding gets a category, a subtitle and ding_2 as a second file (one
 * event left, sound_events.json and en_us written); deleting the event gives the
 * files back as their own events and drops the subtitle; the Animations tab lists WALK and IDLE; MCP list_sound_events,
 * set_sound_event, delete_sound_event and list_animations do the same. Screenshots go to design/132/ (light with LIGHT=1).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";

const OUT = "design/132";
const project = exampleProject();
mkdirSync(join(project, "sounds"), { recursive: true });
for (const n of ["ding", "ding_2"]) writeFileSync(join(project, "sounds", `${n}.ogg`), `OggS ${n}`);
mkdirSync(join(project, "models"), { recursive: true });
copyFileSync(join(REPO, "tools/codegen-test/project/models/RubyBeastAnimation.java"), join(project, "models", "rubybeastanimation.java"));
const events = () => (existsSync(join(project, "sound_events.json")) ? JSON.parse(readFileSync(join(project, "sound_events.json"), "utf8")) : {});
const enUs = () => JSON.parse(readFileSync(join(project, "localization", "en_us.json"), "utf8")) as Record<string, string>;
const rowNames = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".scrollarea tbody tr td:first-child")].map((c) => c.textContent)`);
const waitFile = async (app: App, ok: () => boolean) => { for (let i = 0; i < 50 && !ok(); i++) await app.sleep(200); };

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".rtab", "Resources");
  await app.click(".ltab", "Sounds");
  await app.waitFor(`document.querySelectorAll(".scrollarea tbody tr").length === 2`);
  assert((await rowNames(app)).join() === "ding,ding_2", `two files, two events: ${await rowNames(app)}`);

  await app.click(".scrollarea tbody tr", "ding");
  await app.waitFor(`document.querySelector(".soundform")`);
  await app.setValue(".soundform select[aria-label=Category]", "block");
  await app.setValue(".soundform input[aria-label=Subtitle]", "Ding rings");
  await app.eval(`[...document.querySelectorAll(".soundfiles label")].find((l) => l.textContent.includes("ding_2.ogg")).querySelector("input").click()`);
  await app.click(".abtn.soundsave");
  await waitFile(app, () => !!events().ding);
  assert(JSON.stringify(events()) === JSON.stringify({ ding: { category: "block", subtitle: true, files: ["ding", "ding_2"] } }), `sound_events.json ${JSON.stringify(events())}`);
  assert(enUs()["subtitles.hellomcedge.ding"] === "Ding rings", "subtitle text in en_us");
  await app.waitFor(`document.querySelectorAll(".scrollarea tbody tr").length === 1`);
  await app.shot(`${OUT}/after-event-dark.png`);
  if (process.env.LIGHT) {
    await app.setTheme("light");
    await app.sleep(400);
    await app.shot(`${OUT}/after-event-light.png`);
    await app.setTheme("dark");
  }

  // Deleting the listed event gives the files back as their own events and drops the subtitle.
  await app.click(".abtn", "Delete selected");
  await waitFile(app, () => !events().ding);
  await app.waitFor(`document.querySelectorAll(".scrollarea tbody tr").length === 2`);
  assert(!("subtitles.hellomcedge.ding" in enUs()), "subtitle removed");

  // Animations tab.
  await app.click(".ltab", "Animations");
  await app.waitFor(`document.querySelectorAll(".scrollarea tbody tr").length === 2`);
  const anims = await rowNames(app);
  assert(anims.join() === "WALK,IDLE", `animations ${anims}`);
  await app.click(".scrollarea tbody tr", "WALK");
  await app.sleep(300);
  await app.shot(`${OUT}/after-animations-dark.png`);

  const mcp = await connect(project);
  try {
    await mcp.call("set_sound_event", { name: "chime", category: "player", subtitle: "Chime", files: ["ding_2"] });
    const list = await mcp.call<{ name: string; files: string[]; subtitle: string; defined: boolean }[]>("list_sound_events");
    assert(list.map((e) => e.name).join() === "chime,ding" && list[0].subtitle === "Chime" && list[0].defined, `mcp events ${JSON.stringify(list)}`);
    await mcp.call("delete_sound_event", { name: "chime" });
    assert(!events().chime && !("subtitles.hellomcedge.chime" in enUs()), "mcp delete");
    const animations = await mcp.call<{ path: string; animations: { name: string }[] }[]>("list_animations");
    assert(animations.length === 1 && animations[0].animations.length === 2, `mcp animations ${JSON.stringify(animations)}`);
  } finally {
    await mcp.close();
  }
}, { project });
