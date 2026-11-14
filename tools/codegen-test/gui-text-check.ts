// KUYRUK 105: a GUI label whose text procedure has a server-side block (ETR new_jobs_ui: player_number_set inside an if
// with the return) used to run on the client, send its server part as a packet every frame and show "". Now the
// procedure runs on the server: the menu computes the text in its guarded tick, sends it only when it changes
// (GuiTextSync), and the screen reads what arrived. Labels without server blocks still run on the client each frame.
// Generates the test project (no Gradle) on every engine. Run tools/codegen-test/make.ts first when spec.ts changed.
// usage: node tools/codegen-test/gui-text-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dirname;
const ROOT = join(T, "../..");
const spec = JSON.parse(readFileSync(join(T, "project/elements/guis/ruby_gui.json"), "utf8")) as { components: { kind: string; textProcedure?: string }[] };
const index = spec.components.findIndex((w) => w.textProcedure === "server_label_text");
assert.ok(index >= 0, "ruby_gui has the server label");
for (const engine of ["forge-1.16.5", "neoforge-1.21.5", "neoforge-26.3", "fabric-1.21.5", "fabric-26.3"]) {
  const gen = spawnSync("node", ["src/cli.ts", "build", join(T, "project"), "--target", engine, "--no-gradle"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(gen.status, 0, `${engine}: generate failed\n${gen.stdout}${gen.stderr}`);
  const out = join(T, "project/out", engine, "src/main/java/dev/mcedge/wavethree");
  const read = (path: string) => readFileSync(join(out, path), "utf8");
  const procedure = read("procedures/ServerLabelTextProcedure.java");
  assert.ok(!/toServer\(/.test(procedure), `${engine}: the text procedure sends no packet`);
  assert.ok(/set_wallet\(entity, 7\.0\);\s*if \(true\) return \(/.test(procedure), `${engine}: the server statement and the return run together on the server`);
  const menu = read("world/inventory/RubyGuiMenu.java");
  const tick = menu.slice(menu.indexOf("public void broadcastChanges()"), menu.indexOf("} finally {"));
  assert.ok(/if \(this\.world\.isClientSide\(\) \|\| this\.ticking\) return;/.test(tick), `${engine}: computed on the server only, behind the tick guard`);
  assert.ok(tick.includes(`this.syncText(${index}, String.valueOf(dev.mcedge.wavethree.procedures.ServerLabelTextProcedure.execute(`), `${engine}: the menu computes the text`);
  assert.ok(/if \(text\.equals\(this\.sentText\.put\(index, text\)\)\) return;\s*\S+\.toPlayer\(this\.entity, new \S+\.GuiTextSync\(this\.containerId, index, text\)\);/.test(menu), `${engine}: sent only when it changes`);
  const screen = read("client/gui/RubyGuiScreen.java");
  assert.ok(screen.includes(`WavethreeModGuiText.text(this.menu.containerId, ${index})`), `${engine}: the screen shows the synced text`);
  assert.ok(!screen.includes("ServerLabelTextProcedure"), `${engine}: the screen does not call the server procedure`);
  assert.ok(screen.includes("GuiPosLabelProcedure.execute("), `${engine}: a client-only label still runs on the client`);
  assert.ok(/handleGuiTextSync/.test(read("procedures/client/WavethreeModNetworkClient.java")), `${engine}: the client handles the packet`);
  assert.ok(/public static String text\(int menu, int index\)/.test(read("procedures/client/WavethreeModGuiText.java")), `${engine}: client text store`);
}
console.log("gui-text-check OK");
