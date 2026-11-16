/**
 * Q210: File > Open project folder shows the open project's folder in the OS file manager through the main process
 * (shell.openPath, replaced here so nothing opens). The menu item is disabled without a project, and the IPC refuses
 * any folder but the open project's. English and Turkish, dark and light; screenshots go to design/210/.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert, exampleProject, launchApp, REPO } from "./cdp.ts";

const OUT = "design/210";
mkdirSync(join(REPO, OUT), { recursive: true });
const project = exampleProject();
const electron = `(process.mainModule ? process.mainModule.require : require)("electron")`;

for (const language of ["en", "tr"] as const) {
  const s = language === "en" ? en : tr;
  const label = s["menu.openProjectFolder"];
  const item = `[...document.querySelectorAll(".menulist button")].find((b) => b.textContent.includes(${JSON.stringify(label)}))`;
  const app = await launchApp({ project, language });
  try {
    await app.waitFor(`document.querySelector(".menubar")`, 15000);
    await app.mainEval(`(() => { const e = ${electron}; globalThis.__paths = []; e.shell.openPath = async (p) => (globalThis.__paths.push(p), ""); })()`);
    const paths = () => app.mainEval<string[]>(`globalThis.__paths`);
    const fileMenu = async () => {
      await app.click(".menu", s["menu.file"]);
      await app.waitFor(`document.querySelector(".menulist")`);
    };

    await fileMenu();
    assert(await app.eval<boolean>(`!!(${item})`), `${language}: File has "${label}"`);
    assert(!(await app.eval<boolean>(`(${item}).disabled`)), `${language}: enabled with a project open`);
    await app.shot(`${OUT}/file-menu-${language}-dark.png`);
    if (language === "en") {
      await app.setTheme("light");
      await app.shot(`${OUT}/file-menu-en-light.png`);
      await app.setTheme("dark");
      if (!(await app.eval<boolean>(`!!document.querySelector(".menulist")`))) await fileMenu();
    }
    await app.click(".menulist button", label);
    await app.waitFor(`document.querySelector(".menulist") === null`);
    await app.sleep(300);
    const opened = await paths();
    assert(opened.length === 1 && resolve(opened[0]) === resolve(project), `${language}: openPath got the project folder (${JSON.stringify(opened)} vs ${project})`);

    // The IPC accepts nothing but the open project's folder.
    const other = (dir: string) => app.eval<string>(`window.mcedge.openProjectFolder(${JSON.stringify(dir)}).then(() => "ok", (e) => String(e))`);
    assert((await other(dirname(project))).includes("only the open project"), `${language}: another folder is refused`);
    assert((await paths()).length === 1, `${language}: a refused folder opens nothing`);

    // Without a project the item is disabled.
    await fileMenu();
    await app.click(".menulist button", s["menu.closeProject"]);
    await app.waitFor(`!document.querySelector(".status .smsg")`);
    await fileMenu();
    assert(await app.eval<boolean>(`(${item}).disabled`), `${language}: disabled without a project`);
    await app.click(".menulist button", label);
    await app.sleep(300);
    assert((await paths()).length === 1, `${language}: the disabled item opens nothing`);
    if (language === "tr") await app.shot(`${OUT}/file-menu-closed-tr-dark.png`);
    console.log(`PASS ${language}`);
  } catch (error) {
    console.error("FAIL", language, error);
    await app.shot("tools/ui-test/last-failure.png").catch(() => {});
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
