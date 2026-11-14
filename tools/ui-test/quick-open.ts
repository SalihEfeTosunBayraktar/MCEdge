/**
 * KUYRUK 136: Ctrl+K quick open over the whole project, on a copy of ETREconomy plus a sound and a tag (ETR has
 * neither): elements, textures, sounds, lang keys, variables and tags are found, and Enter opens each where it lives.
 * Keys go through CDP. Args: theme (dark/light), language (en/tr). Screenshots go to design/136/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, copyProject, REPO, run, type App } from "./cdp.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");
mkdirSync(join(project, "sounds"), { recursive: true });
writeFileSync(join(project, "sounds", "coin_drop.ogg"), Buffer.from("OggS"));
writeFileSync(join(project, "tags.json"), JSON.stringify({ tags: [{ type: "item", id: "etreco:coins", entries: [] }] }, null, 2));
const shot = (app: App, name: string) => app.shot(`design/136/${name}-${theme}-${lang}-after.png`);
const CTRL = 2;

/** Opens quick open, types, waits for the first hit of `kind` naming `target`, and opens it with Up/Down and Enter. */
async function go(app: App, query: string, kind: string, target: string, name?: string) {
  await app.eval(`document.activeElement?.blur()`);
  await app.key("k", CTRL);
  await app.waitFor(`document.querySelector(".quickopen input") === document.activeElement`);
  await app.type(query);
  const hit = `[...document.querySelectorAll(".quickrow")].findIndex((r) => r.dataset.kind === ${JSON.stringify(kind)} && r.dataset.target === ${JSON.stringify(target)})`;
  await app.waitFor(`${hit} >= 0`);
  if (name) await shot(app, name);
  const index = await app.eval<number>(hit);
  for (let i = 0; i < index; i++) await app.key("ArrowDown");
  await app.key("Enter");
  await app.waitFor(`!document.querySelector(".quickopen")`);
  await app.sleep(400);
}
const findValue = (app: App) => app.eval<string>(`document.querySelector(".view .findbar input")?.value ?? ""`);

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);

  // The empty dialog says how many things it searches; Escape closes it.
  await app.key("k", CTRL);
  await app.waitFor(`document.querySelector(".quickopen .quickhint")`);
  await shot(app, "quick-open-empty");
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".quickopen")`);

  // Element: opens its editor tab.
  await go(app, "vending machine", "element", "block/wending_machine", "quick-open-element");
  assert(await app.eval<boolean>(`document.querySelector(".edtabs .edtab.on")?.dataset.tab === "element:block/wending_machine"`), "the element opened in its editor");

  // Texture: opens the texture editor.
  await go(app, "adminbook", "texture", "textures/items/adminbook.png");
  await app.waitFor(`document.querySelector(".ptools")`, 10000);

  // Variable, lang key, tag, sound: their section, searched for the result.
  await go(app, "altinfiyat", "variable", "altinfiyat");
  await app.waitFor(`document.querySelector(".view .findbar input")?.value === "altinfiyat"`);
  assert((await app.eval<number>(`document.querySelectorAll(".view .grid tbody tr").length`)) >= 1, "the variable is listed");
  await go(app, "AdminBookSalary", "langKey", "AdminBookSalary", "quick-open-langkey");
  await app.waitFor(`document.querySelector(".view .findbar input")?.value === "AdminBookSalary"`);
  await shot(app, "quick-open-localization");
  await go(app, "coins", "tag", "item:etreco:coins");
  assert((await findValue(app)) === "etreco:coins", `tags searched: ${await findValue(app)}`);
  await go(app, "coin_drop", "sound", "sounds/coin_drop.ogg");
  assert((await findValue(app)) === "coin_drop", `sounds searched: ${await findValue(app)}`);
  console.log(`quick open OK (${theme}, ${lang})`);
}, { project, theme, language: lang });
