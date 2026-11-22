/**
 * Q252: the template gallery of verified starters. From the welcome screen: the gallery lists the starters that passed
 * their checks, a click on a card opens New project with it, the name word shows what it will make and a bad word is
 * refused, Create makes a project with its elements and textures. In the open project: New element > From a starter
 * adds another starter with its own name word, refuses a taken name, and opens the new element. Real clicks and keys,
 * hidden window. Args: language (en|tr), theme. Screenshots go to design/252/.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, REPO, run, type App, evidence } from "./cdp.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const s = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const gallery = JSON.parse(readFileSync(join(REPO, "config", "starters", "gallery.json"), "utf8")) as { targets: string[]; starters: { id: string; verified: Record<string, { build: string; server: string }> }[] };
const listed = gallery.starters.filter((st) => gallery.targets.every((t) => st.verified[t]?.build === "pass" && st.verified[t]?.server === "pass")).map((st) => st.id);
const parent = mkdtempSync(join(tmpdir(), "mcedge-starters-ui-"));
mkdirSync(join(REPO, "design", "252"), { recursive: true });
const shot = (app: App, name: string) => app.shot(evidence(`design/252/${name}-${lang}-${theme}.png`));
const files = (dir: string) => readdirSync(dir).sort();
const elementFiles = (dir: string) => readdirSync(join(dir, "elements"), { recursive: true }).map(String).filter((f) => f.endsWith(".json"));

await run(async (app) => {
  assert(listed.length >= 2, `at least two starters are listed in gallery.json (${listed.join(", ")})`);
  await app.waitFor(`!!document.querySelector('[data-testid="welcome-starters"]')`);
  await app.click('[data-testid="welcome-starters"]');
  await app.waitFor(`!!document.querySelector('[data-testid="starter-gallery"] .starter-card')`);
  const cards = await app.eval<string[]>(`[...document.querySelectorAll('[data-testid="starter-gallery"] .starter-card')].map((c) => c.dataset.starter)`);
  assert(JSON.stringify(cards) === JSON.stringify(listed), `the gallery lists the verified starters (${cards.join(", ")})`);
  const title = await app.eval<string>(`document.querySelector('[data-testid="starter-gallery"] .ptitle').textContent`);
  assert(title === s["starter.title"], "the gallery title is in the UI language");
  const names = await app.eval<string[]>(`[...document.querySelectorAll('.starter-card .starter-name')].map((c) => c.textContent)`);
  assert(names.every((n, i) => n === s[`starter.${cards[i]}.name`]), `card names are translated (${names.join(", ")})`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll('.starter-card')].every((c) => c.scrollWidth <= c.clientWidth + 1)`), "no card overflows");
  await shot(app, "gallery");

  // A card opens New project with the starter.
  const first = listed[0];
  await app.click(`.starter-card[data-starter="${first}"]`);
  await app.waitFor(`!!document.querySelector('[data-testid="new-project-starter"]')`);
  assert((await app.eval<string>(`document.querySelector('[data-testid="new-project-starter"]').textContent`)).includes(s[`starter.${first}.name`]), "New project names the starter");
  assert(await app.eval<boolean>(`!document.querySelector('[data-testid="new-project"] input[name="template"]')`), "the template choice is replaced by the starter");
  await app.setValue('[data-testid="new-project"] input[name="name"]', "Starter Mod");
  await app.setValue('[data-testid="new-project"] input[name="parent"]', parent);
  const ids = await app.eval<string>(`document.querySelector('[data-testid="starter-ids"]').textContent`);
  assert(ids.length > 0, `the example ids show (${ids})`);
  await app.setValue('[data-testid="new-project"] input[name="starter-name"]', "Bad Name");
  assert(await app.eval<boolean>(`document.querySelector('[data-testid="new-project"] .dlg-buttons button[type="submit"]').disabled`), "a bad name word disables Create");
  assert((await app.eval<string>(`document.querySelector('[data-testid="starter-note"]').textContent`)) === s["starter.badName"], "the bad word is explained");
  await app.setValue('[data-testid="new-project"] input[name="starter-name"]', "topaz");
  const topazIds = await app.eval<string>(`document.querySelector('[data-testid="starter-ids"]').textContent`);
  assert(topazIds.includes("topaz") && !topazIds.includes(ids.split(", ")[0]), `the ids follow the name word (${topazIds})`);
  await shot(app, "new-project");
  await app.click('[data-testid="new-project"] .dlg-buttons button', s["newProject.create"]);
  await app.waitFor(`document.querySelectorAll(".tile").length >= 1`, 60_000);
  const dir = join(parent, "starter_mod");
  assert(existsSync(join(dir, "mcedge.json")), "the project is created");
  const textures = files(join(dir, "textures"));
  assert(textures.length >= 1 && textures.every((t) => t.includes("topaz")), `its textures are copied with the name word (${textures.join(", ")})`);
  assert(elementFiles(dir).length >= 1 && elementFiles(dir).every((f) => f.includes("topaz")), `its elements are written (${elementFiles(dir).join(", ")})`);
  await shot(app, "project");

  // New element > From a starter, with another starter; a taken name is refused.
  const second = listed[1];
  await app.click(".abtn", s["action.new"]);
  await app.waitFor(`!!document.querySelector('[data-testid="new-from-starter"]')`);
  await shot(app, "new-popup");
  await app.click('[data-testid="new-from-starter"]');
  await app.waitFor(`!!document.querySelector('.starterstep .starter-card')`);
  await shot(app, "popup-gallery");
  await app.click(`.starterstep .starter-card[data-starter="${second}"]`);
  await app.waitFor(`!!document.querySelector('.starterstep input[name="starter-name"]')`);
  assert((await app.eval<string>(`document.querySelector('.starterstep input[name="starter-name"]').value`)).length > 0, "the example name word is filled in");
  await app.setValue('.starterstep input[name="starter-name"]', "onyx");
  assert(await app.eval<boolean>(`!document.querySelector('.starterstep button[type="submit"]').disabled`), "a free name can be added");
  await shot(app, "popup-name");
  await app.key("Enter");
  await app.waitFor(`!document.querySelector(".addpop")`, 30_000);
  const added = elementFiles(dir).filter((f) => f.includes("onyx"));
  assert(added.length >= 1, `the second starter's elements are written (${added.join(", ")})`);
  assert(files(join(dir, "textures")).some((t) => t.includes("onyx")), "the second starter's textures are copied");
  // The new element opens in a tab, named from the filled name word (no placeholder left in it).
  await app.waitFor(`!!document.querySelector(".edtab.on")`, 15_000);
  const tab = await app.eval<string>(`document.querySelector(".edtab.on .etname").textContent`);
  assert(tab.toLowerCase().includes("onyx") && !tab.includes("{{"), `the added element is open with its filled name (${tab})`);
  await shot(app, "added");

  // The same starter with the same name again is refused before anything is written.
  await app.click(".edtab.section");
  await app.click(".abtn", s["action.new"]);
  await app.click('[data-testid="new-from-starter"]');
  await app.waitFor(`!!document.querySelector('.starterstep .starter-card')`);
  await app.click(`.starterstep .starter-card[data-starter="${second}"]`);
  await app.setValue('.starterstep input[name="starter-name"]', "onyx");
  assert(await app.eval<boolean>(`document.querySelector('.starterstep button[type="submit"]').disabled`), "a name that is taken disables Add");
  assert((await app.eval<string>(`document.querySelector('[data-testid="starter-note"]').textContent`)).includes("onyx"), "the taken id is named");
  await shot(app, "popup-taken");
  await app.key("Escape");
  console.log(`${lang} ${theme}: starter gallery from the welcome screen and New element`);
}, { language: lang, theme });
