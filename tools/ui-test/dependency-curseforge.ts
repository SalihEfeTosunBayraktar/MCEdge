/**
 * KUYRUK 184: the Dependencies tab edits a dependency's CurseForge project (source.curseforge, KUYRUK 173). On a copy
 * of examples/hello: jei gets "238222", saved in mcedge.json; emptying the field removes source again (no empty key).
 * BEFORE=1 only takes the before screenshot. Screenshots go to design/184/ (en and tr dark, en light).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/184");
const until = async (app: App, check: () => boolean, message: string) => {
  for (let i = 0; i < 50 && !check(); i++) await app.sleep(100);
  assert(check(), message);
};

for (const language of ["en", "tr"]) {
  const project = exampleProject();
  const jei = () => (JSON.parse(readFileSync(join(project, "mcedge.json"), "utf8")).mod.dependencies as { modId: string; source?: Record<string, string> }[])
    .find((d) => d.modId === "jei")!;
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile")`, 60000);
    await app.eval(`document.querySelectorAll(".rail .rtab")[6].click()`);
    await app.waitFor(`document.querySelector(".view [role=tab]")`);
    await app.eval(`document.querySelectorAll(".view [role=tab]")[1].click()`);
    await app.waitFor(`document.querySelector(".view .grid tbody tr")`);
    await app.click(".view .grid tbody tr", "jei");
    await app.sleep(300);
    if (process.env.BEFORE) {
      await app.shot(`${OUT}/before-${language}-dark.png`);
      return;
    }
    await app.waitFor(`document.querySelector(".depcf")`);
    await app.setValue(".depcf", "238222");
    await until(app, () => jei().source?.curseforge === "238222", `saved: ${JSON.stringify(jei())}`);
    await app.shot(`${OUT}/after-${language}-dark.png`);
    if (language === "tr") return;
    await app.setTheme("light");
    await app.sleep(300);
    await app.shot(`${OUT}/after-en-light.png`);
    await app.setTheme("dark");
    await app.setValue(".depcf", "");
    await until(app, () => jei().source === undefined, `cleared without an empty source: ${JSON.stringify(jei())}`);
  }, { project, language, width: 1440, height: 900 });
}
