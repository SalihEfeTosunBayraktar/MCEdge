/**
 * Q212: the status bubble blocks (Q206) are visible in the app: the Bubbles category of the procedure toolbox (with a
 * help line) and the block search offer them, player_bubble_show comes with a bubble icon block whose list holds the
 * project's textures/bubbles PNGs, and Resources > Textures shows the Bubble icons folder with its PNG, an Add bubble
 * icon import and Delete. English and Turkish, dark and light; screenshots go to design/212/.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/212");
mkdirSync(OUT, { recursive: true });
const en = JSON.parse(readFileSync("config/ui-strings/en.json", "utf8")) as Record<string, string>;
const tr = JSON.parse(readFileSync("config/ui-strings/tr.json", "utf8")) as Record<string, string>;

/** A fresh project per language run: the procedure is saved as the test edits it. */
function makeProject(): { project: string; wave: string } {
  const project = exampleProject();
  mkdirSync(join(project, "textures", "bubbles"), { recursive: true });
  copyFileSync(join(project, "textures", "ruby.png"), join(project, "textures", "bubbles", "trade.png"));
  // A PNG outside textures/, the one the mocked import dialog "picks".
  const wave = join(project, "wave.png");
  copyFileSync(join(project, "textures", "ruby_apple.png"), wave);
  addElement(project, "procedure", "main", {
    program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }] }] },
  });
  return { project, wave };
}

const WS = `document.querySelector(".blocklyhost").blocklyWorkspace`;
const flyoutTypes = (app: App) => app.eval<string[]>(`${WS}.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).map((b) => b.type)`);
const slowDrag = async (app: App, from: [number, number], to: [number, number]) => {
  await app.mouse("mouseMoved", from[0], from[1], 0);
  await app.mouse("mousePressed", from[0], from[1]);
  for (let i = 1; i <= 20; i++) (await app.mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20, 1), await app.sleep(15));
  await app.mouse("mouseReleased", to[0], to[1], 0);
  await app.sleep(400);
};

for (const language of ["en", "tr"] as const) {
  const s = language === "en" ? en : tr;
  const category = language === "en" ? "Bubbles" : "Baloncuklar";
  const { project, wave } = makeProject();
  const app = await launchApp({ project, language, width: 1440, height: 900 });
  try {
    await app.waitFor(`document.querySelector(".tile")`);
    await app.click(".tile", "main", { double: true });
    await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);

    // The category is in the toolbox with its help line and the three blocks (and the icon block).
    const categories = await app.eval<string[]>(`[...document.querySelectorAll(".blocklyToolboxCategory")].map((c) => c.textContent)`);
    assert(categories.includes(category), `${language}: the ${category} category is listed: ${categories}`);
    await app.click(".blocklyToolboxCategory", category);
    await app.sleep(400);
    const types = await flyoutTypes(app);
    for (const id of ["player_bubble_show", "player_bubble_clear", "player_bubble_icon"]) assert(types.includes(id), `${language}: ${id} is in the category: ${types}`);
    const help = await app.eval<string>(`document.querySelector(".blocklyFlyout")?.textContent ?? ""`);
    assert(help.includes(language === "en" ? "above a player's head" : "kafasının üstünde"), `${language}: the category shows its help line`);

    // The block search finds them.
    await app.eval(`document.querySelector(".procsearch input").focus()`);
    await app.setValue(".procsearch input", language === "en" ? "bubble" : "baloncuk");
    await app.sleep(500);
    const found = await flyoutTypes(app);
    assert(found.includes("player_bubble_show") && found.includes("player_bubble_clear") && found.includes("player_bubble_icon"), `${language}: the search finds the blocks: ${found}`);
    await app.setValue(".procsearch input", "");
    await app.sleep(300);

    // player_bubble_show dragged into the procedure comes with the bubble icon block, listing the project's icons.
    await app.click(".blocklyToolboxCategory", category);
    await app.sleep(400);
    const from = await app.eval<[number, number]>(`(() => { const b = ${WS}.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).find((b) => b.type === "player_bubble_show"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 30, r.y + 8]; })()`);
    const to = await app.eval<[number, number]>(`(() => { const b = ${WS}.getTopBlocks(false).find((b) => b.type === "start"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 40, r.bottom + 14]; })()`);
    await slowDrag(app, from, to);
    const shown = await app.eval<{ chain: string[]; icon: string | null; list: string[] }>(`(() => {
      const out = { chain: [], icon: null, list: [...document.querySelectorAll("#ref-bubble option")].map((o) => o.value) };
      for (let b = ${WS}.getTopBlocks(false).find((b) => b.type === "start"); b; b = b.getNextBlock()) {
        out.chain.push(b.type);
        if (b.type === "player_bubble_show") out.icon = b.getInputTargetBlock("icon")?.type ?? null;
      }
      return out;
    })()`);
    assert(shown.chain.join() === "start,player_bubble_show", `${language}: the block was added: ${shown.chain}`);
    assert(shown.icon === "bubble_icon", `${language}: the icon input holds the bubble icon block: ${shown.icon}`);
    assert(shown.list.join() === "trade", `${language}: the icon list holds the project's bubble PNGs: ${shown.list}`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(500);
      await app.shot(`${OUT}/procedure-${language}-${theme}.png`);
    }
    await app.setTheme("dark");
    await app.click(".blocklyToolboxCategory", category);
    await app.sleep(400);
    await app.shot(`${OUT}/toolbox-${language}-dark.png`);
    await app.setTheme("light");
    await app.sleep(400);
    await app.shot(`${OUT}/toolbox-${language}-light.png`);
    await app.setTheme("dark");

    // Resources > Textures: the Bubble icons folder with its PNG, add and delete.
    await app.click(".abtn", s["editor.back"]);
    await app.click(".rtab", language === "en" ? "Resources" : "Kaynaklar");
    await app.waitFor(`document.querySelector('.tgroup[data-group="bubbles"]')`, 15000);
    const group = (extra: string) => `document.querySelector('.tgroup[data-group="bubbles"] ${extra}')`;
    assert(await app.eval<string>(`${group(".gtitle")}.textContent`) === s["resources.bubbleIcons"], `${language}: the folder is titled ${s["resources.bubbleIcons"]}`);
    assert(await app.eval<string>(`${group(".hint")}.textContent`) === s["resources.bubblesHint"], `${language}: the folder explains itself`);
    assert(await app.eval<boolean>(`!!${group('.texcell[data-path="textures/bubbles/trade.png"]')}`), `${language}: trade.png is shown in the folder`);
    await app.shot(`${OUT}/resources-${language}-dark.png`);
    await app.setTheme("light");
    await app.sleep(300);
    await app.shot(`${OUT}/resources-${language}-light.png`);
    await app.setTheme("dark");

    await app.mockDialogs({ open: [wave] });
    await app.click(".abtn", s["resources.import"]);
    await app.click(".menulist button", s["resources.addBubble"]);
    await app.waitFor(`!!${group('.texcell[data-path="textures/bubbles/wave.png"]')}`, 10000);
    assert(await app.eval<number>(`document.querySelectorAll('.tgroup[data-group="bubbles"] .texcell').length`) === 2, `${language}: the imported icon joins the folder`);

    await app.eval(`${group('.texcell[data-path="textures/bubbles/wave.png"]')}.click()`);
    await app.click(".abtn", s["resources.delete"]);
    await app.waitFor(`!${group('.texcell[data-path="textures/bubbles/wave.png"]')}`, 10000);
    assert(await app.eval<boolean>(`!!${group('.texcell[data-path="textures/bubbles/trade.png"]')}`), `${language}: only the deleted icon is gone`);
  } finally {
    await app.close();
  }
}
console.log("PASS bubbles-ui");
