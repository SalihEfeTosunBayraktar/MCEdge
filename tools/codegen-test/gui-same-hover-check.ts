// KUYRUK 167: an image button whose hover texture is the same file as its normal one uses the one-file layout (normal
// state on top, hover state below). Generates the test project on every engine (no Gradle) and checks same_hover_gui's
// button textures: 1.21.5 / 26.x sprites are the top half (normal) and the bottom half (highlighted), 1.16.5 keeps the
// file as it is instead of stacking it on itself.
// usage: node tools/codegen-test/gui-same-hover-check.ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { readPng } from "../../src/generator/png.ts";

const T = import.meta.dirname;
const project = join(T, "project");
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
/** Size and the colour of the top-left and bottom-left pixels ("r,g,b"). */
const look = (file: string) => {
  if (!existsSync(file)) return "missing";
  const png = readPng(readFileSync(file));
  const at = (y: number) => [...png.data.slice(y * png.width * 4, y * png.width * 4 + 3)].join(",");
  return `${png.width}x${png.height} ${at(0)} ${at(png.height - 1)}`;
};
const RED = "220,40,40", BLUE = "30,90,230";

for (const engine of listEngines()) {
  const gen = spawnSync("node", ["src/cli.ts", "build", project, "--target", engine.id, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { check(false, `${engine.id}: generate\n${gen.stderr}`); continue; }
  const tex = join(project, "out", engine.id, "src/main/resources/assets/wavethree/textures");
  if (engine.id === "forge-1.16.5") {
    const sheet = look(join(tex, "screens/same_hover_gui_0.png"));
    check(sheet === `16x32 ${RED} ${BLUE}`, `${engine.id}: one-file texture kept as it is (${sheet})`);
  } else {
    const normal = look(join(tex, "gui/sprites/screens/same_hover_gui_0.png"));
    const highlighted = look(join(tex, "gui/sprites/screens/same_hover_gui_0_highlighted.png"));
    check(normal === `16x16 ${RED} ${RED}` && highlighted === `16x16 ${BLUE} ${BLUE}`, `${engine.id}: normal sprite top half (${normal}), highlighted bottom half (${highlighted})`);
  }
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
