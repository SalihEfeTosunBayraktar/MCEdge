/**
 * KUYRUK #65: drives the texture, GUI and procedure editors and the element form through common tasks the way a
 * MCreator user does them, counting clicks, drags and typed keys per task (docs/USABILITY-2026-11-08.md).
 * `node tools/ui-test/usability-measure.ts before` writes design/usability/before-*.png; "after" uses the
 * shortcuts added by the fixes and writes after-*.png. ETREconomy (629 procedures) is copied, never changed.
 */
import { existsSync } from "node:fs";
import { copyProject, exampleProject, launchApp, type App } from "./cdp.ts";

const phase = process.argv[2] === "after" ? "after" : "before";
const OUT = "design/usability";
const ETR = "C:/MyProjects/AI-Assisted/ETREconomy-MCEdge";

interface Count { clicks: number; drags: number; keys: number; notes: string[] }
const results: Record<string, Count> = {};
let task: Count = { clicks: 0, drags: 0, keys: 0, notes: [] };
const begin = (name: string) => (task = results[name] = { clicks: 0, drags: 0, keys: 0, notes: [] });
const note = (text: string) => task.notes.push(text);

/** The app with every user action counted against the current task. */
function counted(app: App) {
  return {
    click: async (selector: string, text?: string, options?: { double?: boolean; button?: "left" | "right" }) => (task.clicks += options?.double ? 2 : 1, app.click(selector, text, options)),
    drag: async (from: [number, number], to: [number, number]) => {
      task.drags++;
      await app.mouse("mouseMoved", from[0], from[1], 0);
      await app.mouse("mousePressed", from[0], from[1]);
      for (let i = 1; i <= 20; i++) (await app.mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20, 1), await app.sleep(15));
      await app.mouse("mouseReleased", to[0], to[1], 0);
      await app.sleep(300);
    },
    type: async (text: string) => (task.keys += text.length, app.type(text)),
    key: async (key: string, modifiers = 0) => (task.keys++, app.key(key, modifiers)),
    /** A select: open it, scroll to the option (counted as a note), pick it. */
    select: async (label: string, value: string, scope: string) => {
      const picker = await app.eval<boolean>(`!!([...document.querySelectorAll(${JSON.stringify(`${scope} .frow`)})].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label)})?.querySelector(".procpicker"))`);
      if (picker) {
        // Searchable procedure list: open it, type, Enter.
        task.clicks++;
        task.keys += value.length + 1;
        await app.eval(`document.getElementById("pp")?.removeAttribute("id"); [...document.querySelectorAll(${JSON.stringify(`${scope} .frow`)})].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label)}).querySelector(".procpicked").id = "pp"`);
        await app.click("#pp");
        await app.type(value);
        await app.key("Enter");
        await app.sleep(300);
        return;
      }
      task.clicks += 2;
      const options = await app.eval<number>(`(() => { const row = [...document.querySelectorAll(${JSON.stringify(`${scope} .frow`)})].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label)}); return row?.querySelector("select")?.options.length ?? 0; })()`);
      if (options > 20) note(`${label}: a list of ${options} entries to scroll`);
      await app.setField(label, value, scope);
    },
    /** A text or number field: click into it, select all, type. */
    field: async (label: string, value: string, scope: string) => {
      task.clicks++;
      task.keys += 1 + value.length;
      await app.setField(label, value, scope);
    },
  };
}

const openTile = async (app: App, query: string, id: string) => {
  const c = counted(app);
  await c.click(".findbar input");
  await c.type(query);
  await app.setValue(".findbar input", query);
  await app.sleep(300);
  await app.eval(`(() => { const t = [...document.querySelectorAll(".tile")].find((t) => t.textContent.endsWith(${JSON.stringify(id)})); t.id = "target"; })()`);
  await c.click("#target", undefined, { double: true });
  await app.sleep(600);
};

// ---- texture editor and element form on examples/hello ----
const hello = exampleProject();
let app = await launchApp({ project: hello });
try {
  const c = counted(app);
  begin("texture: 16x16 item texture with a filled rectangle, saved");
  await c.click(".rtab", "Resources");
  await c.click(".abtn", "New texture");
  await c.click(".dialog input");
  await c.type("ruby_gem");
  await c.click(".dialog .abtn.primary");
  await app.waitFor(`document.querySelector(".paintcanvas")`);
  await app.shot(`${OUT}/${phase}-texture-editor.png`);
  await c.click(".ptools .abtn", "Rectangle");
  await c.click(".ptools .abtn", "Filled");
  await c.click(".sw[title='#3ab3da']");
  const r = await app.rect(".paintcanvas");
  const cell = (x: number, y: number): [number, number] => [r.x + (x + 0.5) * (r.width / 16), r.y + (y + 0.5) * (r.width / 16)];
  await c.drag(cell(3, 3), cell(12, 12));
  await c.click(".abtn", "Save");
  await app.waitFor(`!document.querySelector(".edname .unsaved")`);
  if (!existsSync(`${hello}/textures/item/ruby_gem.png`)) note("PNG not written");

  begin("texture: find the keyboard shortcuts");
  if (await app.eval<boolean>(`!!document.querySelector(".abtn.compact[aria-label='Keyboard shortcuts']")`)) {
    await c.click(".abtn.compact[aria-label='Keyboard shortcuts']");
    note(`a list of ${await app.eval<number>(`document.querySelectorAll(".keytable tr").length`)} shortcuts (also the ? key)`);
    await c.key("Escape");
  }
  const hint = await app.eval<string>(`[...document.querySelectorAll(".paintform > .hint")].map((p) => p.textContent).join(" ")`);
  note(`paragraph under the side panel: "${hint.slice(0, 60)}..."`);
  if (hint.includes("saved to the PNG as you paint")) note("the paragraph says changes save as you paint; since KUYRUK 59 they save on Save only");
  if (!/Ctrl\+S|L line|R rect|\?/i.test(hint)) note("Save (Ctrl+S) and the shape keys (L, R, O, Y, Shift+F) are missing from it");

  begin("texture: check the result at real size");
  const preview = await app.rect(".edhead .slot canvas");
  note(`the only real-size view is the ${preview.width}px header icon; no slot or tiled preview`);
  await c.click(".abtn", "Back to resources");

  begin("element form: new item with that texture");
  await c.click(".rtab", "Mod elements");
  await c.click(".view .actions .abtn.primary");
  await c.click(".ptype", "Item");
  await c.type("Ruby Gem");
  await app.setValue(".popform input", "Ruby Gem");
  await c.click(".popform button[type=submit]");
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby Gem"`);
  await c.click(".texpicked");
  await c.click(".texcell", "ruby_gem");
  await app.sleep(500);
  const formWidth = await app.eval<{ form: number; view: number }>(`({ form: document.querySelector(".formscroll .form").getBoundingClientRect().width, view: document.querySelector(".formscroll").getBoundingClientRect().width })`);
  const shown = await app.eval<boolean>(`!!document.querySelector(".formpreview .pvbig img")`);
  note(shown ? `form ${Math.round(formWidth.form)}px of ${Math.round(formWidth.view)}px; the right side shows the texture preview`
    : `form ${Math.round(formWidth.form)}px of ${Math.round(formWidth.view)}px; ${Math.round(formWidth.view - formWidth.form)}px on the right stay empty (no texture preview)`);
  await app.shot(`${OUT}/${phase}-item-form.png`);

  begin("element form: right-click procedure that does not exist yet");
  await c.click(".pagetabs .ltab", "Triggers");
  const hasNew = await app.eval<boolean>(`!!document.querySelector(".procnew")`);
  if (hasNew) task.clicks--; // the Triggers tab is clicked again below
  if (!hasNew) {
    note("no New next to the procedure list: leave the item, create the procedure, come back");
    await c.click(".abtn", "Back to elements");
    await c.click(".view .actions .abtn.primary");
    await c.click(".ptype", "Procedure");
    await c.type("ruby_gem_right_clicked");
    await app.setValue(".popform input", "ruby_gem_right_clicked");
    await c.click(".popform button[type=submit]");
    await app.waitFor(`document.querySelector(".blocklyhost")`);
    await c.click(".abtn", "Back to elements");
    await openTile(app, "ruby gem", "ruby_gem");
    await c.click(".pagetabs .ltab", "Triggers");
    await c.select("Right-clicked in the air", "ruby_gem_right_clicked", ".formscroll");
    await c.click(".frow .btn.small", "Open");
  } else {
    await c.click(".pagetabs .ltab", "Triggers");
    await app.eval(`[...document.querySelectorAll(".frow")].find((r) => r.textContent.includes("Right-clicked in the air")).querySelector(".procnew").id = "np"`);
    await c.click("#np");
    note("New beside the field creates, sets and opens the procedure; Back returns to the item");
  }
  await app.waitFor(`document.querySelector(".blocklyhost")`);
  await app.shot(`${OUT}/${phase}-new-procedure.png`);
} finally {
  await app.close();
}

// ---- GUI and procedure editors on a copy of ETREconomy ----
const etr = copyProject(ETR, "etr");
app = await launchApp({ project: etr });
try {
  const c = counted(app);
  await app.waitFor(`document.querySelector(".tile")`, 20000);

  begin("procedure: open a procedure that calls others");
  await openTile(app, "tickler", "tickler");
  await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);
  await app.shot(`${OUT}/${phase}-procedure.png`);

  begin("procedure: find the 'give experience' block");
  await c.click(".procsearch input");
  await c.type("experience");
  await app.setValue(".procsearch input", "experience");
  await app.sleep(500);
  await app.shot(`${OUT}/${phase}-procedure-search.png`);
  const flyout = await app.eval<number>(`document.querySelector(".blocklyhost").blocklyWorkspace.getToolbox().getFlyout().getWorkspace().getTopBlocks().length`);
  note(`${flyout} results; the flyout covers the program`);

  begin("procedure: add it and connect it under the first block");
  const block = await app.eval<[number, number]>(`(() => { const b = document.querySelector(".blocklyhost").blocklyWorkspace.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).find((b) => b.type === "player_add_xp"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 30, r.y + 8]; })()`);
  const target = await app.eval<[number, number]>(`(() => { const ws = document.querySelector(".blocklyhost").blocklyWorkspace; const b = ws.getAllBlocks(false).find((b) => b.type === "call_procedure"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 20, r.y + r.height + 6]; })()`);
  await c.drag(block, target);
  await app.sleep(500);
  const used = await app.eval<number>(`document.querySelector(".blocklyhost").blocklyWorkspace.getAllBlocks(false).filter((b) => b.type === "player_add_xp").length`);
  note(used ? "dragged from the flyout onto the canvas" : "the drag did not land a block");
  const personal = await app.eval<boolean>(`[...document.querySelectorAll(".blocklyToolboxCategory")].some((c) => c.textContent === "Recently used")`);
  note(personal ? "it is in Recently used now; right click adds it to Favourites" : "no favourites or recently used blocks: the same search is typed again next time");

  begin("procedure: find a global variable (tick)");
  await c.click(".blocklyTreeRow, .blocklyToolboxCategory", "Variables");
  await app.sleep(400);
  const varBlocks = await app.eval<number>(`document.querySelector(".blocklyhost").blocklyWorkspace.getToolbox().getFlyout().getWorkspace().getTopBlocks().length`);
  note(`the Variables category shows ${varBlocks} generic blocks; the variable is picked in each block's dropdown, globals are not listed in the side panel`);

  begin("procedure: open the called procedure 'iksircall'");
  await app.eval(`(() => { const ws = document.querySelector(".blocklyhost").blocklyWorkspace; ws.getToolbox().clearSelection(); ws.getAllBlocks(false).find((b) => b.type === "call_procedure" && b.getFieldValue("procedure") === "iksircall").pathObject.svgPath.id = "callblock"; })()`);
  await c.click("#callblock", undefined, { button: "right" });
  const canOpen = await app.eval<boolean>(`[...document.querySelectorAll(".blocklyMenuItem")].some((m) => m.textContent.includes("Open procedure"))`);
  if (canOpen) {
    await c.click(".blocklyMenuItem", "Open procedure iksircall");
    note("right click > Open procedure; Back returns to tickler");
  } else {
    await app.key("Escape");
    note("no way from the block: back to the list, search, open (the program's view is lost)");
    await c.click(".abtn", "Back to elements");
    await openTile(app, "iksircall", "iksircall");
  }
  await app.waitFor(`document.querySelector(".edname")?.textContent === "iksircall"`);
  // Back to the list (after the fixes Back first returns to tickler; not counted).
  await c.click(".actions .abtn");
  while (await app.eval<boolean>(`!!document.querySelector(".edname")`)) await app.click(".actions .abtn");

  begin("gui: open a GUI");
  await openTile(app, "testgui", "testgui");
  await app.waitFor(`document.querySelector(".guistage")`);
  await app.shot(`${OUT}/${phase}-gui.png`);

  begin("gui: add a textured button");
  await c.click(".abtn", "Add widget");
  await c.click(".menulist button", "Textured button");
  await c.click(".guiform .texpicked");
  await c.click(".texpop .texcell", "coin");
  note("the hover texture keeps the project's first texture when the normal one is picked");

  begin("gui: add a label with text");
  await c.click(".abtn", "Add widget");
  await c.click(".menulist button", "Label");
  await c.field("Text", "Coins", ".guiform");

  begin("gui: centre both horizontally on the screen");
  const align = await app.eval<boolean>(`!!document.querySelector("[data-align]")`);
  if (align) {
    await c.click("[data-align=center] .abtn");
    await app.eval(`[...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("Textured button")).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))`);
    task.clicks++;
    await c.click("[data-align=center] .abtn");
    note("centre the label on the screen, Shift+click the button, centre it on the label");
  } else {
    note("no align buttons: compute (176 - width) / 2 by hand and type X for each widget");
    await c.field("X", "73", ".guiform");
    await c.click(".lrow", "Textured button");
    await c.field("X", "80", ".guiform");
  }

  begin("gui: bind a procedure to the button");
  if (align) await c.click(".lrow", "Textured button");
  await c.select("On click", "iksircall", ".guiform");

  begin("gui: preview the screen without editor marks");
  const preview2 = await app.eval<boolean>(`[...document.querySelectorAll(".abtn")].some((b) => /Preview/.test(b.textContent))`);
  if (!preview2) note("no preview: selection frames, handles, slot numbers and the grid always show");
  else {
    await c.click(".abtn", "Preview");
    note("Preview (or P) hides frames, handles, slot numbers and the grid");
  }
  await app.shot(`${OUT}/${phase}-gui-edited.png`);

  begin("gui: find the keyboard shortcuts");
  if (await app.eval<boolean>(`!!document.querySelector(".abtn.compact[aria-label='Keyboard shortcuts']")`)) {
    await c.click(".abtn.compact[aria-label='Keyboard shortcuts']");
    note(`a list of ${await app.eval<number>(`document.querySelectorAll(".keytable tr").length`)} shortcuts (also the ? key)`);
    await c.key("Escape");
  } else note("only the empty-selection hint names arrows and Delete; undo keys are in tooltips; no list");
} finally {
  await app.close();
}

console.log(`\n${phase}: clicks / drags / typed keys per task`);
for (const [name, r] of Object.entries(results)) {
  console.log(`- ${name}: ${r.clicks} clicks, ${r.drags} drags, ${r.keys} keys`);
  for (const n of r.notes) console.log(`    ${n}`);
}
