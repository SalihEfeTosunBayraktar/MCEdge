/**
 * KUYRUK 176: element tiles of blocks with a JSON model show the model as the inventory does, not the flat texture.
 * On a copy of ETREconomy (Donation Box and the other custom-model blocks): the tiles hold plain images (no WebGL
 * canvas per tile), each model is rendered once and cached (opening an element and coming back renders nothing new),
 * and a change to a model file renders that project's pictures again. Args: theme. Screenshots in design/176/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, copyProject, run, type App } from "./cdp.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const renders = (app: App) => app.eval<number>(`window.mcedgeThumbnails?.renders ?? 0`);
const donate = `[...document.querySelectorAll(".tile")].find((t) => t.querySelector("code")?.textContent === "donatebox")`;

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  // The blocks sit in folders; the search lists the donation boxes and the other custom-model blocks named like them.
  const search = `.findbar input, input[placeholder^="Search in this workspace"]`;
  await app.setValue(search, "don");
  await app.waitFor(`${donate}?.querySelector("img.tmodel")`, 30000);
  await app.eval(`${donate}.scrollIntoView({ block: "center" })`);
  await app.sleep(300);
  // The picture is the model, not empty: some opaque pixels, and not just the block texture.
  const opaque = await app.eval<number>(`(async () => {
    const img = ${donate}.querySelector("img.tmodel");
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n / (c.width * c.height);
  })()`);
  assert(opaque > 0.1 && opaque < 0.98, `Donation Box tile shows its model (${Math.round(opaque * 100)}% of the picture covered)`);
  assert(await app.eval<string>(`${donate}.querySelector("img.tmodel").dataset.model`) === "donatebox", "drawn from its customModelName");
  assert(await app.eval<number>(`document.querySelectorAll(".tile canvas").length`) === 0, "no live canvas in the tiles");
  const tiles = await app.eval<number>(`document.querySelectorAll(".tile img.tmodel").length`);
  const first = await renders(app);
  assert(first > 0 && first <= tiles, `${tiles} model tiles, ${first} pictures rendered (one per model)`);
  await app.shot(`design/176/after-${theme}.png`);

  // Open an element and come back: the pictures come from the cache.
  await app.eval(`${donate}.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelector(".editorhead, .ehead, .actions")`);
  await app.sleep(500);
  await app.key("w", 2);
  await app.waitFor(`${donate}?.querySelector("img.tmodel")`, 10000);
  assert(await renders(app) === first, `coming back renders nothing new (${await renders(app)} = ${first})`);

  // A model file changes on disk: the project's pictures are drawn again.
  const file = join(project, "models", "donatebox.json");
  writeFileSync(file, readFileSync(file, "utf8") + "\n");
  await app.waitFor(`(window.mcedgeThumbnails?.renders ?? 0) > ${first}`, 15000);
  await app.waitFor(`${donate}?.querySelector("img.tmodel")`, 10000);
  assert(true, `a changed model renders again (${await renders(app)} pictures)`);
}, { project, theme });
