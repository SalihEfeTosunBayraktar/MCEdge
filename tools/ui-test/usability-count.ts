/**
 * KUYRUK #82: a project whose elements all sit in folders says "N of N elements" at the root (it said 0 of N), and
 * inside a folder counts what is under that folder. Screenshot in design/usability/.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { typeRegistry } from "../../src/elements/registry.ts";
import { assert, exampleProject, run } from "./cdp.ts";

const OUT = "design/usability";
const project = exampleProject();
const placement: Record<string, string> = {};
let n = 0;
for (const dir of readdirSync(join(project, "elements"), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const file of readdirSync(join(project, "elements", dir.name)).filter((f) => f.endsWith(".json"))) {
    const typeId = [...typeRegistry().byId.values()].find((t) => t.folder === dir.name)?.id;
    if (!typeId) continue;
    placement[`${typeId}/${file.slice(0, -5)}`] = "Stuff/Inner";
    n++;
  }
}
writeFileSync(join(project, "folders.json"), JSON.stringify({ folders: ["Stuff", "Stuff/Inner"], placement }, null, 2));

const meta = (app: { eval<T>(e: string): Promise<T> }) => app.eval<string>(`document.querySelector(".fmeta")?.textContent ?? ""`);
await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  const root = await meta(app);
  console.log("root:", root, "placed:", n);
  assert(root.startsWith(`${n} of ${n} `), `root counts the elements inside folders: ${root}`);
  await app.shot(`${OUT}/after-count-root.png`);
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname").textContent === "Stuff").id = "target"`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`[...document.querySelectorAll(".tile .tname")].some((t) => t.textContent === "Inner")`);
  assert((await meta(app)).startsWith(`${n} of `), `folder counts its subfolders too: ${await meta(app)}`);
}, { project });
