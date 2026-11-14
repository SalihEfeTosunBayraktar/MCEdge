// KUYRUK 182, 183: label backgrounds and alignment. Generates the test project on every engine (no Gradle) and
// reads styled_gui's screen and styled_hud's overlay method: a plain label is drawn as before; a label with a
// background fills a box (opacity as alpha, padding around the text's width and 8 pixels) before its text, inside the
// text's scaling when it is scaled. Compile with tools/codegen-test/compile.ts.
// usage: node tools/codegen-test/make.ts && node tools/codegen-test/label-style-check.ts
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";

const T = import.meta.dirname;
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
/** The statement block that draws the label whose lang key ends with `name`. */
const block = (code: string, name: string) => {
  const at = code.indexOf(`.${name}"`);
  if (at < 0) return "";
  const start = code.lastIndexOf("\n", code.lastIndexOf("\n", at) - 1);
  return code.slice(start, code.indexOf("\n        }", at) + 10);
};

for (const engine of listEngines()) {
  const e = engine.id;
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", e, "--no-gradle"], { cwd: join(T, "../.."), encoding: "utf8" });
  if (gen.status !== 0) { check(false, `${e}: generate\n${gen.stderr}`); continue; }
  const files = walk(join(T, "project/out", e, "src/main/java"));
  const screen = readFileSync(files.find((f) => f.endsWith("StyledGuiScreen.java"))!, "utf8");
  const hud = readFileSync(files.find((f) => f.endsWith("ModOverlays.java"))!, "utf8");
  const legacy = e === "forge-1.16.5";
  const fill = legacy ? "net.minecraft.client.gui.AbstractGui.fill(g, " : "g.fill(";
  const plain = screen.split("\n").find((l) => l.includes(".plain\"")) ?? "";
  check(plain.includes(legacy ? "this.font.draw(g, " : "this.font, ") && !screen.slice(screen.indexOf(".plain\"") - 200, screen.indexOf(".plain\"")).includes("labelWidth"), `${e}: a plain label is drawn as before`);
  const boxed = block(screen, "boxed");
  check(boxed.includes("int labelWidth = this.font.width(labelText);") && boxed.includes(`${fill}8 - 2, 20 - 2, 8 + labelWidth + 2, 20 + 10, 0x99000000);`)
    && boxed.indexOf("fill(") < boxed.indexOf("labelText, 8, 20"), `${e}: boxed label fills 60% black with padding 2, then draws its text`);
  const big = block(screen, "big");
  check(/scale\(2F, 2F/.test(big) && big.includes(`${fill}0 - 1, 0 - 1, 0 + labelWidth + 1, 0 + 9, 0x7F3366FF);`), `${e}: a scaled label's box is scaled with it (default opacity 50%, padding 1)`);
  // KUYRUK 183: alignment around x, measured every frame.
  const mid = block(screen, "mid");
  check(mid.includes("int labelX = 88 - labelWidth / 2;") && mid.includes(`${fill}labelX - 1, 70 - 1, labelX + labelWidth + 1, 70 + 9, 0x7F000000);`) && mid.includes("labelText, labelX, 70"), `${e}: a centred label stands around x, its box too`);
  const right = block(screen, "right");
  check(right.includes("int labelX = 168 - labelWidth;") && !right.includes("fill(") && right.includes("labelText, labelX, 90"), `${e}: a right-aligned label ends at x`);
  const bigmid = block(screen, "bigmid");
  check(/translate\(\(\w+\) \(88\), \(\w+\) \(110\)/.test(bigmid) && bigmid.includes("int labelX = 0 - labelWidth / 2;") && bigmid.includes("labelText, labelX, 0"), `${e}: a scaled centred label is centred inside its scaling`);
  const hudMid = block(hud, "hud_mid");
  check(hudMid.includes("int labelX = cx + 213 - labelWidth / 2;") && hudMid.includes("labelText, labelX, 4"), `${e}: an overlay label centred on its anchored point`);
  const hudBox = block(hud, "hud_boxed");
  check(hudBox.includes("int labelWidth = mc.font.width(labelText);") && hudBox.includes(`${fill}cx + 4 - 1, cy + 60 - 1, cx + 4 + labelWidth + 1, cy + 60 + 9, 0x7F000000);`), `${e}: overlay label with a background`);
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
