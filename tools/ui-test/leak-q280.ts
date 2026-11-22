/**
 * Q280: opening and closing an element editor must not leave its page in memory. Block editors kept ~4,000 DOM nodes
 * each (OrbitControls' keydown listener on the document held the whole page); a type's editor is opened 8 times and
 * the DOM node count after garbage collection may not grow by more than a few nodes per open.
 */
import { assert, exampleProject, run, type App } from "./cdp.ts";

const project = exampleProject();

async function nodes(app: App): Promise<number> {
  await app.cdp("HeapProfiler.collectGarbage");
  await app.sleep(200);
  await app.cdp("HeapProfiler.collectGarbage");
  return (await app.cdp("Memory.getDOMCounters")).nodes;
}

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tiles .tile")`, 30000);
  const types = await app.eval<string[]>(`[...document.querySelectorAll(".tile:not(.foldertile)")].slice(0, 40).map((t) => t.getAttribute("title") || t.textContent.trim())`);
  assert(types.length > 0, "the example project has element tiles");
  const cycle = async (index: number) => {
    await app.eval(`document.querySelectorAll(".tile:not(.foldertile)")[${index}].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
    await app.waitFor(`document.querySelector(".edhead")`, 15000);
    await app.sleep(250);
    await app.click(".rail .rtab");
    await app.waitFor(`document.querySelector(".tiles .tile")`);
  };
  const count = await app.eval<number>(`document.querySelectorAll(".tile:not(.foldertile)").length`);
  for (let tile = 0; tile < Math.min(count, 12); tile++) {
    await cycle(tile);
    const before = await nodes(app);
    for (let i = 0; i < 8; i++) await cycle(tile);
    const grown = (await nodes(app)) - before;
    console.log(`tile ${tile}: +${grown} nodes after 8 opens`);
    assert(grown < 8 * 60, `tile ${tile} editor leaks DOM nodes (+${grown})`);
  }
}, { project });
