/**
 * KUYRUK 131: locked generated code in the app. On a copy of examples/hello: the element menu locks the Ruby item,
 * its tile shows the lock, Build & run > Regenerate code keeps the locked files; after a hand edit in locked-code/,
 * Unlock shows the lines it would lose and Escape keeps the lock; confirming unlocks. Args: language (en|tr), theme.
 * Screenshots go to design/131/.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const s = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const project = exampleProject();
const shot = (app: App, name: string) => app.shot(evidence(`design/131/${name}-${lang}-${theme}.png`));
const rubyTile = `[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname")?.textContent === "Ruby" || t.textContent.includes("ruby") && t.querySelector("code")?.textContent === "ruby")`;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const lockedTile = `!!(${rubyTile})?.querySelector('[data-testid="tile-locked"]')`;
const openMenu = async (app: App) => {
  await app.eval(`(() => { const t = ${rubyTile}; const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.x + 20, clientY: r.y + 10 })); })()`);
  await app.sleep(200);
};

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`!!(${rubyTile})`);

  // Lock from the element menu.
  await openMenu(app);
  await app.click(".menulist button", s["lock.lock"]);
  await app.waitFor(lockedTile, 180_000);
  assert(existsSync(join(project, "locked-code", "item", "ruby")), "the menu locked item/ruby into locked-code/");
  await shot(app, "tile-locked");

  // Build & run > Regenerate code keeps the locked files.
  await app.click(".menu", s["menu.buildRun"]);
  await app.click(".menulist button", s["menu.regenerate"]);
  await app.waitFor(`(document.querySelector(".bottom-panel pre.log")?.textContent ?? "").includes("regenerated out/")`, 120_000);
  const log = await app.eval<string>(`document.querySelector(".bottom-panel pre.log").textContent`);
  assert(log.includes("locked: item/ruby keeps"), "Regenerate code reports the locked files");
  await shot(app, "regenerate");

  // A hand edit, then Unlock shows what it would lose.
  const file = walk(join(project, "locked-code", "item", "ruby")).find((f) => f.endsWith("RubyItem.java"))!;
  const text = readFileSync(file, "utf8");
  writeFileSync(file, `${text.slice(0, text.lastIndexOf("}"))}    public static int handEdited() { return 42; }\n}\n`);
  await openMenu(app);
  await app.click(".menulist button", s["lock.unlock"]);
  await app.waitFor(`!!document.querySelector('[data-testid="unlock-diff"]')`, 120_000);
  const diff = await app.eval<string>(`document.querySelector('[data-testid="unlock-diff"]').textContent`);
  assert(diff.includes("handEdited"), "the unlock dialog lists the edited line");
  assert(await app.eval<boolean>(`document.activeElement?.closest(".dialog") != null && !document.activeElement.classList.contains("danger")`), "the dialog takes the focus, not on the destructive button");
  await shot(app, "unlock-dialog");
  await app.key("Escape");
  await app.sleep(300);
  assert(await app.eval<boolean>(`!document.querySelector('[data-testid="unlock-diff"]')`) && existsSync(file), "Escape keeps the lock and the edit");
  assert(await app.eval<boolean>(lockedTile), "the tile still shows the lock");

  await openMenu(app);
  await app.click(".menulist button", s["lock.unlock"]);
  await app.waitFor(`!!document.querySelector('[data-testid="unlock-diff"]')`, 120_000);
  await app.click(".dialog .dlg-buttons button", s["lock.unlockConfirm"]);
  await app.waitFor(`!(${lockedTile})`, 120_000);
  assert(!existsSync(join(project, "locked-code")), "confirming unlocks and removes the locked files");
  await shot(app, "tile-unlocked");
  console.log(`${lang} ${theme}: lock, regenerate, unlock with diff`);
}, { project, language: lang });
