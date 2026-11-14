/**
 * KUYRUK 137: the polish batch (audit U13, U14, U16, U20, X1-X4; U15 is tools/ui-test/button-heights.ts). One check
 * and one screenshot per item on a copy of examples/hello. Args: suffix ("before" only shoots), theme, language.
 * Screenshots go to design/137/<item>-<theme>-<lang>-<suffix>.png.
 */
import { assert, exampleProject, launchApp, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const suffix = process.argv[2] ?? "after";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const lang = process.argv[4] ?? "en";
const tr = lang === "tr";
const before = suffix === "before";
const project = exampleProject();
addElement(project, "gui", "shop", { type: 1, width: 176, height: 166, components: [{ kind: "button", x: 10, y: 10, width: 60, height: 20, text: "Buy" }] });
addElement(project, "living_entity", "goblin", { name: "Goblin" });
const shot = (app: App, item: string) => app.shot(`design/137/${item}-${theme}-${lang}-${suffix}.png`);
const check = (ok: boolean, message: string) => before || assert(ok, message);
const items = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent.replace(/Ctrl.*$|F\\d.*$|Alt.*$/, "").trim())`);
const openTile = async (app: App, id: string) => {
  await app.key("Escape");
  await app.eval(`document.querySelectorAll(".rail .rtab")[0].click()`);
  await app.waitFor(`document.querySelector(".tiles .tile")`);
  await app.eval(`[...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => e.querySelector("code")?.textContent === ${JSON.stringify(id)}).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.sleep(700);
};

// U16: the welcome screen's status bar shows no project items.
{
  const app = await launchApp({ theme, language: lang });
  try {
    await app.waitFor(`document.querySelector(".welcome, .grid")`);
    await app.sleep(400);
    const status = await app.eval<string>(`document.querySelector("footer.status")?.textContent ?? ""`);
    check(!/problem|sorun|Gradle|Fabric/i.test(status), `U16: welcome status bar without project items: ${status}`);
    await shot(app, "u16-welcome");
  } finally {
    await app.close();
  }
}

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);

  // U13: every rail section once in Workspace, no duplicate texture maker in Tools, the theme switch only on the title bar.
  await app.click(".menubar .menu", tr ? "Çalışma alanı" : "Workspace");
  const workspace = await items(app);
  await shot(app, "u13-menu-workspace");
  await app.key("Escape");
  const sections = await app.eval<string[]>(`[...document.querySelectorAll(".rail .rtab")].map((b) => b.getAttribute("aria-label") ?? b.title ?? b.textContent)`);
  check(sections.every((s) => workspace.filter((w) => w === s).length === 1), `U13: Workspace lists each section once: ${workspace.join(" | ")} vs ${sections.join(" | ")}`);
  await app.click(".menubar .menu", tr ? "Araçlar" : "Tools");
  const tools = await items(app);
  await shot(app, "u13-menu-tools");
  await app.key("Escape");
  check(!tools.some((t) => /Texture maker|Doku yapıcı/.test(t)), `U13: no Texture maker in Tools: ${tools.join(" | ")}`);
  await app.click(".menubar .menu", tr ? "Pencere" : "Window");
  const windowMenu = await items(app);
  await shot(app, "u13-menu-window");
  await app.key("Escape");
  check(!windowMenu.some((t) => /theme|tema/i.test(t)), `U13: no theme switch in Window: ${windowMenu.join(" | ")}`);

  // U20: the New popup's letters come from the names shown.
  await app.click(".view .actions .abtn.primary");
  await app.waitFor(`document.querySelector(".addpop")`);
  const letters = await app.eval<{ name: string; key: string }[]>(`[...document.querySelectorAll(".addpop .ptype")].map((b) => ({ name: b.querySelector(".pname")?.textContent ?? "", key: b.querySelector(".pkey")?.textContent ?? "" })).filter((x) => x.key)`);
  await shot(app, "u20-new-popup");
  const wrong = letters.filter((l) => !l.name.toLocaleLowerCase(tr ? "tr" : "en").includes(l.key.toLocaleLowerCase(tr ? "tr" : "en")));
  check(letters.length > 5 && wrong.length === 0, `U20: letters from the shown names: ${wrong.map((w) => `${w.key}/${w.name}`).join(", ")}`);
  await app.click(".view .actions .abtn.primary");

  // X1: one quiet marker per field instead of text badges.
  await openTile(app, "ruby_tab");
  await shot(app, "x1-badges");
  check(await app.eval<boolean>(`![...document.querySelectorAll(".frow .genbadge, .frow .genmark")].some((b) => b.textContent.trim()) && !!document.querySelector(".frow .genmark")`), "X1: quiet markers, no text badges next to fields");

  // X3: page tabs of a long editor fit (two rows at most, none cut).
  await openTile(app, "goblin");
  await shot(app, "x3-page-tabs");
  check(await app.eval<boolean>(`[...document.querySelectorAll(".pagetabs .ltab")].every((t) => t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().right <= window.innerWidth)`), "X3: no page tab cut or off screen");

  // U14: the GUI editor's toolbar is one row; position and size are in the side panel.
  await openTile(app, "shop");
  await app.click(".gwidget");
  await app.sleep(300);
  await shot(app, "u14-gui-toolbar");
  const barHeight = await app.eval<number>(`Math.round(document.querySelector(".actions[role=toolbar]").getBoundingClientRect().height)`);
  check(barHeight <= 40, `U14: GUI toolbar in one row (${barHeight} px high)`);
  check(await app.eval<boolean>(`!document.querySelector(".actions[role=toolbar] .scrub, .actions[role=toolbar] input") && !!document.querySelector(".procpanel .sizectl .scrub")`), "U14: size and grid fields in the side panel");

  // X2: a new element starts with sensible defaults (the first texture, the mod's first item), so it has no problem yet.
  await app.key("Escape");
  await app.eval(`document.querySelectorAll(".rail .rtab")[0].click()`);
  await app.waitFor(`document.querySelector(".tiles .tile")`);
  await app.key("n", 2);
  await app.waitFor(`document.querySelector(".addpop")`);
  const tabType = tr ? "Yaratıcı sekme" : "Creative tab";
  await app.setValue(".addpop .popsearch input", tabType);
  await app.sleep(150);
  await app.eval(`[...document.querySelectorAll(".addpop .ptype")].find((b) => b.querySelector(".pname").textContent === ${JSON.stringify(tabType)})?.click()`);
  await app.waitFor(`document.querySelector(".popform input")`);
  await app.setValue(".popform input", "Fresh Gem");
  await app.key("Enter");
  await app.waitFor(`document.querySelector(".edhead")`, 15000);
  await app.sleep(700);
  await shot(app, "x2-new-element");
  check(!(await app.eval<boolean>(`!!document.querySelector(".edhead ~ * .ferr, .formscroll .ferr")`)), "X2: a new creative tab has no problem (its icon starts as the mod's first item)");

  // X4: the selected row stands out from a hovered one (light theme).
  await app.eval(`document.querySelectorAll(".rail .rtab")[4].click()`);
  await app.waitFor(`document.querySelector(".view .grid tbody tr")`);
  await app.click(".view .grid tbody tr");
  const second = await app.center(".view .grid tbody tr:nth-child(3)");
  await app.mouse("mouseMoved", second[0], second[1], 0);
  await app.sleep(200);
  await shot(app, "x4-selected-hover");
  const colors = await app.eval<{ sel: string; hover: string }>(`({ sel: getComputedStyle(document.querySelector(".view .grid tbody tr.sel td")).backgroundColor,
    hover: getComputedStyle(document.querySelector(".view .grid tbody tr:nth-child(3) td")).backgroundColor })`);
  check(colors.sel !== colors.hover, `X4: selected and hovered rows differ: ${JSON.stringify(colors)}`);
  console.log(`polish 137 ${suffix} (${theme}, ${lang})`);
}, { project, theme, language: lang });
