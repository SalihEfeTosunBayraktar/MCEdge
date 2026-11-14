// GUI images are scaled to their widget size, as the GUI editor draws them: blit gets the widget size as the texture
// size. A 16x16 ruby_block drawn as the 176x166 panel (ruby_gui's 176x166 image) and a 16x16 ruby drawn at 20x20 (its 20x20 image)
// must not be cropped to their top-left corner or tiled.
// Generates the test project (no Gradle) on every engine and reads RubyGuiScreen.java. Run make.ts first when spec.ts
// changed.
// usage: node tools/codegen-test/gui-image-scale-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
// Widget indexes from the generated element, so new widgets in spec.ts do not shift the check.
const widgets = JSON.parse(readFileSync(join(T, "project/elements/guis/ruby_gui.json"), "utf8")).components as { kind: string; width?: number; height?: number }[];
const imageIndex = (w: number, h: number) => widgets.findIndex((x) => x.kind === "image" && x.width === w && x.height === h);
const PANEL = imageIndex(176, 166), SMALL = imageIndex(20, 20);
for (const engine of ["forge-1.16.5", "neoforge-1.21.5", "neoforge-26.3", "fabric-1.21.5", "fabric-26.3"]) {
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(gen.status, 0, `${engine}: generate failed\n${gen.stdout}${gen.stderr}`);
  const screen = readFileSync(join(T, "project/out", engine, "src/main/java/dev/mcedge/wavethree/client/gui/RubyGuiScreen.java"), "utf8");
  const blitOf = (index: number) => {
    const line = screen.split("\n").find((l) => l.includes(`ruby_gui_${index}.png`) || l.includes(`ruby_gui_${index}"`));
    assert.ok(line, `${engine}: widget ${index} texture is drawn`);
    const at = screen.indexOf(line);
    const call = screen.slice(at, screen.indexOf(";", screen.indexOf("blit(", at)) + 1);
    return call.replace(/\s+/g, " ");
  };
  assert.ok(/176, 166, 176, 166\)/.test(blitOf(PANEL)), `${engine}: panel image scaled to 176x166\n${blitOf(PANEL)}`);
  assert.ok(/20, 20, 20, 20\)/.test(blitOf(SMALL)), `${engine}: 20x20 image scaled, not cropped\n${blitOf(SMALL)}`);
}
console.log("gui-image-scale-check OK");
