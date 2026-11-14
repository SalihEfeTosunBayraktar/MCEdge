// KUYRUK 170: overlays on screens of any size. Generates the test project on every engine (no Gradle) and checks the
// overlay methods: ruby_hud keeps the old centred placement (cx, cy, no scaling); corner_hud places each widget from its
// anchor (a widget's own, else the overlay's "bottom"); fit_hud and fixed_hud scale the pose with the engine's pose API
// and work on the screen in canvas pixels. The anchor offsets the Java uses are the ones src/elements/overlayLayout.ts
// gives the editor and MCP (checked on a few screens at the end). Compile with tools/codegen-test/compile.ts.
// usage: node tools/codegen-test/overlay-anchor-check.ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { anchorOffset, guiScaleFor, overlayScreen } from "../../src/elements/overlayLayout.ts";

const T = import.meta.dirname;
const project = join(T, "project");
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
/** Body of one overlay method. */
const method = (code: string, id: string) => {
  const start = code.indexOf(`public static void ${id}(`);
  const end = code.indexOf("\n    }\n", start);
  return start < 0 ? "" : code.slice(start, end);
};

for (const engine of listEngines()) {
  const gen = spawnSync("node", ["src/cli.ts", "build", project, "--target", engine.id, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { check(false, `${engine.id}: generate\n${gen.stderr}`); continue; }
  const code = readFileSync(join(project, "out", engine.id, "src/main/java/dev/mcedge/wavethree/client/WavethreeModOverlays.java"), "utf8");
  const e = engine.id;
  const legacy = e === "forge-1.16.5", v26 = e.endsWith("26.3");
  const old = method(code, "ruby_hud");
  check(old.includes("int cx = w / 2 - 213, cy = h / 2 - 120;") && old.includes("cx + 4, cy + 4") && !old.includes("float s"), `${e}: ruby_hud keeps the centred placement, no scaling`);
  const corner = method(code, "corner_hud");
  check(corner.includes("int cx = w / 2 - 213, cy = h / 2 - 120, rx = w - 427, by = h - 240;"), `${e}: corner_hud declares the right and bottom origins`);
  check(corner.includes(", 4, 4, 0xFF55FF55"), `${e}: top_left label at 4, 4 from the screen corner`);
  check(corner.includes("rx + 407, by + 220"), `${e}: bottom_right image keeps its distance to the bottom right corner`);
  check(corner.includes("cx + 190, by + 200"), `${e}: a widget without an anchor follows the overlay's (bottom)`);
  const push = legacy ? "g.pushPose();\n        g.scale(s, s, 1.0F);" : v26 ? "g.pose().pushMatrix();\n        g.pose().scale(s, s);" : "g.pose().pushPose();\n        g.pose().scale(s, s, 1.0F);";
  const pop = legacy ? "g.popPose();" : v26 ? "g.pose().popMatrix();" : "g.pose().popPose();";
  const fit = method(code, "fit_hud"), fixed = method(code, "fixed_hud");
  const scaled = (m: string, s: string) => m.includes(`float s = ${s};\n        w = Math.round(w / s);\n        h = Math.round(h / s);\n        ${push}`) && m.trimEnd().endsWith(pop);
  check(scaled(fit, "Math.min(w / 427.0F, h / 240.0F)") && fit.includes("rx + 360, 4"), `${e}: fit_hud scales to the screen, anchored top right`);
  check(scaled(fixed, "3.0F / (float) mc.getWindow().getGuiScale()") && fixed.includes("cx + 200, cy + 116"), `${e}: fixed_hud draws at GUI scale 3`);
}

// The shared rule the editor and MCP use: GUI scale, screen size and offsets.
check(guiScaleFor(1920, 1080) === 4 && guiScaleFor(1280, 720) === 3 && guiScaleFor(854, 480) === 2 && guiScaleFor(1920, 1080, 2) === 2, "GUI scale as Window.calculateScale picks it");
const fhd = overlayScreen({}, 1920, 1080);
check(fhd.screenWidth === 480 && fhd.screenHeight === 270 && fhd.pixels === 4, "1920x1080 auto: 480 x 270 GUI pixels");
const br = anchorOffset("bottom_right", 480, 270), c = anchorOffset("center", 480, 270);
check(br.dx === 53 && br.dy === 30 && c.dx === 27 && c.dy === 15, "offsets: bottom right +53 +30, centre +27 +15 (w / 2 - 213)");
const fitted = overlayScreen({ scaleMode: "fit" }, 3840, 2160);
check(fitted.screenWidth === 427 && fitted.screenHeight === 240 && Math.abs(fitted.pixels - 3840 / 427) < 0.01, "fit on 3840x2160: the canvas fills the screen");
const fixedScreen = overlayScreen({ scaleMode: "fixed", fixedScale: 3 }, 1920, 1080, 2);
check(fixedScreen.pixels === 3 && fixedScreen.screenWidth === 640, "fixed 3 at GUI scale 2: 3 window pixels per canvas pixel");
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
