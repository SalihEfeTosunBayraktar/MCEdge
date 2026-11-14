/**
 * KUYRUK 128: global shortcuts and the Help menu. Presses every shortcut through CDP key events (no OS keys):
 * Ctrl+N opens the New popup from anywhere, Ctrl+F focuses the section's search, Enter opens the selected element,
 * Ctrl+W closes the element and texture editors (and not the window), F2 renames and Delete deletes the selection.
 * Help has the user guide (not the developer docs), Keyboard shortcuts and Check for updates (GitHub answered by a
 * stub in the main process); File > Open recent lists the recent projects. Runs on a copy of examples/hello.
 * Args: theme (dark/light), language (en/tr). Screenshots go to design/128/.
 */
import { assert, exampleProject, run, type App } from "./cdp.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const tr = lang === "tr";
const project = exampleProject();
const CTRL = 2;

const L = (en: string, trText: string) => (tr ? trText : en);
const shot = (app: App, name: string) => app.shot(`design/128/${name}-${theme}-${lang}-after.png`);
const menu = async (app: App, top: string) => {
  await app.click(".menubar .menu", top);
  await app.waitFor(`document.querySelector(".menulist")`);
};
const items = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent)`);
const tile = (id: string) => `[...document.querySelectorAll(".tile:not(.foldertile)")].find((t) => t.querySelector("code")?.textContent === ${JSON.stringify(id)})`;
const home = async (app: App) => {
  await app.eval(`document.querySelectorAll(".rail .rtab")[0].click()`);
  await app.waitFor(`document.querySelector(".tiles .tile")`);
};

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tiles .tile")`);

  // 1. Help menu: user guide, shortcut list, developer docs online, Check for updates, About.
  await menu(app, L("Help", "Yardım"));
  const help = await items(app);
  for (const label of [L("User guide...", "Kullanım kılavuzu..."), L("Keyboard shortcuts...", "Klavye kısayolları..."), L("Check for updates...", "Güncellemeleri denetle...")]) {
    assert(help.includes(label), `Help has ${label}: ${help.join(" | ")}`);
  }
  await shot(app, "menu-help");
  await app.click(".menulist button", L("User guide", "Kullanım kılavuzu"));
  await app.waitFor(`document.querySelectorAll(".docslist .lrow").length === 4`);
  const pages = await app.eval<string[]>(`[...document.querySelectorAll(".docslist .lrow")].map((r) => r.textContent)`);
  assert(pages[0] === L("Getting started", "Başlarken") && !pages.some((p) => /MCP|Roadmap|ETR|element type/i.test(p)), `guide pages, no developer docs: ${pages.join(" | ")}`);
  await app.click(".docslist .lrow", pages[1]);
  await app.waitFor(`document.querySelector(".markdown h2")?.textContent === ${JSON.stringify(pages[1])}`);
  await shot(app, "guide");
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".docsdlg")`);

  await menu(app, L("Help", "Yardım"));
  await app.click(".menulist button", L("Keyboard shortcuts", "Klavye kısayolları"));
  await app.waitFor(`document.querySelector(".dialog.shortcuts")`);
  const keys = await app.eval<string>(`document.querySelector(".keytable").textContent`);
  for (const k of ["Ctrl+N", "Ctrl+F", "Enter", "F2", "Delete", "Ctrl+W", "Ctrl+B", "F5"]) assert(keys.includes(k), `shortcut list has ${k}`);
  await shot(app, "shortcuts");
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".dialog.shortcuts")`);

  // Check for updates: GitHub answered by a stub in the main process (a newer release, then this version).
  await app.mainEval(`globalThis.fetch = async () => ({ ok: true, json: async () => ({ tag_name: "v99.1.0", html_url: "https://github.com/SalihEfeTosunBayraktar/MCEdge/releases/tag/v99.1.0" }) })`);
  await menu(app, L("Help", "Yardım"));
  await app.click(".menulist button", L("Check for updates", "Güncellemeleri denetle"));
  await app.waitFor(`document.querySelector("[data-testid=update-status]")?.dataset.status === "available"`);
  assert((await app.eval<string>(`document.querySelector("[data-testid=update-status]").textContent`)).includes("99.1.0"), "names the new version");
  await shot(app, "updates");
  await app.key("Escape");
  await app.mainEval(`globalThis.fetch = async () => ({ ok: true, json: async () => ({ tag_name: "v" + (process.mainModule ? process.mainModule.require : require)("electron").app.getVersion(), html_url: "" }) })`);
  await menu(app, L("Help", "Yardım"));
  await app.click(".menulist button", L("Check for updates", "Güncellemeleri denetle"));
  await app.waitFor(`document.querySelector("[data-testid=update-status]")?.dataset.status === "latest"`);
  await app.key("Escape");

  // 2. File > Open recent lists the recent projects in the File menu.
  await menu(app, L("File", "Dosya"));
  await app.click(".menulist button", L("Open recent", "Son projeler"));
  await app.waitFor(`[...document.querySelectorAll(".menulist button")].some((b) => b.textContent.includes(${JSON.stringify(project)}))`);
  await shot(app, "menu-recent");
  await app.key("Escape");

  // 3. Ctrl+N opens the New popup, also from another section.
  await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
  await app.sleep(300);
  await app.eval(`document.activeElement?.blur()`);
  await app.key("n", CTRL);
  await app.waitFor(`document.querySelector(".addpop")`);
  await app.click(".view .actions .abtn.primary");
  await app.waitFor(`!document.querySelector(".addpop")`);

  // 4. Ctrl+F focuses the section's search.
  await app.eval(`document.activeElement?.blur()`);
  await app.key("f", CTRL);
  assert(await app.eval<boolean>(`document.activeElement === document.querySelector(".view .findbar input")`), "Ctrl+F focuses the search");

  // 5. Enter opens the selected element; Ctrl+W closes the editor and keeps the window.
  await app.eval(`${tile("ruby")}.focus()`);
  await app.eval(`${tile("ruby")}.click()`);
  await app.key("Enter");
  await app.waitFor(`document.querySelector(".edhead")`);
  await app.key("w", CTRL);
  await app.waitFor(`!document.querySelector(".edhead") && document.querySelector(".tiles")`);
  // The same from the File menu.
  await app.eval(`${tile("ruby")}.click()`);
  await app.key("Enter");
  await app.waitFor(`document.querySelector(".edhead")`);
  await menu(app, L("File", "Dosya"));
  await shot(app, "menu-file");
  await app.click(".menulist button", L("Close tab", "Sekmeyi kapat"));
  await app.waitFor(`!document.querySelector(".edhead")`);
  // Texture editor.
  await app.eval(`document.querySelectorAll(".rail .rtab")[1].click()`);
  await app.waitFor(`document.querySelector(".texcell:not(.draft)")`);
  await app.click(".texcell:not(.draft)", undefined, { double: true });
  await app.waitFor(`document.querySelector(".ptools")`, 10000);
  await app.eval(`document.activeElement?.blur()`);
  await app.key("w", CTRL);
  await app.waitFor(`!document.querySelector(".ptools")`);
  assert(await app.eval<boolean>(`!!document.querySelector(".menubar")`), "the window is still open");

  // 6. F2 renames and Delete deletes the selected element (the confirm is answered by the test).
  await home(app);
  await app.eval(`${tile("ruby_apple")}.click()`);
  await app.key("F2");
  await app.waitFor(`document.querySelector(".dialog")`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".dialog input")].some((i) => i.value === "ruby_apple")`), "F2 opens Rename for the selected element");
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".dialog")`);
  await app.eval(`window.__asked = []; window.confirm = (text) => (window.__asked.push(text), false)`);
  await app.eval(`${tile("ruby_apple")}.click()`);
  await app.key("Delete");
  await app.sleep(200);
  const asked = await app.eval<string[]>(`window.__asked`);
  assert(asked.length === 1 && asked[0].includes("Ruby Apple"), `Delete asks once to delete the selected element: ${JSON.stringify(asked)}`);
  // Keys typed in a field stay in the field.
  await app.eval(`document.querySelector(".view .findbar input").focus()`);
  await app.key("Delete");
  await app.key("Enter");
  assert(!(await app.eval<boolean>(`!!document.querySelector(".edhead")`)) && (await app.eval<string[]>(`window.__asked`)).length === 1, "Enter and Delete in the search box do nothing to the selection");
  console.log(`shortcuts and Help OK (${theme}, ${lang})`);
}, { project, theme, language: lang });
