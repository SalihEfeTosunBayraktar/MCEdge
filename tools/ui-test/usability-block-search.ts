/**
 * KUYRUK #78: the block search ranks an exact label, then favourites, then labels that start with the words; Enter
 * adds the first result under the selected block (else at the end of the start stack), clears the search and closes
 * the flyout; the block lands in Recently used. Screenshots go to design/usability/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/usability");
const project = exampleProject();
addElement(project, "procedure", "main", {
  program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "call_procedure", fields: { procedure: "main" } }, { block: "player_add_xp" }] }] },
});

addElement(project, "procedure", "blank");
const WS = `document.querySelector(".blocklyhost").blocklyWorkspace`;
const flyoutTypes = (app: App) => app.eval<string[]>(`${WS}.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).map((b) => b.type)`);
const chain = (app: App) => app.eval<string[]>(`(() => { let b = ${WS}.getTopBlocks(false).find((b) => b.type === "start"); const out = []; for (; b; b = b.getNextBlock()) out.push(b.type); return out; })()`);
const search = async (app: App, text: string) => {
  await app.eval(`document.querySelector(".procsearch input").focus()`);
  await app.setValue(".procsearch input", text);
  await app.sleep(400);
};

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "main", { double: true });
  await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);

  // Ranking: the library order of "player" matches, then the same with the last one a favourite.
  await search(app, "player");
  const plain = await flyoutTypes(app);
  assert(plain.length > 3, `several matches: ${plain.length}`);
  const last = plain.at(-1)!;
  assert(plain[0] !== last, "the last match is not first by default");
  await app.eval(`localStorage.setItem("mcedge.procedures.favourites", JSON.stringify([${JSON.stringify(last)}]))`);
  await search(app, "");
  await search(app, "player");
  const ranked = await flyoutTypes(app);
  assert(ranked[0] === last, `a favourite match comes first: ${ranked[0]} (was last: ${last})`);
  await app.shot(`${OUT}/after-block-search-ranked.png`);
  await app.eval(`localStorage.removeItem("mcedge.procedures.favourites")`);

  // Enter adds the first result under the selected block.
  await search(app, "give experience");
  const first = (await flyoutTypes(app))[0];
  assert(first === "player_add_xp", `the label that starts with the words is first: ${first}`);
  await app.eval(`(() => { const b = ${WS}.getTopBlocks(false).find((b) => b.type === "start").getNextBlock(); ${WS}.getToolbox().clearSelection(); document.querySelector(".blocklyhost").blockly.common.setSelected(b); })()`);
  await app.eval(`document.querySelector(".procsearch input").focus()`);
  await app.key("Enter");
  await app.sleep(500);
  const after = await chain(app);
  
  assert(after.join() === `start,call_procedure,${first},player_add_xp`, `added under the selected block: ${after}`);
  assert(await app.eval<string>(`document.querySelector(".procsearch input").value`) === "", "the search is cleared");
  assert(await app.eval<boolean>(`!${WS}.getToolbox().getFlyout().isVisible()`), "the flyout is closed");
  assert(await app.eval<boolean>(`JSON.parse(localStorage.getItem("mcedge.procedures.recent") ?? "[]")[0] === ${JSON.stringify(first)}`), "the block is in Recently used");
  await app.shot(`${OUT}/after-block-search-enter.png`);

  // The block just added is selected, so a second Enter chains after it.
  await search(app, "give experience");
  await app.eval(`document.querySelector(".procsearch input").focus()`);
  await app.key("Enter");
  await app.sleep(500);
  const end = await chain(app);
  assert(end.join() === "start,call_procedure,player_add_xp,player_add_xp,player_add_xp", `a second block was added: ${end}`);

  // Nothing selected: it goes to the end of the start stack.
  await app.click(".abtn", "Back to elements");
  await app.click(".tile", "blank", { double: true });
  await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);
  await search(app, "give experience");
  await app.key("Enter");
  await app.sleep(500);
  const blank = await chain(app);
  assert(blank.join() === "start,player_add_xp", `end of the start stack: ${blank}`);
}, { project });
