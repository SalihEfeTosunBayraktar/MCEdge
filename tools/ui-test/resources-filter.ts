/**
 * KUYRUK #31: every folder filter of Resources shows textures, on a project whose folders are items/ and blocks/
 * rather than MCEdge's item/ and block/ (a converted mod), and a search without a match says so.
 */
import { assert, copyProject, run } from "./cdp.ts";

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const cells = `document.querySelectorAll(".texcell").length`;

await run(async (app) => {
  await app.click(".rtab", "Resources");
  await app.waitFor(cells, 15000);
  const select = `document.querySelector(".fsel select")`;
  const values = await app.eval<string[]>(`[...${select}.options].map((o) => o.value)`);
  assert(values.length > 2, "folders are listed");
  for (const value of values) {
    await app.eval(`(() => { const s = ${select}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await app.sleep(150);
    const shown = await app.eval<number>(cells);
    console.log(`${value || "(root)"}: ${shown}`);
    assert(shown > 0, `filter "${value}" shows textures`);
  }
  await app.eval(`(() => { const i = document.querySelector("input[placeholder]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "no_such_texture"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await app.waitFor(`document.querySelector(".empty-note")?.textContent === "No texture matches the search."`, 5000);
}, { project });
