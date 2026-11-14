/**
 * KUYRUK 125 (audit U8, U12): every element editor offers Duplicate and Delete the same way (the Element menu), and
 * every dialog takes the focus when it opens, so Escape closes it at once (Export mod jar included). Creates one element
 * of every type in a copy of examples/hello. Args: theme, suffix ("before" records every failed check and fails at the
 * end). Screenshots go to design/125/.
 */
import { typeRegistry } from "../../src/elements/registry.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const suffix = process.argv[3] ?? "after";
const project = exampleProject();
for (const type of typeRegistry().types) {
  try {
    addElement(project, type.id, `focus_${type.id}`);
  } catch {
    // A type the fixture cannot create stays out.
  }
}
const failed: string[] = [];
const check = (ok: unknown, message: string) => (suffix === "before" ? ok || failed.push(message) : assert(ok, message));
const shot = (app: App, name: string) => app.shot(`design/125/${name}-${theme}-${suffix}.png`);
const home = async (app: App) => {
  await app.eval(`document.querySelector(".rail .rtab").click()`);
  await app.waitFor(`document.querySelector(".tiles")`);
};

/** Opens a dialog, checks the focus is inside it and that Escape closes it. */
async function dialog(app: App, name: string, open: () => Promise<void>, selector = ".dialog") {
  await open();
  await app.waitFor(`document.querySelector(${JSON.stringify(selector)})`, 10000);
  await app.sleep(150);
  const inside = await app.eval<boolean>(`document.querySelector(${JSON.stringify(selector)}).contains(document.activeElement)`);
  check(inside, `${name}: the dialog takes the focus`);
  if (name === "Export mod jar") await shot(app, "export-jar");
  await app.key("Escape");
  await app.sleep(250);
  const closed = await app.eval<boolean>(`!document.querySelector(${JSON.stringify(selector)})`);
  check(closed, `${name}: Escape closes it`);
  // Leave nothing open for the next case.
  if (!closed) await app.eval(`[...document.querySelectorAll(".dialog button")].find((b) => /^(Cancel|Close)$/.test(b.textContent.trim()))?.click()`);
  await app.sleep(150);
  console.log(`${name}: focus inside ${inside}, closed by Escape ${closed}`);
}

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelectorAll(".tile").length > 10`, 20000);

  // 1. The same element actions in every editor: the Element menu, no loose Duplicate/Delete buttons.
  const tiles = await app.eval<number>(`document.querySelectorAll(".tile:not(.foldertile)").length`);
  const loose: string[] = [];
  for (let i = 0; i < tiles; i++) {
    await home(app);
    const name = await app.eval<string>(`(() => { const t = document.querySelectorAll(".tile:not(.foldertile)")[${i}]; t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return t.querySelector(".tname").textContent; })()`);
    await app.waitFor(`document.querySelector(".edhead")`, 15000);
    const m = await app.eval<{ menu: boolean; buttons: string[] }>(`({ menu: !!document.querySelector(".view .elementmenu"),
      buttons: [...document.querySelectorAll(".view .actions .abtn")].map((b) => b.textContent).filter((l) => /^(Duplicate|Delete)$/.test(l)) })`);
    if (!m.menu || m.buttons.length) loose.push(`${name}${m.buttons.length ? ` (${m.buttons.join(", ")})` : " (no Element menu)"}`);
    if (name === "Ruby Apple") await shot(app, "editor-item");
  }
  console.log(`editors without the Element menu or with loose buttons: ${loose.length}`);
  check(loose.length === 0, `every editor uses the Element menu: ${loose.join("; ")}`);
  // The menu works in a form editor: Duplicate makes a copy.
  await home(app);
  await app.eval(`[...document.querySelectorAll(".tile:not(.foldertile)")].find((t) => t.textContent.includes("Ruby Apple")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".edhead")`);
  if (await app.eval<boolean>(`!!document.querySelector(".view .elementmenu")`)) {
    await app.click(".view .elementmenu .abtn");
    await shot(app, "element-menu");
    await app.click(".elementmenu .menulist button", "Duplicate");
    await app.waitFor(`document.querySelector(".edname")?.textContent.includes("Ruby Apple")`);
  }

  // 2. Dialogs take the focus; Escape closes them.
  await home(app);
  await dialog(app, "Export mod jar", () => app.key("e", 2));
  await dialog(app, "Rename", async () => {
    await app.click(".tile:not(.foldertile)", "Ruby", { button: "right" });
    await app.click(".menulist.ctx button", "Rename");
  });
  await dialog(app, "Usages", async () => {
    await app.click(".tile:not(.foldertile)", "Ruby", { button: "right" });
    await app.click(".menulist.ctx button", "Usages");
  });
  await dialog(app, "New texture", async () => {
    await app.click(".rtab", "Resources");
    await app.eval(`document.querySelector(".view [role=tab]").click()`);
    await app.click(".view .actions .abtn.primary");
  });
  await dialog(app, "New key", async () => {
    await app.click(".rtab", "Localization");
    await app.click(".view .actions .abtn.primary");
  });
  await dialog(app, "Change id and package", async () => {
    await app.click(".rtab", "Workspace settings");
    await app.click(".view .actions .abtn.primary");
  });
  await dialog(app, "Preferences", async () => {
    await app.eval(`document.querySelectorAll(".menubar .menus .menu")[5].click()`);
    await app.click(".menulist [role=menuitem]", "Preferences");
  });
  await dialog(app, "About", async () => {
    await app.eval(`document.querySelectorAll(".menubar .menus .menu")[6].click()`);
    await app.click(".menulist [role=menuitem]", "About");
  });
  assert(failed.length === 0, `failed checks: ${failed.join("; ")}`);
  console.log("every editor uses the Element menu; every dialog takes the focus and closes on Escape");
}, { project });
