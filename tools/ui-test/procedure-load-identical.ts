/**
 * KUYRUK 188: the editor's faster program load (procedures/fastLoad.ts) must give the same workspace as Blockly's own
 * load. For real ETREconomy procedures (a copy) it loads the editor's program state again with plain
 * Blockly.serialization.workspaces.load into a second workspace, then compares the saved state (block ids left out,
 * shadows included) and every block's position and size after rendering (with the editor's warning icons on both).
 *
 *   npm run build:app && node tools/ui-test/procedure-load-identical.ts [procedureId ...]
 */
import { assert, copyProject, run, type App } from "./cdp.ts";

const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : ["kullanicigui_while_this_g_u_i_is_open_tick", "jobselect1", "industrialovenoff_update_tick", "filesearchandopen", "goldsellerleftclick"];
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");

async function open(app: App, id: string) {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelector(".tile")`, 30000);
  await app.setValue(".view input", id);
  await app.waitFor(`[...document.querySelectorAll(".tile")].some((t) => t.textContent.trim() === ${JSON.stringify(id)}) || document.querySelectorAll(".tile").length === 1`, 8000);
  await app.eval(`([...document.querySelectorAll(".tile")].find((t) => t.textContent.trim() === ${JSON.stringify(id)}) ?? document.querySelector(".tile")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`, 120000);
}

await run(async (app) => {
  for (const id of ids) {
    await open(app, id);
    await app.sleep(500);
    const result = await app.eval<{ blocks: number; shadows: number; stateSame: boolean; firstDiff: string; geometryDiffs: number; sample: string; respawned: string; respawnSame: boolean }>(`(async () => {
      const host = document.querySelector(".blocklyhost");
      const Blockly = host.blockly, ws = host.blocklyWorkspace;
      const div = document.createElement("div");
      div.style.cssText = "position:fixed;left:0;top:0;width:" + host.clientWidth + "px;height:" + host.clientHeight + "px;visibility:hidden";
      document.body.appendChild(div);
      const plain = Blockly.inject(div, { renderer: "thrasos", theme: ws.getTheme(), sounds: false, trashcan: false });
      Blockly.Events.disable();
      try { Blockly.serialization.workspaces.load(host.blocklyLoaded, plain, { recordUndo: false }); } finally { Blockly.Events.enable(); }
      // The editor shows the program's warnings on its blocks; the same icons on the plain copy, so sizes compare.
      const mine = ws.getAllBlocks(true), theirs = plain.getAllBlocks(true);
      Blockly.Events.disable();
      try {
        mine.forEach((x, i) => { const w = x.getIcon(Blockly.icons.IconType.WARNING); if (w && theirs[i]) theirs[i].setWarningText(w.getText()); });
      } finally { Blockly.Events.enable(); }
      await Blockly.renderManagement.finishQueuedRenders();
      const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id").map(([k, x]) => [k, strip(x)])) : v;
      const a = JSON.stringify(strip(Blockly.serialization.workspaces.save(ws)));
      const b = JSON.stringify(strip(Blockly.serialization.workspaces.save(plain)));
      let at = 0;
      while (at < a.length && a[at] === b[at]) at++;
      const geometry = (w) => w.getAllBlocks(true).map((x) => { const p = x.getRelativeToSurfaceXY(); return [x.type, x.isShadow(), Math.round(p.x * 100), Math.round(p.y * 100), Math.round(x.width * 100), Math.round(x.height * 100)].join(","); });
      const ga = geometry(ws), gb = geometry(plain);
      let diffs = Math.abs(ga.length - gb.length);
      for (let i = 0; i < Math.min(ga.length, gb.length); i++) if (ga[i] !== gb[i]) diffs++;
      const result = { blocks: ga.length, shadows: ws.getAllBlocks(false).filter((x) => x.isShadow()).length, stateSame: a === b,
        firstDiff: a === b ? "" : a.slice(Math.max(0, at - 80), at + 80) + " | " + b.slice(Math.max(0, at - 80), at + 80), geometryDiffs: diffs, sample: ga[Math.floor(ga.length / 2)] };
      // Taking a real block off an input brings back its shadow (the input's default), the same in both.
      const covered = (w) => w.getAllBlocks(true).findIndex((x) => !x.isShadow() && x.outputConnection?.targetConnection?.getShadowState());
      const index = covered(ws);
      const respawn = (w) => {
        const block = w.getAllBlocks(true)[index], input = block.outputConnection.targetConnection;
        Blockly.Events.disable();
        try { block.unplug(); } finally { Blockly.Events.enable(); }
        return JSON.stringify(strip(Blockly.serialization.blocks.save(input.targetBlock())));
      };
      result.respawned = index >= 0 && index === covered(plain) ? respawn(ws) : "";
      result.respawnSame = result.respawned !== "" && result.respawned === respawn(plain);
      plain.dispose();
      div.remove();
      return result;
    })()`);
    console.log(id, JSON.stringify(result));
    assert(result.stateSame, `${id}: saved state differs: ${result.firstDiff}`);
    assert(result.respawnSame, `${id}: the shadow brought back under a removed block differs`);
    assert(result.geometryDiffs === 0, `${id}: ${result.geometryDiffs} blocks placed or sized differently`);
    await app.click("button.abtn", "Back").catch(() => app.key("Escape"));
    await app.sleep(500);
  }
}, { project });
