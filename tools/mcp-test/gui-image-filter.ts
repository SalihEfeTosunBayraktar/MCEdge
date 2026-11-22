/**
 * Q273: opacity and colour filter on GUI and overlay images, over MCP on a copy of examples/hello. The generated
 * textures of every engine carry the filter on visible pixels only (empty pixels stay as they were), 1.16.5 blends a
 * translucent image, the layout check refuses the fields on other widgets and preview_gui draws the filter.
 * The preview goes to tools/mcp-test/out/gui-image-filter/.
 *   node tools/mcp-test/gui-image-filter.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { readPng, writePng } from "../../src/generator/png.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const out = join(import.meta.dirname, "out", "gui-image-filter");
mkdirSync(out, { recursive: true });

// A 4x4 picture: transparent corners, a half transparent edge pixel, white and grey inside.
const W = [255, 255, 255, 255], G = [128, 128, 128, 255], E = [0, 0, 0, 0], H = [200, 100, 50, 128];
const pixels = [E, W, W, E, W, G, G, H, W, G, G, W, E, W, W, E];
writeFileSync(join(project, "textures", "frame.png"), writePng({ width: 4, height: 4, data: Uint8Array.from(pixels.flat()) }));

const mcp = await connect(project);
try {
  await mcp.call("create_element", { type: "gui", id: "tinted", values: { type: 1 } });
  const bad = await mcp.call("write_gui_layout", { id: "tinted", widgets: [{ kind: "label", x: 0, y: 0, text: "x", tint: "#FF0000" }] }).catch((e: Error) => e.message);
  assert(JSON.stringify(bad).includes("opacity, tint and tintStrength are for images"), `tint on a label is refused: ${JSON.stringify(bad)}`);
  await mcp.call("write_gui_layout", { id: "tinted", widgets: [
    { kind: "image", x: 8, y: 8, width: 32, height: 32, image: "textures/frame.png", opacity: 50, tint: "#FF0000" },
    { kind: "image", x: 48, y: 8, width: 32, height: 32, image: "textures/frame.png" },
    { kind: "image_button", x: 88, y: 8, width: 16, height: 16, image: "textures/frame.png", hoverImage: "textures/frame.png", tint: "#0000FF", tintStrength: 50 },
    { kind: "state_image", x: 8, y: 48, width: 16, height: 16, states: [{ image: "textures/frame.png" }], opacity: 25 },
    { kind: "image_button", x: 112, y: 8, width: 16, height: 16, image: "textures/frame.png", hoverImage: "textures/frame.png", opacity: 50 },
  ] });
  await mcp.call("create_element", { type: "overlay", id: "faded" });
  await mcp.call("write_gui_layout", { type: "overlay", id: "faded", widgets: [{ kind: "image", x: 4, y: 4, width: 16, height: 16, image: "textures/frame.png", opacity: 40 }] });

  const regen = await mcp.call("regenerate_code");
  assert(regen.length === 5, `regenerate_code writes 5 engines (${regen.length})`);
  const engines = readdirSync(join(project, "out"));
  const at = (png: { data: Uint8Array }, i: number) => Array.from(png.data.subarray(i * 4, i * 4 + 4));
  for (const engine of engines) {
    const screens = join(project, "out", engine, "src/main/resources/assets/hellomcedge/textures/screens");
    const tex = (name: string) => readPng(readFileSync(join(screens, `${name}.png`)));
    const img = tex("tinted_0");
    // Red multiplied at full strength, alpha halved; empty pixels untouched.
    assert(JSON.stringify(at(img, 0)) === JSON.stringify(E), `${engine}: empty corner stays empty (${at(img, 0)})`);
    assert(JSON.stringify(at(img, 1)) === "[255,0,0,128]", `${engine}: white becomes half transparent red (${at(img, 1)})`);
    assert(JSON.stringify(at(img, 5)) === "[128,0,0,128]", `${engine}: grey keeps its shade (${at(img, 5)})`);
    assert(JSON.stringify(at(img, 7)) === "[200,0,0,64]", `${engine}: a half transparent pixel halves again (${at(img, 7)})`);
    assert(JSON.stringify(Array.from(tex("tinted_1").data)) === JSON.stringify(pixels.flat()), `${engine}: an image without a filter is copied as it is`);
    const button = tex("tinted_2");
    assert(JSON.stringify(at(button, 1)) === "[128,128,255,255]" && JSON.stringify(at(button, 0)) === JSON.stringify(E), `${engine}: button tinted at half strength (${at(button, 1)})`);
    const state = tex("tinted_3_s0");
    assert(JSON.stringify(at(state, 1)) === "[255,255,255,64]" && JSON.stringify(at(state, 15)) === JSON.stringify(E), `${engine}: state image at 25% (${at(state, 1)})`);
    assert(at(tex("faded_0"), 1)[3] === 102 && at(tex("faded_0"), 0)[3] === 0, `${engine}: overlay image at 40% (${at(tex("faded_0"), 1)})`);
    if (!engine.includes("1.16.5")) {
      const sprite = readPng(readFileSync(join(project, "out", engine, "src/main/resources/assets/hellomcedge/textures/gui/sprites/screens/tinted_2.png")));
      assert(JSON.stringify(at(sprite, 1)) === "[128,128,255,255]", `${engine}: the button's GUI sprite is tinted too`);
    }
  }
  const legacy = engines.find((e) => e.includes("1.16.5"));
  assert(legacy, "a 1.16.5 engine is generated");
  const screen = readFileSync(join(project, "out", legacy, "src/main/java/dev/mcedge/hello/client/gui/TintedScreen.java"), "utf8");
  const bg = screen.slice(screen.indexOf("renderBg"));
  assert(/enableBlend\(\);[^\n]*defaultBlendFunc\(\);\s*\n\s*this\.minecraft\.getTextureManager\(\)\.bind\([^)]*tinted_0/.test(bg), "1.16.5: the translucent image blends");
  assert(!/enableBlend\(\);[^\n]*\n\s*this\.minecraft\.getTextureManager\(\)\.bind\([^)]*tinted_1/.test(bg), "1.16.5: the plain image is drawn as before");
  assert(/enableBlend\(\);[^\n]*\n\s*this\.minecraft\.getTextureManager\(\)\.bind\([^)]*tinted_3_s0/.test(bg), "1.16.5: the translucent state image blends");
  assert(screen.split("super.renderButton").length === 2, "1.16.5: only the translucent image button blends; the opaque tinted one keeps the plain ImageButton");

  await mcp.call("preview_gui", { id: "tinted", scale: 2 });
  assert(mcp.lastImages.length === 1, "preview_gui returns a picture");
  writeFileSync(join(out, "tinted.png"), Buffer.from(mcp.lastImages[0], "base64"));
  console.log("PASS gui-image-filter");
} finally {
  await mcp.close();
}
