/**
 * Q275 over MCP on a copy of examples/hello: modern image buttons draw their own sprite, lit only under the mouse or
 * with keyboard focus (not after a click); image and toggle buttons show a pressed texture after a click when they
 * have one (1.16.5 skips it); the Problems check reports images drawn at a blurring size and images larger than the GUI.
 *   node tools/mcp-test/gui-button-states.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { writePng } from "../../src/generator/png.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const png = (name: string, width: number, height: number, rgb: number[]) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  writeFileSync(join(project, "textures", name), writePng({ width, height, data }));
};
png("btn.png", 16, 16, [90, 90, 90]);
png("btn_hover.png", 16, 16, [200, 170, 40]);
png("btn_pressed.png", 16, 16, [40, 40, 40]);
png("btn_on.png", 16, 16, [40, 160, 40]);
png("btn_on_pressed.png", 16, 16, [20, 90, 20]);
png("sheet.png", 16, 32, [120, 60, 60]);
png("wide.png", 200, 20, [10, 10, 80]);

const mcp = await connect(project);
try {
  await mcp.call("create_element", { type: "gui", id: "panel", values: { type: 0, width: 176, height: 100 } });
  const bad = await mcp.call("write_gui_layout", { id: "panel", widgets: [{ kind: "image", x: 0, y: 0, image: "textures/btn.png", pressedImage: "textures/btn_pressed.png" }] }).catch((e: Error) => e.message);
  assert(JSON.stringify(bad).includes("pressedImage is for image_button and toggle_button only"), `pressedImage on an image is refused: ${JSON.stringify(bad)}`);
  const missing = await mcp.call("write_gui_layout", { id: "panel", widgets: [{ kind: "image_button", x: 0, y: 0, image: "textures/btn.png", pressedImage: "textures/nope.png" }] }).catch((e: Error) => e.message);
  assert(String(missing).includes("pressedImage \"textures/nope.png\" not in the project"), "a missing pressed texture is refused");
  await mcp.call("write_gui_layout", { id: "panel", widgets: [
    { kind: "image_button", x: 8, y: 8, width: 16, height: 16, image: "textures/btn.png", hoverImage: "textures/btn_hover.png", pressedImage: "textures/btn_pressed.png" },
    { kind: "image_button", x: 30, y: 8, width: 16, height: 16, image: "textures/btn.png", hoverImage: "textures/btn_hover.png" },
    { kind: "toggle_button", x: 52, y: 8, width: 16, height: 16, image: "textures/btn.png", hoverImage: "textures/btn_hover.png", onImage: "textures/btn_on.png", pressedImage: "textures/btn_pressed.png", onPressedImage: "textures/btn_on_pressed.png" },
    { kind: "image", x: 8, y: 30, width: 24, height: 24, image: "textures/btn.png" },
    { kind: "image", x: 40, y: 30, width: 32, height: 32, image: "textures/btn.png" },
    { kind: "image_button", x: 80, y: 30, width: 16, height: 16, image: "textures/sheet.png" },
    { kind: "image", x: 0, y: 70, image: "textures/wide.png" },
  ] });

  // M3: the Problems check.
  const problems = (await mcp.call("validate_project")) as { path: string; code?: string; severity?: string; message: string }[];
  const of = (code: string) => problems.filter((p) => p.code === code).map((p) => p.path);
  assert(JSON.stringify(of("guiImageScale")) === JSON.stringify(["gui/panel.components[3]"]), `only the 16x16 drawn 24x24 is reported as blurred: ${JSON.stringify(of("guiImageScale"))}`);
  assert(problems.find((p) => p.code === "guiImageScale")?.severity === "warning", "a warning");
  assert(problems.find((p) => p.code === "guiImageScale")!.message.includes("16x16, drawn 24x24"), "the message gives both sizes");
  assert(JSON.stringify(of("guiImageTooBig")) === JSON.stringify(["gui/panel.components[6]"]), `the 200x20 image on a 176 wide GUI is reported: ${JSON.stringify(of("guiImageTooBig"))}`);

  const regen = await mcp.call("regenerate_code");
  assert(regen.length === 5, `5 engines generated (${regen.length})`);
  for (const engine of readdirSync(join(project, "out"))) {
    const out = join(project, "out", engine);
    const legacy = engine.includes("1.16.5");
    const java = readFileSync(join(out, "src/main/java/dev/mcedge/hello/client/gui/PanelScreen.java"), "utf8");
    const assets = join(out, "src/main/resources/assets/hellomcedge/textures");
    if (legacy) {
      assert(!/widget\d+Pressed/.test(java) && !java.includes("getLastInputType"), `${engine}: 1.16.5 keeps the plain buttons (a click does not focus there)`);
      assert(!existsSync(join(assets, "screens/panel_2_pressed.png")), `${engine}: no pressed textures copied`);
      continue;
    }
    assert(!java.includes("isHoveredOrFocused"), `${engine}: no button lights from mouse focus`);
    assert((java.match(/getLastInputType\(\)\.isKeyboard\(\)/g) ?? []).length === 3, `${engine}: the three image buttons are lit under the mouse or with keyboard focus only`);
    assert(java.includes("private long widget0Pressed;") && !java.includes("widget1Pressed") && java.includes("private long widget2Pressed;"), `${engine}: a press time only where a pressed texture is`);
    assert(/widget0Pressed = System\.currentTimeMillis\(\) \+ 120L; this\.press\(0\);/.test(java), `${engine}: the click stamps the press time, then runs the procedure`);
    assert(/System\.currentTimeMillis\(\) < [A-Za-z.]+this\.widget0Pressed \? [^?]*panel_0_pressed"\) : this\.sprites/.test(java), `${engine}: the pressed sprite shows after a click`);
    assert(java.includes("state = on ? 5 : 4;"), `${engine}: the toggle shows its pressed texture of the current state`);
    for (const f of ["gui/sprites/screens/panel_0_pressed.png", "screens/panel_2_pressed.png", "screens/panel_2_on_pressed.png"]) assert(existsSync(join(assets, f)), `${engine}: ${f} copied`);
    assert(!existsSync(join(assets, "gui/sprites/screens/panel_1_pressed.png")), `${engine}: no pressed sprite without a pressed texture`);
  }
  console.log("PASS gui-button-states");
} finally {
  await mcp.close();
}
