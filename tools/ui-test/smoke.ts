/** Opens a copy of the example project and checks the workspace shows its elements. */
import { assert, exampleProject, run } from "./cdp.ts";

await run(async (app) => {
  await app.waitFor(`document.querySelectorAll(".tile").length > 0`);
  const tiles = await app.eval<number>(`document.querySelectorAll(".tile").length`);
  assert(tiles > 0, "workspace lists elements");
  console.log(`tiles: ${tiles}`);
}, { project: exampleProject() });
