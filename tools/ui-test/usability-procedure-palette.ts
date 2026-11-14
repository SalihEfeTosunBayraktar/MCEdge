/**
 * KUYRUK #65 (fix 3): the procedure editor's toolbox starts with Favourites and Recently used (empty states say
 * how to fill them); right click on a block adds it to or removes it from Favourites; a block that runs another
 * procedure has Open procedure in its right-click menu, and Back returns to the caller; Ctrl+F focuses the block
 * search. Screenshots go to design/usability/.
 */
import { assert, exampleProject, run, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/usability";
const project = exampleProject();
addElement(project, "procedure", "helper");
addElement(project, "procedure", "main", {
  program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "call_procedure", fields: { procedure: "helper" } }] }] },
});

const WS = `document.querySelector(".blocklyhost").blocklyWorkspace`;
const flyoutTypes = (app: App) => app.eval<string[]>(`${WS}.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).map((b) => b.type)`);
const flyoutText = (app: App) => app.eval<string>(`document.querySelector(".blocklyFlyout")?.textContent ?? ""`);
const category = async (app: App, name: string) => {
  await app.click(".blocklyToolboxCategory", name);
  await app.sleep(300);
};
/** Right click on a block (by type, in the flyout or on the canvas) and pick a menu item. */
const menu = async (app: App, where: "flyout" | "canvas", type: string, item: string) => {
  const ws = where === "flyout" ? `${WS}.getToolbox().getFlyout().getWorkspace()` : WS;
  // A click on the empty canvas closes an open category first.
  if (where === "canvas") await app.eval(`${WS}.getToolbox().clearSelection()`);
  await app.eval(`(() => { document.getElementById("rc")?.removeAttribute("id"); const b = ${ws}.getAllBlocks(false).find((b) => b.type === ${JSON.stringify(type)}); b.pathObject.svgPath.id = "rc"; })()`);
  await app.click("#rc", undefined, { button: "right" });
  await app.waitFor(`[...document.querySelectorAll(".blocklyMenuItem")].some((m) => m.textContent.includes(${JSON.stringify(item)}))`, 3000);
  await app.shot(`${OUT}/after-procedure-menu-${where}.png`);
  await app.click(".blocklyMenuItem", item);
  await app.sleep(300);
};
const slowDrag = async (app: App, from: [number, number], to: [number, number]) => {
  await app.mouse("mouseMoved", from[0], from[1], 0);
  await app.mouse("mousePressed", from[0], from[1]);
  for (let i = 1; i <= 20; i++) (await app.mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20, 1), await app.sleep(15));
  await app.mouse("mouseReleased", to[0], to[1], 0);
  await app.sleep(400);
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "main", { double: true });
  await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);
  const categories = await app.eval<string[]>(`[...document.querySelectorAll(".blocklyToolboxCategory")].map((c) => c.textContent)`);
  assert(categories[0] === "Favourites" && categories[1] === "Recently used", `personal categories first: ${categories.slice(0, 3)}`);
  await category(app, "Favourites");
  assert((await flyoutText(app)).includes("Add to favourites"), "empty Favourites says how to fill it");
  await app.shot(`${OUT}/after-procedure-favourites-empty.png`);

  // Ctrl+F focuses the search; the give experience block is found and dragged under the call block.
  await app.click(".blocklyhost");
  await app.key("f", 2);
  assert(await app.eval<boolean>(`document.activeElement === document.querySelector(".procsearch input")`), "Ctrl+F focuses the block search");
  await app.type("experience");
  await app.sleep(500);
  const from = await app.eval<[number, number]>(`(() => { const b = ${WS}.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).find((b) => b.type === "player_add_xp"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 30, r.y + 8]; })()`);
  const to = await app.eval<[number, number]>(`(() => { const b = ${WS}.getAllBlocks(false).find((b) => b.type === "call_procedure"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 20, r.y + r.height + 6]; })()`);
  await slowDrag(app, from, to);
  assert(await app.eval<string>(`${WS}.getAllBlocks(false).find((b) => b.type === "player_add_xp")?.getParent()?.type`) === "call_procedure", "block connected under the call");
  await app.key("Escape");

  // It is first in Recently used now.
  await category(app, "Recently used");
  assert((await flyoutTypes(app))[0] === "player_add_xp", `recently used: ${await flyoutTypes(app)}`);
  await app.shot(`${OUT}/after-procedure-recent.png`);

  // Right click in the flyout: Add to favourites; it shows under Favourites, and Remove takes it out again.
  await menu(app, "flyout", "player_add_xp", "Add to favourites");
  await category(app, "Favourites");
  assert((await flyoutTypes(app)).includes("player_add_xp"), "added to Favourites from the flyout");
  await app.shot(`${OUT}/after-procedure-favourites.png`);
  await menu(app, "canvas", "player_add_xp", "Remove from favourites");
  await category(app, "Favourites");
  assert(!(await flyoutTypes(app)).includes("player_add_xp"), "removed from Favourites on the canvas");
  await menu(app, "flyout", "player_add_xp", "Add to favourites").catch(async () => {
    await category(app, "Recently used");
    await menu(app, "flyout", "player_add_xp", "Add to favourites");
  });

  // Open procedure on the call block, then Back to main.
  await app.key("Escape");
  await menu(app, "canvas", "call_procedure", "Open procedure helper");
  await app.waitFor(`document.querySelector(".edname")?.textContent === "helper"`);
  await app.click(".abtn", "Back to main");
  await app.waitFor(`document.querySelector(".edname")?.textContent === "main"`);
  console.log("open a called procedure: 2 clicks (right click, Open), 0 keys (before: 5 clicks, 9 keys)");
}, { project });
