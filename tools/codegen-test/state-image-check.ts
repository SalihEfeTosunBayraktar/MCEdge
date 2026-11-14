// KUYRUK 186: state images. Generates the test project on every engine (no Gradle) and reads state_gui's screen and
// state_hud's overlay method: each state is its own copied texture; a number procedure picks the state by index (kept
// inside the list) or by percentage; without one the first state whose condition holds, a state without one always
// does; updateTicks reads the state once every N ticks; restartAnimation plays from when the state was entered; a
// fixed frame draws one frame of a strip, still. Compile with tools/codegen-test/compile.ts.
// usage: node tools/codegen-test/make.ts && node tools/codegen-test/state-image-check.ts
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";

const T = import.meta.dirname;
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
/** The method `name` of a class, up to its closing brace at 4 spaces. */
const method = (code: string, name: string) => {
  const at = code.indexOf(` int ${name}() {`);
  return at < 0 ? "" : code.slice(at, code.indexOf("\n    }", at));
};
/** The drawing block of a state image: from its state read to the end of its if / else chain. */
const drawing = (code: string, call: string) => {
  const at = code.indexOf(`int state = ${call}();`);
  // 1.16.5 binds the texture on the line before its blit: one line each, so a state reads the same on every engine.
  return at < 0 ? "" : code.slice(at, code.indexOf("\n        }", at)).replace(/\.png"\)\);\s*/g, '.png")); ');
};

for (const engine of listEngines()) {
  const e = engine.id;
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", e, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { check(false, `${e}: generate\n${gen.stderr}`); continue; }
  const out = join(T, "project/out", e);
  const files = walk(join(out, "src/main/java"));
  const screen = readFileSync(files.find((f) => f.endsWith("StateGuiScreen.java"))!, "utf8");
  const hud = readFileSync(files.find((f) => f.endsWith("ModOverlays.java"))!, "utf8");
  const legacy = e === "forge-1.16.5";
  const screens = join(out, "src/main/resources/assets/wavethree/textures/screens");
  check(["state_gui_0_s0", "state_gui_0_s1", "state_gui_0_s2", "state_gui_1_s0", "state_gui_1_s1", "state_gui_2_s2", "state_hud_0_s1", "state_hud_1_s1"].every((n) => existsSync(join(screens, `${n}.png`)))
    && existsSync(join(screens, "state_gui_0_s1.png.mcmeta")), `${e}: every state's texture is copied (an animated one with its .mcmeta)`);

  const byIndex = method(screen, "widget0State");
  check(byIndex.includes("int next = Math.max(0, Math.min(2, (int) Math.floor((dev.mcedge.wavethree.procedures.BeastScaleProcedure.execute()))));") && !byIndex.includes("Read"),
    `${e}: a number procedure picks the state by index, kept inside the 3 states, read every frame`);
  const draw0 = drawing(screen, "this.widget0State");
  const blit = legacy ? "net.minecraft.client.gui.AbstractGui.blit(g, " : "g.blit(";
  /** A blit's position, drawn size and v, in the order of the engine's method (1.16.5: size before u, v). */
  const blitArgs = (x: string, y: string, w: number, h: number, v: string) => (legacy ? `${x}, ${y}, ${w}, ${h}, 0.0F, ${v}` : `${x}, ${y}, 0.0F, ${v}, ${w}, ${h}`);
  check(draw0.includes(`${blit}`) && draw0.includes("state_gui_0_s0.png") && draw0.includes("if (state == 2)")
    && draw0.includes(`state_gui_0_s1.png")${legacy ? "); net.minecraft.client.gui.AbstractGui.blit(g" : ""}, ${blitArgs("this.leftPos + 8", "this.topPos + 8", 16, 16, "(float) (((System.currentTimeMillis() / 200L) % 3L) * 16)")}, 16, 16, 16, 48);`)
    && draw0.includes(`, ${blitArgs("this.leftPos + 8", "this.topPos + 8", 16, 16, "32.0F")}, 16, 16, 16, 48);`), `${e}: states drawn by number; the .mcmeta one plays, the fixed frame 2 is still at v 32`);

  const byPercent = method(screen, "widget1State");
  check(byPercent.includes("now - widget1Read >= 500L") && byPercent.includes("(dev.mcedge.wavethree.procedures.FuelTimeProcedure.execute()) * 2 / 100.0") && byPercent.includes("Math.min(1, "),
    `${e}: a percentage spreads over the 2 states, read every 10 ticks (500 ms)`);
  const draw1 = drawing(screen, "this.widget1State");
  check(draw1.includes("((System.currentTimeMillis() - this.widget1Since) / 200L) % 3L") && draw1.includes(`, ${blitArgs("30", "8", 32, 32, "(float) ((((System.currentTimeMillis() - this.widget1Since) / 200L) % 3L) * 16)")}, 16, 16, 16, 48);`),
    `${e}: restartAnimation plays from when the state was entered; z 2 draws in the front pass, scaled to 32x32`);
  // Front pass: renderLabels (26.x: extractLabels, then extractContents).
  const front = screen.slice(Math.max(screen.indexOf("void renderLabels("), screen.indexOf("void extractLabels(")));
  check(front.includes("this.widget1State()") && !front.includes("this.widget0State()"), `${e}: z > 0 in the front pass, z 0 in the background`);

  const byCondition = method(screen, "widget2State");
  check(byCondition.includes("int next = dev.mcedge.wavethree.procedures.NeverProcedure.execute() ? 0 : dev.mcedge.wavethree.procedures.AlwaysProcedure.execute() ? 1 : 2;"),
    `${e}: without a procedure, the first state whose condition holds; a state without one always does`);
  const at2 = screen.indexOf("int state = this.widget2State();");
  check(at2 > 0 && screen.lastIndexOf("if (dev.mcedge.wavethree.procedures.AlwaysProcedure.execute()) {", at2) > screen.lastIndexOf("int state = this.widget0State();", at2),
    `${e}: the widget's own condition wraps its drawing`);

  const hud0 = method(hud, "state_hud0State");
  check(hud.includes("private static int state_hud0Shown = -1;") && hud0.includes("NeverProcedure.execute() ? 0 : dev.mcedge.wavethree.procedures.AlwaysProcedure.execute() ? 1 : -1;"),
    `${e}: overlay state kept in static fields; no state holding: -1, nothing drawn`);
  const hud1 = method(hud, "state_hud1State");
  check(hud1.includes("now - state_hud1Read >= 250L") && drawing(hud, "state_hud1State").includes(`, ${blitArgs("24", "cy + 100", 16, 16, "16.0F")}, 16, 16, 16, 48);`),
    `${e}: overlay state read every 5 ticks, anchored left, frame 1 of the strip`);
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
