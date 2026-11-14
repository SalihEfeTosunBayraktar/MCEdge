/**
 * KUYRUK 186: the state image in the GUI and overlay editors. The side panel lists the states with a preview each
 * (an animated one plays, a fixed frame shows that frame), clicking one shows it on the canvas; the state procedure,
 * what it returns, the read interval and the restart switch save; Split into frames turns a strip into one state per
 * frame; Add widget makes one in a GUI and in an overlay. The generator is checked by
 * tools/codegen-test/state-image-check.ts, MCP by tools/mcp-test/surface.ts. Args: theme, language. Screenshots in design/186/.
 */
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const S = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const project = exampleProject();
// An animated strip (.mcmeta, 3 frames) and a still 3-frame strip from the codegen test textures.
const TEX = join(REPO, "tools", "codegen-test", "project", "textures");
for (const f of ["toggle_on.png", "toggle_on.png.mcmeta", "spark_strip.png"]) copyFileSync(join(TEX, f), join(project, "textures", f));
addElement(project, "procedure", "meter_level", { returnType: "number" });
addElement(project, "gui", "meter", { type: 0, width: 176, height: 100, components: [
  { kind: "state_image", name: "meter", x: 40, y: 20, width: 32, height: 32, stateProcedure: "",
    states: [{ image: "textures/ruby.png" }, { image: "textures/toggle_on.png" }, { image: "textures/spark_strip.png" }] },
] });
addElement(project, "overlay", "meterhud", { components: [
  { kind: "state_image", x: 200, y: 100, width: 24, height: 24, states: [{ image: "textures/ruby_apple.png" }, { image: "textures/ruby_block.png" }], previewState: 1 },
] });
type State = { image?: string; frame?: number; condition?: string };
type W = { kind: string; states?: State[]; previewState?: number; stateProcedure?: string; stateValue?: string; updateTicks?: number; restartAnimation?: boolean };
const saved = (folder: string, id: string) => (JSON.parse(readFileSync(join(project, "elements", folder, `${id}.json`), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const strip = `[...document.querySelectorAll(".statelist .stateitem")].map((b) => b.dataset.state + "=" + b.dataset.texture.split("/").pop() + (b.classList.contains("sel") ? "*" : ""))`;
const canvas = `(() => { const s = document.querySelector(".guistage .gstate"); return s ? s.dataset.state + "=" + s.dataset.texture.split("/").pop() + (s.querySelector("canvas[data-animated]") ? " animated" : "") : ""; })()`;

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "meter", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gwidget.k-state_image .gstate")`);
  await app.click(".guilist .lrow", "meter");
  await app.waitFor(`document.querySelectorAll(".statelist .stateitem").length === 3`);
  const labels = await app.eval<string[]>(`[...document.querySelectorAll(".guiform .frow > label")].map((l) => l.textContent.replace("*", "").trim())`);
  for (const key of ["gui.field.states", "gui.field.stateNumber", "gui.field.stateValue", "gui.field.updateTicks", "gui.field.restartAnimation"]) assert(labels.includes(S[key]), `field ${S[key]}: ${labels}`);
  let shown = (await app.eval<string[]>(strip)).join(" ");
  assert(shown === "0=ruby.png* 1=toggle_on.png 2=spark_strip.png", `the states listed, the first on the canvas: ${shown}`);
  assert(await app.eval<string>(canvas) === "0=ruby.png", `canvas shows state 0: ${await app.eval<string>(canvas)}`);
  // The animated state plays in its preview.
  assert(await app.eval<boolean>(`!!document.querySelector('.statelist .stateitem[data-state="1"] canvas[data-animated]')`), "the animated state plays in the list");

  // Clicking a state shows it on the canvas (saved as the editor's preview state).
  await app.click(".statelist .stateitem", S["gui.state.n"].replace("{n}", "1"));
  await waitSaved(app);
  assert(saved("guis", "meter")[0].previewState === 1, `preview state saved: ${JSON.stringify(saved("guis", "meter")[0])}`);
  await app.waitFor(`document.querySelector(".guistage .gstate canvas[data-animated]")`);
  assert(await app.eval<string>(canvas) === "1=toggle_on.png animated", `canvas shows the animated state 1: ${await app.eval<string>(canvas)}`);

  // What picks the state.
  await app.setField(S["gui.field.stateNumber"], "meter_level", ".guiform");
  await app.setField(S["gui.field.stateValue"], "1", ".guiform"); // index, percent
  await app.setField(S["gui.field.updateTicks"], "10", ".guiform");
  await waitSaved(app);
  let w = saved("guis", "meter")[0];
  assert(w.stateProcedure === "meter_level" && w.stateValue === "percent" && w.updateTicks === 10, `state procedure, percentage, interval saved: ${JSON.stringify(w)}`);
  await app.shot(`design/186/states-${theme}-${lang}.png`);

  // Split the still strip into one state per frame.
  await app.click(".statelist .stateitem", S["gui.state.n"].replace("{n}", "2"));
  await waitSaved(app);
  await app.waitFor(`!document.querySelector(".statestrip .mbtn").disabled`);
  await app.click(".statestrip .mbtn", S["gui.state.split"]);
  await waitSaved(app);
  w = saved("guis", "meter")[0];
  const frames = (w.states ?? []).map((s) => `${s.image?.split("/").pop()}${s.frame !== undefined ? `#${s.frame}` : ""}`).join(" ");
  assert(frames === "ruby.png toggle_on.png spark_strip.png#0 spark_strip.png#1 spark_strip.png#2", `split into frames: ${frames}`);
  await app.waitFor(`document.querySelectorAll(".statelist .stateitem").length === 5`);
  shown = (await app.eval<string[]>(`[...document.querySelectorAll(".statelist .stateitem .statesub")].map((s) => s.textContent)`)).join("|");
  assert(shown === `||${[0, 1, 2].map((n) => S["gui.state.frame"].replace("{n}", String(n))).join("|")}`, `frame notes: ${shown}`);
  assert(await app.eval<boolean>(`document.querySelector(".statestrip .mbtn").disabled`), "a fixed frame is not split again");
  await app.shot(`design/186/split-${theme}-${lang}.png`);

  // Add widget > State image: a new one with a picture.
  await app.click(".abtn", S["gui.add"]);
  await app.click(".menulist button", S["gui.kind.state_image"]);
  await waitSaved(app);
  const added = saved("guis", "meter").at(-1)!;
  assert(added.kind === "state_image" && !!added.states?.[0]?.image, `new state image: ${JSON.stringify(added)}`);

  // Overlay: the state image is offered and drawn with its preview state.
  await app.click(".abtn", S["editor.back"]);
  await app.sleep(300);
  await app.click(".tile", "meterhud", { double: true });
  await app.waitFor(`document.querySelector(".guistage .gstate")`);
  assert(await app.eval<string>(canvas) === "1=ruby_block.png", `overlay canvas shows its preview state: ${await app.eval<string>(canvas)}`);
  await app.click(".abtn", S["gui.add"]);
  const offered = await app.eval<string[]>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent.trim())`);
  assert(offered.includes(S["gui.kind.state_image"]), `overlay offers the state image: ${offered}`);
  await app.key("Escape");
  await app.click(".guilist .lrow", S["gui.kind.state_image"]);
  await app.waitFor(`document.querySelectorAll(".statelist .stateitem").length === 2`);
  await app.shot(`design/186/overlay-${theme}-${lang}.png`);
}, { project, theme, language: lang });
