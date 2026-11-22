/**
 * KUYRUK #96: the toggle button. The GUI editor adds one from Add widget, shows its four texture fields, the On while
 * and click procedures, and a preview of each state (a missing texture shows the one it falls back to); the canvas
 * draws the off state and the off hover state under the mouse. MCP and the generator are checked by
 * tools/mcp-test/surface.ts and tools/codegen-test (ruby_gui). Screenshots go to design/gui-editor/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const project = exampleProject();
addElement(project, "procedure", "lamp_on", { returnType: "logic" });
addElement(project, "procedure", "flip_lamp");
addElement(project, "gui", "lamp", {
  type: 0, width: 176, height: 166,
  components: [
    { kind: "toggle_button", name: "lamp", x: 40, y: 40, width: 32, height: 32, image: "textures/ruby.png", hoverImage: "textures/ruby_apple.png",
      onImage: "textures/ruby_block.png", onHoverImage: "", stateProcedure: "", procedure: "flip_lamp" },
  ],
});
const OUT = evidence("design/gui-editor");
const saved = () => JSON.parse(readFileSync(join(project, "elements", "guis", "lamp.json"), "utf8")).components as Record<string, unknown>[];
/** Texture file each state preview shows, in state order. */
const previews = `[...document.querySelectorAll(".togglestate")].map((f) => f.dataset.state + "=" + f.dataset.texture.split("/").pop())`;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "lamp", { double: true });
  await app.waitFor(`document.querySelector(".gwidget.k-toggle_button .gtoggle")`);
  await app.click(".guilist .lrow", "lamp");
  await app.waitFor(`document.querySelectorAll(".togglestate img").length === 4`);
  const fields = await app.eval<string[]>(`[...document.querySelectorAll(".guiform .efrow > label")].map((l) => l.textContent.replace("*", "").trim())`);
  for (const label of ["Off texture", "Off, hover texture", "On texture", "On, hover texture", "On while", "On click"]) assert(fields.includes(label), `field ${label}: ${fields}`);
  const shown = (await app.eval<string[]>(previews)).join(" ");
  assert(shown === "off=ruby.png offHover=ruby_apple.png on=ruby_block.png onHover=ruby_block.png", `state previews with fallback: ${shown}`);

  await app.setField("On while", "lamp_on", ".guiform");
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
  assert(saved()[0].stateProcedure === "lamp_on", `state procedure saved: ${JSON.stringify(saved()[0])}`);
  await app.shot(`${OUT}/toggle-button-dark.png`);

  // Under the mouse the canvas shows the off hover texture.
  const [hx, hy] = await app.center(".gwidget.k-toggle_button .gtoggle");
  await app.mouse("mouseMoved", hx, hy, 0);
  await app.sleep(200);
  assert(await app.eval<boolean>(`getComputedStyle(document.querySelector(".gtoggle .ghover")).display === "block"`), "off hover texture under the mouse");

  // Add widget > Toggle button makes a new one with the off texture set.
  await app.click(".abtn", "Add widget");
  await app.click(".menulist button", "Toggle button");
  await app.sleep(600);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
  const added = saved().at(-1)!;
  assert(added.kind === "toggle_button" && typeof added.image === "string" && added.image !== "", `new toggle button: ${JSON.stringify(added)}`);
  await app.setTheme("light");
  await app.click(".guilist .lrow", "lamp");
  await app.waitFor(`document.querySelectorAll(".togglestate img").length === 4`);
  await app.shot(`${OUT}/toggle-button-light.png`);
}, { project });
