/**
 * KUYRUK 130: elements, procedures and textures opened stay as editor tabs after the section's own tab; Ctrl+W closes
 * the shown tab, the tab menu closes the others, a middle click closes one, Alt+Left / Alt+Right walk the history, and
 * the tabs come back when the project opens again. Runs on a copy of examples/hello with a procedure added.
 * Args: theme (dark/light), language (en/tr). Screenshots go to design/130/.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const project = exampleProject();
addElement(project, "procedure", "main");
const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
const shot = (app: App, name: string) => app.shot(`design/130/${name}-${theme}-${lang}-after.png`);
const tabs = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".edtabs [data-tab]")].map((t) => t.dataset.tab)`);
const active = (app: App) => app.eval<string | null>(`document.querySelector(".edtabs .edtab.on")?.dataset.tab ?? null`);
const openTile = async (app: App, id: string) => {
  await app.eval(`document.querySelectorAll(".rail .rtab")[0].click()`);
  await app.waitFor(`document.querySelector(".tiles .tile")`);
  await app.eval(`[...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => e.querySelector("code")?.textContent === ${JSON.stringify(id)}).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".edtabs .edtab.on")?.dataset.tab?.endsWith("/${id}")`, 15000);
  await app.sleep(300);
};
const ALT = 1;
const key = async (app: App, k: string, modifiers: number) => {
  await app.eval(`document.activeElement?.blur()`);
  await app.key(k, modifiers);
  await app.sleep(300);
};

let app = await launchApp({ project, theme, language: lang, userData });
try {
  await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".edtabs")`)), "no tab row before an editor opens");

  // 1. Elements, a procedure and a texture each get a tab; the section's tab shows the list again.
  await openTile(app, "ruby");
  await app.click(".edtabs .edtab.section");
  await app.waitFor(`document.querySelector(".tiles") && !document.querySelector(".edtabs .edtab.on[data-tab]")`);
  await openTile(app, "ruby_apple");
  await openTile(app, "main");
  await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
  await app.waitFor(`document.querySelector(".texcell:not(.draft)")`);
  await app.click(".texcell:not(.draft)", undefined, { double: true });
  await app.waitFor(`document.querySelector(".ptools")`, 10000);
  const four = await tabs(app);
  assert(four.length === 4 && four[0] === "element:item/ruby" && four[2] === "element:procedure/main" && four[3].startsWith("texture:"), `four tabs: ${four.join(", ")}`);
  await shot(app, "tabs-texture");

  // 2. A click on a tab shows its editor.
  await app.click(".edtabs [data-tab='element:item/ruby']");
  await app.waitFor(`document.querySelector(".edhead") && !document.querySelector(".ptools")`);
  assert(await active(app) === "element:item/ruby", "the ruby tab is shown");
  await shot(app, "tabs");

  // 3. Alt+Left / Alt+Right: ruby <- texture <- main.
  await key(app, "ArrowLeft", ALT);
  assert((await active(app))?.startsWith("texture:"), `back to the texture: ${await active(app)}`);
  await key(app, "ArrowLeft", ALT);
  assert(await active(app) === "element:procedure/main", `back to the procedure: ${await active(app)}`);
  await key(app, "ArrowRight", ALT);
  assert((await active(app))?.startsWith("texture:"), "forward to the texture");

  // 4. Ctrl+W closes the shown tab and shows its neighbour.
  await key(app, "w", 2);
  assert((await tabs(app)).length === 3 && await active(app) === "element:procedure/main", `Ctrl+W closed the texture: ${await tabs(app)} / ${await active(app)}`);

  // 5. Tab menu: Close other tabs; middle click closes one.
  await app.click(".edtabs [data-tab='element:item/ruby']", undefined, { button: "right" });
  await app.waitFor(`document.querySelector(".menulist")`);
  await shot(app, "tab-menu");
  await app.click(".menulist button", lang === "tr" ? "Diğer sekmeleri kapat" : "Close other tabs");
  await app.sleep(200);
  assert(JSON.stringify(await tabs(app)) === JSON.stringify(["element:item/ruby"]) && await active(app) === "element:item/ruby", `only ruby left: ${await tabs(app)}`);
  await openTile(app, "ruby_apple");
  await app.eval(`document.querySelector(".edtabs [data-tab='element:item/ruby_apple']").dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }))`);
  await app.sleep(200);
  assert(JSON.stringify(await tabs(app)) === JSON.stringify(["element:item/ruby"]), "middle click closed ruby_apple");
  await openTile(app, "main");
  await app.sleep(500);
} finally {
  await app.close();
}

// 6. Reopening the project brings the tabs back, the shown one active.
app = await launchApp({ project, theme, language: lang, userData });
try {
  await app.waitFor(`document.querySelectorAll(".edtabs [data-tab]").length === 2`, 30000);
  assert(JSON.stringify(await tabs(app)) === JSON.stringify(["element:item/ruby", "element:procedure/main"]), `restored: ${await tabs(app)}`);
  await app.waitFor(`document.querySelector(".edtabs .edtab.on")?.dataset.tab === "element:procedure/main"`);
  await app.sleep(500);
  await shot(app, "tabs-restored");
  console.log(`editor tabs OK (${theme}, ${lang})`);
  console.log("PASS");
} catch (error) {
  console.error("FAIL", error);
  await app.shot("tools/ui-test/last-failure.png");
  process.exitCode = 1;
} finally {
  await app.close();
}
