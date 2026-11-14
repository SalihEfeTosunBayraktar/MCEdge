/**
 * KUYRUK 156: the Dependencies tab shows, per engine, the jars dev runs load for a dependency (status, version, the
 * dependency that pulled it in, the file) from the machine's cache, and Resolve jars fills the cache (deps:jars with
 * resolve). Runs on a copy of examples/hello; reads the real cache (<toolchains>/mods/index.json) to know what to expect.
 * The Resolve step runs after the dependencies are cut down to the ones already cached, so it needs no network.
 * Args: theme (dark/light), language (en/tr). Screenshots go to design/156/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cachedModDependencies } from "../../src/build/modDependencies.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { assert, exampleProject, run } from "./cdp.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const project = exampleProject();
const read = () => JSON.parse(readFileSync(join(project, "mcedge.json"), "utf8"));
const engines = listEngines();
const expected = (modId: string) => {
  const dep = read().mod.dependencies.find((d: { modId: string }) => d.modId === modId);
  return Object.fromEntries(engines.map((e) => [e.id, cachedModDependencies([dep], e)[0]]));
};
const panel = () => `[...document.querySelectorAll("[data-testid=dependency-jars] li")].map((li) => ({
  engine: li.dataset.engine, status: li.dataset.status, text: li.textContent }))`;

await run(async (app) => {
  await app.setTheme(theme);
  await app.eval(`document.querySelectorAll(".rail .rtab")[6].click()`);
  await app.waitFor(`document.querySelector(".view [role=tab]")`);
  await app.eval(`document.querySelectorAll(".view [role=tab]")[1].click()`);
  await app.waitFor(`document.querySelector(".view .grid tbody tr")`);

  // 1. Every engine is listed for the selected dependency, with the cached status, version, via and file.
  for (const modId of ["geckolib", "jei", "architectury"]) {
    await app.click(".view .grid tbody tr", modId);
    await app.waitFor(`document.querySelectorAll("[data-testid=dependency-jars] li").length === ${engines.length}`);
    const want = expected(modId);
    const shown = await app.eval<{ engine: string; status: string; text: string }[]>(panel());
    for (const row of shown) {
      const r = want[row.engine];
      assert(row.status === r.status, `${modId} on ${row.engine}: status ${row.status}, cache says ${r.status}`);
      for (const jar of r.jars) {
        const file = jar.file.split(/[\\/]/).pop()!;
        assert(row.text.includes(jar.version) && row.text.includes(file), `${modId} on ${row.engine} shows ${jar.version} and ${file}: ${row.text}`);
        if (jar.via) assert(row.text.includes(jar.via), `${modId} on ${row.engine} names the dependency that pulled ${jar.project} in`);
      }
    }
    if (modId === "jei") await app.shot(`design/156/dependencies-jei-${theme}-${lang}-after.png`);
    if (modId === "geckolib") await app.shot(`design/156/dependencies-${theme}-${lang}-after.png`);
  }
  // The table summarises each dependency over the engines.
  const resolved = Object.values(expected("geckolib")).filter((r) => r.status === "resolved").length;
  const cell = await app.eval<string>(`[...document.querySelectorAll(".view .grid tbody tr")].find((r) => r.textContent.includes("geckolib")).lastElementChild.textContent`);
  assert(cell.includes(String(resolved)) && cell.includes(String(engines.length)), `summary cell: ${cell}`);

  // 2. Resolve jars: keep only geckolib (cached, so no download), then resolve; the panel shows every engine resolved.
  for (const modId of ["jei", "architectury"]) {
    await app.click(".view .grid tbody tr", modId);
    await app.eval(`[...document.querySelectorAll(".view .actions .abtn")].at(-1).click()`);
    await app.sleep(100);
  }
  for (let i = 0; i < 40 && read().mod.dependencies.length !== 1; i++) await app.sleep(100);
  assert(read().mod.dependencies.length === 1, "two dependencies deleted and saved");
  await app.click(".view .grid tbody tr", "geckolib");
  const button = `[...document.querySelectorAll(".view .actions .abtn")][1]`;
  assert(await app.eval<boolean>(`!${button}.disabled`), "Resolve jars is enabled");
  await app.eval(`${button}.click()`);
  await app.waitFor(`${button}.disabled`, 2000).catch(() => {}); // may finish before the first poll
  await app.waitFor(`!${button}.disabled`, 120000);
  const after = await app.eval<{ engine: string; status: string }[]>(panel());
  assert(after.length === engines.length && after.every((r) => r.status === "resolved"), `after resolve: ${JSON.stringify(after)}`);
  assert(!(await app.eval<boolean>(`!!document.querySelector(".view .ferr")`)), "no error shown");
  console.log(`dependency jars on ${engines.length} engines OK (${theme}, ${lang})`);
}, { project, theme, language: lang });
