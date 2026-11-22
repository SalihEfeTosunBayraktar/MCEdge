/**
 * Q248: a real flow with the keyboard only (no mouse event, no click), in en and tr, in the dark and the light theme:
 * menu bar by F10 and Alt (arrows, Home/End, Escape returns the focus), a new element from Ctrl+N and its letter, a field
 * edited and autosaved, a new texture painted pixel by pixel with the arrow keys and Space and saved, and a procedure block
 * added by the block search and by the toolbox (Blockly's own keyboard navigation). Between the steps it reads the
 * accessibility tree (what a screen reader gets: role, name and state of the key controls) and saves it to
 * design/248/ax-<lang>.json. Screenshots in design/248/.
 *   npx tsx tools/ui-test/keyboard.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, copyProject, REPO, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/248");
const CTRL = 2;
const RUNS: { lang: "en" | "tr"; theme: "dark" | "light" }[] = [{ lang: "en", theme: "dark" }, { lang: "tr", theme: "light" }, { lang: "en", theme: "light" }, { lang: "tr", theme: "dark" }];

/** Role, name, description and states of an element, from Chromium's accessibility tree. */
async function ax(app: App, expression: string) {
  const { result } = await app.cdp("Runtime.evaluate", { expression });
  const { node } = await app.cdp("DOM.describeNode", { objectId: result.objectId });
  const { nodes } = await app.cdp("Accessibility.getPartialAXTree", { backendNodeId: node.backendNodeId, fetchRelatives: false });
  const n = nodes[0] as { role?: { value: string }; name?: { value: string }; description?: { value: string }; properties?: { name: string; value: { value: unknown } }[] };
  return { role: n.role?.value ?? "", name: n.name?.value ?? "", description: n.description?.value ?? "", state: Object.fromEntries((n.properties ?? []).map((p) => [p.name, p.value.value])) as Record<string, unknown> };
}

/** A typed character (letter shortcuts): the key event carries the text, so a non-ASCII letter works too. */
async function char(app: App, ch: string) {
  const base = { key: ch, text: ch, unmodifiedText: ch };
  await app.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await app.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  await app.sleep(60);
}
const keyDown = (app: App, key: string, code: string, vk: number) => app.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk });
const keyUp = (app: App, key: string, code: string, vk: number) => app.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });

/** Tab until the predicate holds for the focused element (page expression `el`), like a user looking for a control. */
async function tabTo(app: App, predicate: string, max = 200, shift = false) {
  for (let i = 0; i < max; i++) {
    await app.key("Tab", shift ? 8 : 0);
    if (await app.eval<boolean>(`(() => { const el = document.activeElement; return !!el && (${predicate}); })()`)) return i + 1;
  }
  throw new Error(`Tab never reached: ${predicate}`);
}
const active = (app: App) => app.eval<string>(`(() => { const a = document.activeElement; return (a.getAttribute("aria-label") || a.textContent || a.className || a.tagName).trim().replace(/\\s+/g, " ").slice(0, 60); })()`);

for (const { lang, theme } of RUNS) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  const L = (key: string, values: Record<string, string | number> = {}) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(values[k]));
  const project = copyProject(join(REPO, "examples", "hello"), "hello");
  const evidence: Record<string, unknown> = {};
  let mouseEvents = 0;
  await run(async (app) => {
    await app.setTheme(theme);
    await app.waitFor(`document.querySelectorAll(".tile").length > 3`, 30000);
    // Nothing in this test may use the mouse: count the pointer events the page receives from now on.
    await app.eval(`window.__pointer = 0; for (const t of ["mousedown", "mouseup", "click", "pointerdown"]) addEventListener(t, (e) => { if (e.isTrusted && (e.type !== "click" || e.detail > 0)) window.__pointer++; }, true)`);
    const shot = (name: string) => app.shot(`${OUT}/${name}-${lang}-${theme}.png`);
    const note = (key: string, value: unknown) => ((evidence[key] = value), console.log(`${lang}/${theme} ${key}: ${JSON.stringify(value)}`));
    const waitSaved = async () => {
      await app.sleep(700);
      await app.waitFor(`!document.querySelector(".smsg.saving")`, 10000);
    };

    // ---- 1. The menu bar ----
    await app.key("F10");
    assert(await app.eval<boolean>(`!!document.activeElement.closest(".menus") && document.activeElement.classList.contains("menu")`), "F10 puts the focus on the menu bar");
    note("menubar", await ax(app, `document.querySelector(".menus")`));
    const top = await ax(app, `document.activeElement`);
    assert(top.role === "menuitem" && top.name === L("menu.file") && top.state.hasPopup === "menu" && top.state.expanded === false, `File button: ${JSON.stringify(top)}`);
    note("menu button", top);
    await app.key("ArrowRight");
    assert((await active(app)) === L("menu.workspace"), `ArrowRight moves along the bar: ${await active(app)}`);
    await app.key("ArrowDown");
    await app.waitFor(`document.querySelector(".menulist")`);
    assert(await app.eval<boolean>(`document.querySelector(".menulist").contains(document.activeElement)`), "ArrowDown opens the menu and the focus goes into it");
    const menu = await ax(app, `document.querySelector(".menulist")`);
    assert(menu.role === "menu" && menu.name === L("menu.workspace"), `menu named after its opener: ${JSON.stringify(menu)}`);
    note("menu", menu);
    const first = await active(app);
    await shot("menu-open");
    await app.key("ArrowDown");
    assert((await active(app)) !== first, "ArrowDown moves to the next item");
    await app.key("End");
    const last = await active(app);
    assert(last === (await app.eval<string>(`[...document.querySelectorAll(".menulist [role^=menuitem]:not(:disabled)")].at(-1).textContent.trim().replace(/\\s+/g, " ")`)), `End goes to the last item: ${last}`);
    await app.key("Home");
    assert((await active(app)) === first, "Home goes back to the first item");
    note("menu item", await ax(app, `document.activeElement`));
    await app.key("ArrowRight");
    assert(await app.eval<boolean>(`document.querySelector(".menu.on")?.textContent === ${JSON.stringify(L("menu.resources"))}`), "ArrowRight inside a menu opens the next menu");
    await app.key("ArrowLeft");
    assert(await app.eval<boolean>(`document.querySelector(".menu.on")?.textContent === ${JSON.stringify(L("menu.workspace"))}`), "ArrowLeft goes back");
    await app.key("Escape");
    assert(await app.eval<boolean>(`!document.querySelector(".menulist") && document.activeElement.textContent === ${JSON.stringify(L("menu.workspace"))}`), "Escape closes the menu and the focus returns to its opener");
    await app.key("Escape");
    assert(await app.eval<boolean>(`!document.activeElement.closest(".menus")`), "a second Escape leaves the menu bar");
    await app.key("Alt");
    assert(await app.eval<boolean>(`!!document.activeElement.closest(".menus")`), "Alt alone enters the menu bar");
    await app.key("Alt");
    assert(await app.eval<boolean>(`!document.activeElement.closest(".menus")`), "Alt again leaves it");

    // ---- 2. A new element: Ctrl+N, its letter, a name, Enter ----
    await app.key("n", CTRL);
    await app.waitFor(`document.querySelector(".addpop")`);
    const pop = await ax(app, `document.querySelector(".addpop")`);
    assert(pop.role === "dialog" && pop.name === L("new.title"), `New element popup: ${JSON.stringify(pop)}`);
    const letter = await app.eval<string>(`document.querySelector(".ptype[data-type=item] .pkey").textContent.toLowerCase()`);
    await char(app, letter);
    await app.waitFor(`document.querySelector(".popform input")`);
    assert(await app.eval<boolean>(`document.activeElement.matches(".popform input")`), "the name field has the focus");
    await app.type("Keyboard Gem");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".edhead") && document.querySelector(".edname")?.textContent.includes("Keyboard Gem")`, 15000);
    const itemFile = join(project, "elements", "items", "keyboard_gem.json");
    assert(existsSync(itemFile), "the new element is written");
    await shot("new-element");

    // ---- 3. Edit a field with Tab and the keyboard, autosave ----
    const before = JSON.parse(readFileSync(itemFile, "utf8")) as Record<string, unknown>;
    await tabTo(app, `el.matches(".content textarea")`);
    const field = await ax(app, `document.activeElement`);
    assert(field.role === "textbox", `a text field: ${JSON.stringify(field)}`);
    assert(field.name.length > 1, `the field has a name a screen reader reads: ${JSON.stringify(field)}`);
    note("field", field);
    await app.type("Typed with the keyboard");
    await app.key("Tab");
    await waitSaved();
    const after = JSON.parse(readFileSync(itemFile, "utf8")) as Record<string, unknown>;
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    assert(changed.length === 1 && JSON.stringify(after[changed[0]]).includes("Typed with the keyboard"), `exactly one field changed and was saved: ${changed.join(",")} = ${JSON.stringify(after[changed[0]])}`);
    note("saved field", `${changed[0]} = ${JSON.stringify(after[changed[0]])} (named "${field.name}")`);
    // The page tabs of the editor: one tab stop, arrows move, selected state is exposed.
    const tab = await ax(app, `document.querySelector(".content .pagetabs [aria-selected=true]")`);
    assert(tab.role === "tab" && tab.state.selected === true, `selected page tab: ${JSON.stringify(tab)}`);
    note("editor tab", tab);
    await app.eval(`document.querySelector(".content .pagetabs [aria-selected=true]").focus()`);
    await app.key("ArrowRight");
    assert(await app.eval<boolean>(`document.activeElement.getAttribute("role") === "tab" && document.activeElement.getAttribute("aria-selected") === "true" && document.activeElement.tabIndex === 0`), "ArrowRight selects the next page tab (roving tab stop)");
    await app.key("Home");
    assert(await app.eval<boolean>(`document.activeElement.getAttribute("aria-selected") === "true" && document.activeElement === document.querySelector(".content .pagetabs [role=tab]")`), "Home selects the first page tab");

    // ---- 4. The element list: tiles (arrows move and select, Enter opens), then the table as a grid ----
    await app.key("w", CTRL);
    await app.waitFor(`document.querySelector(".tiles")`);
    await tabTo(app, `el.classList.contains("tile")`, 120);
    const firstTile = await active(app);
    await app.key("ArrowRight");
    const secondTile = await active(app);
    assert(secondTile !== firstTile && (await app.eval<boolean>(`document.activeElement.getAttribute("aria-selected") === "true"`)), `ArrowRight moves to the next tile and selects it: ${firstTile} -> ${secondTile}`);
    await app.key("ArrowDown");
    assert((await app.eval<boolean>(`document.activeElement.classList.contains("tile")`)), "ArrowDown stays on a tile");
    await app.key("End");
    const lastTile = await active(app);
    await app.key("Home");
    assert((await active(app)) === firstTile && lastTile !== firstTile, `Home and End go to the first and last tile: ${firstTile} .. ${lastTile}`);
    note("tile", await ax(app, `document.activeElement`));
    await app.eval(`(() => { const s = [...document.querySelectorAll(".findbar select")].find((x) => [...x.options].some((o) => o.value === "details")); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "details"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await app.waitFor(`document.querySelector(".elemtable .tablewrap")`);
    await app.eval(`document.querySelector(".elemtable .tablewrap").focus()`);
    await app.key("ArrowDown");
    const grid = await ax(app, `document.querySelector(".elemtable .tablewrap")`);
    assert(grid.role === "grid" && grid.name === L("section.elements"), `element table is a named grid: ${JSON.stringify(grid)}`);
    const row = await ax(app, `document.querySelector(".elemtable tr.sel")`);
    assert(row.role === "row" && row.state.selected === true, `selected row: ${JSON.stringify(row)}`);
    note("grid", grid);
    note("row", row);
    const selectedBefore = await app.eval<string>(`document.querySelector(".elemtable tr.sel").dataset.key`);
    await app.key("ArrowDown");
    assert((await app.eval<string>(`document.querySelector(".elemtable tr.sel").dataset.key`)) !== selectedBefore, "ArrowDown selects the next row");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".edhead")`);
    await app.key("w", CTRL);
    await app.waitFor(`document.querySelector(".elemtable")`);

    // ---- 5. A texture: Resources > Create texture, then paint with the arrow keys and Space ----
    await app.key("F10");
    for (let i = 0; i < 2; i++) await app.key("ArrowRight");
    await app.key("ArrowDown");
    for (let i = 0; i < 6 && (await active(app)) !== L("menu.createTexture"); i++) await app.key("ArrowDown");
    assert((await active(app)) === L("menu.createTexture"), `the Resources menu offers Create texture: ${await active(app)}`);
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".dialog")`);
    const dlg = await ax(app, `document.querySelector(".dialog")`);
    assert(dlg.role === "dialog" && dlg.name.length > 0 && dlg.state.modal === true, `a named modal dialog: ${JSON.stringify(dlg)}`);
    note("dialog", dlg);
    // The focus stays in the dialog however long Tab is pressed.
    for (let i = 0; i < 14; i++) {
      await app.key("Tab");
      assert(await app.eval<boolean>(`document.querySelector(".dialog").contains(document.activeElement)`), `Tab stays in the dialog (press ${i + 1}): ${await active(app)}`);
    }
    // Escape closes it and the focus goes back to the menu that opened it; then open it again.
    await app.key("Escape");
    await app.waitFor(`!document.querySelector(".backdrop")`);
    assert(await app.eval<boolean>(`document.activeElement.textContent === ${JSON.stringify(L("menu.resources"))}`), `focus returns to the menu button after the dialog closes: ${await active(app)}`);
    await app.key("ArrowDown");
    for (let i = 0; i < 6 && (await active(app)) !== L("menu.createTexture"); i++) await app.key("ArrowDown");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".dialog")`);
    await app.eval(`document.querySelector(".dialog input").focus()`);
    await app.type("kb_gem");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".paintcanvas")`, 15000);
    await app.sleep(300);
    await tabTo(app, `el.classList.contains("paintcanvas")`, 80);
    const canvas = await ax(app, `document.activeElement`);
    assert(canvas.role === "application" && canvas.name === L("paint.canvas") && canvas.description.includes(L("paint.keysHelp").slice(0, 20)), `the canvas is a described application: ${JSON.stringify(canvas)}`);
    note("canvas", canvas);
    assert(await app.eval<boolean>(`document.querySelector(".pcursor")?.textContent === ${JSON.stringify(L("paint.cursor", { x: 0, y: 0 }))}`), "Tab to the canvas shows the pixel cursor at 0, 0");
    for (const [key, n] of [["ArrowRight", 3], ["ArrowDown", 2]] as const) for (let i = 0; i < n; i++) await app.key(key);
    assert(await app.eval<boolean>(`document.querySelector(".pcursor")?.textContent === ${JSON.stringify(L("paint.cursor", { x: 3, y: 2 }))}`), "the arrows move the cursor to 3, 2");
    const live = await app.eval<string>(`document.querySelector(".paintframe [role=status]").textContent`);
    assert(live.startsWith("x 3, y 2"), `the position is announced: ${live}`);
    note("announcement", live);
    // A new texture is 16 x 16 pixels; the canvas draws each at its zoom.
    const pixelAt = (x: number, y: number) => app.eval<number[]>(`(() => { const c = document.querySelector(".paintcanvas"); const z = c.width / 16; return [...c.getContext("2d").getImageData(Math.floor((${x} + 0.5) * z), Math.floor((${y} + 0.5) * z), 1, 1).data]; })()`);
    assert((await pixelAt(3, 2))[3] === 0, "the cell is empty before painting");
    await app.key(" ");
    const painted = await pixelAt(3, 2);
    assert(painted[3] === 255 && painted[0] > 150, `Space paints the pixel under the cursor: ${painted}`);
    // Hold Space and use the arrows: a stroke.
    await keyDown(app, " ", "Space", 32);
    await app.key("ArrowDown");
    await app.key("ArrowDown");
    await keyUp(app, " ", "Space", 32);
    assert((await pixelAt(3, 4))[3] === 255 && (await pixelAt(3, 3))[3] === 255, "Space held with the arrows draws a stroke");
    await char(app, "e");
    await app.key(" ");
    assert((await pixelAt(3, 4))[3] === 0, "E picks the eraser and Space erases at the cursor");
    await shot("texture-cursor");
    await app.key("s", CTRL);
    await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10000);
    const found = (dir: string): string | undefined => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? [found(join(dir, f))] : f === "kb_gem.png" ? [join(dir, f)] : [])).find(Boolean);
    const file = found(join(project, "textures"));
    assert(file && statSync(file).size > 50, "Ctrl+S saves the texture file");
    note("texture", file);
    await app.key("w", CTRL);

    // ---- 6. A procedure block: a new procedure, the block search, then the toolbox with Blockly's own keys ----
    await app.key("n", CTRL);
    await app.waitFor(`document.querySelector(".addpop")`);
    await char(app, await app.eval<string>(`document.querySelector(".ptype[data-type=procedure] .pkey").textContent.toLowerCase()`));
    await app.waitFor(`document.querySelector(".popform input")`);
    await app.type("kb_proc");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".blocklyhost")`, 20000);
    await app.sleep(800);
    const blocks = () => app.eval<number>(`document.querySelector(".blocklyhost").blocklyWorkspace.getAllBlocks(false).length`);
    const startBlocks = await blocks();
    await app.key("f", CTRL);
    assert(await app.eval<boolean>(`document.activeElement.closest(".procsearch") !== null`), "Ctrl+F focuses the block search");
    await app.type("if");
    await app.key("Enter");
    await app.sleep(300);
    const afterSearch = await blocks();
    assert(afterSearch > startBlocks, `Enter in the search adds a block: ${startBlocks} -> ${afterSearch}`);
    // Blockly's keyboard navigation: Tab reaches the toolbox, the arrows move through categories and blocks, Enter inserts.
    await tabTo(app, `el.closest(".blocklyToolbox") !== null || el.classList.contains("blocklyToolbox")`, 80);
    note("toolbox focus", await active(app));
    // The first categories (Favourites, Recently used) can be empty: go down to one whose flyout has blocks.
    const flyoutBlocks = () => app.eval<number>(`document.querySelector(".blocklyhost").blocklyWorkspace.getToolbox().getFlyout().getWorkspace().getTopBlocks(false).length`);
    for (let i = 0; i < 8 && (await flyoutBlocks()) === 0; i++) await app.key("ArrowDown");
    assert((await flyoutBlocks()) > 0, "ArrowDown reaches a category with blocks");
    note("category", await ax(app, `document.activeElement`));
    await app.key("ArrowRight");
    const picked = await app.eval<string>(`document.querySelector(".blocklyhost").blockly.getSelected()?.type ?? ""`);
    assert(picked !== "", "ArrowRight goes from the category into its blocks and selects one");
    await app.key("Enter");
    await app.sleep(300);
    const afterToolbox = await blocks();
    assert(afterToolbox > afterSearch, `Enter inserts the picked block: ${afterSearch} -> ${afterToolbox}`);
    note("block", await ax(app, `document.activeElement`));
    // Blockly puts the inserted block in move mode: the arrows choose where it connects, Enter accepts the place.
    assert(await app.eval<boolean>(`document.querySelector(".blocklyhost").blockly.KeyboardMover.mover.isMoving()`), "the inserted block is in move mode");
    await shot("procedure");
    await app.key("Enter");
    assert(await app.eval<boolean>(`!document.querySelector(".blocklyhost").blockly.KeyboardMover.mover.isMoving()`), "Enter accepts the position");
    const placed = await app.eval<boolean>(`(() => { const b = document.querySelector(".blocklyhost").blockly.getSelected(); return !!(b.getParent() || b.previousConnection?.isConnected()); })()`);
    note("block placed", placed);
    await app.key("ArrowDown");
    const moved = await app.eval<string>(`document.querySelector(".blocklyhost").blockly.getSelected()?.type ?? ""`);
    note("selected block after ArrowDown", moved);
    await waitSaved();
    const program = JSON.stringify((JSON.parse(readFileSync(join(project, "elements", "procedures", "kb_proc.json"), "utf8")) as { program: unknown }).program);
    const savedBlocks = [...program.matchAll(/"block":"(\w+)"/g)].map((m) => m[1]);
    assert(savedBlocks.length >= 3 && savedBlocks.includes(picked), `the procedure file holds the start block, the searched block and the toolbox block (${picked}): ${savedBlocks.join(", ")}`);
    await app.shot(`${OUT}/procedure-placed-${lang}-${theme}.png`);

    // ---- 7. A GUI screen: add a widget from the menu and move it with the arrow keys ----
    await app.key("w", CTRL);
    await app.waitFor(`document.querySelector(".tiles, .elemtable")`);
    await app.key("n", CTRL);
    await app.waitFor(`document.querySelector(".addpop")`);
    const guiLetter = await app.eval<string>(`document.querySelector(".ptype[data-type=gui] .pkey")?.textContent.toLowerCase() ?? ""`);
    assert(guiLetter !== "", "the GUI type has a letter in the New popup");
    await char(app, guiLetter);
    await app.waitFor(`document.querySelector(".popform input")`);
    await app.type("kb_gui");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".guistage")`, 20000);
    await tabTo(app, `el.textContent.trim() === ${JSON.stringify(L("gui.add"))}`, 80);
    const addButton = await ax(app, `document.activeElement`);
    assert(addButton.role === "button" && addButton.state.hasPopup === "menu" && addButton.state.expanded === false, `Add widget is a menu button: ${JSON.stringify(addButton)}`);
    note("add widget button", addButton);
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".menulist")`);
    assert(await app.eval<boolean>(`document.activeElement.closest(".menulist") !== null`), "the Add widget menu takes the focus");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".gwidget")`);
    const guiFile = join(project, "elements", "guis", "kb_gui.json");
    const widgetX = async () => {
      await waitSaved();
      return (JSON.parse(readFileSync(guiFile, "utf8")) as { components: { x: number }[] }).components[0].x;
    };
    const x0 = await widgetX();
    assert(await app.eval<boolean>(`document.activeElement.textContent.trim() === ${JSON.stringify(L("gui.add"))}`), "the focus is back on the Add widget button after the menu");
    await app.key("Escape");
    await app.key("PageDown");
    assert(await app.eval<boolean>(`!!document.querySelector(".gwidget.sel")`), "PageDown selects a widget");
    for (let i = 0; i < 3; i++) await app.key("ArrowRight");
    const x1 = await widgetX();
    assert(x1 === x0 + 3, `three ArrowRight presses move the selected widget by 3 px and it is saved: ${x0} -> ${x1}`);
    const listbox = await ax(app, `document.querySelector(".guilist")`);
    assert(listbox.role === "listbox" && listbox.name === L("gui.widgets"), `the widget list is a named listbox: ${JSON.stringify(listbox)}`);
    note("widget list", listbox);
    await shot("gui");

    // ---- no mouse was used ----
    mouseEvents = await app.eval<number>(`window.__pointer`);
    assert(mouseEvents === 0, `no mouse event reached the page: ${mouseEvents}`);
  }, { language: lang, project, width: 1440, height: 900 });
  mkdirSync(join(REPO, OUT), { recursive: true });
  writeFileSync(join(REPO, OUT, `ax-${lang}-${theme}.json`), JSON.stringify(evidence, null, 1) + "\n");
}
if (!process.exitCode) console.log("PASS keyboard");
