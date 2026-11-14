/**
 * KUYRUK 174: the Export mod jar dialog keeps the keyboard focus through an export. Starting the export disables the
 * focused Export button and the fields, which dropped the focus to the page body, so Escape did nothing until a click.
 * The export itself is replaced in the main process by a short fake (no Gradle). After it finishes the focus is inside
 * the dialog and Escape closes it. Screenshot: design/174/after-en-dark.png.
 */
import { assert, exampleProject, run } from "./cdp.ts";

await run(async (app) => {
  await app.mainEval(`(() => {
    const { ipcMain } = (process.mainModule ? process.mainModule.require : require)("electron");
    ipcMain.removeHandler("export:run");
    ipcMain.handle("export:run", async (_e, _dir, ids) => {
      await new Promise((r) => setTimeout(r, 800));
      return ids.map((engineId) => ({ engineId, ok: true, jar: "C:/out/hello-" + engineId + ".jar", skipped: [], warnings: [] }));
    });
    return true;
  })()`);
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.key("e", 2);
  await app.waitFor(`document.querySelector(".exportdlg")`);
  await app.waitFor(`!document.querySelector(".exportdlg button[type=submit]").disabled`);
  // Export with the keyboard, as a user would: focus the button and press Enter.
  await app.eval(`document.querySelector(".exportdlg button[type=submit]").focus()`);
  await app.key("Enter");
  await app.waitFor(`document.querySelector(".exportdlg .exportres, .exportdlg code")`, 10000);
  await app.waitFor(`!document.querySelector(".exportdlg button[type=submit]").disabled`);
  await app.sleep(200);
  const where = await app.eval<string>(`document.activeElement === document.body ? "body" : document.querySelector(".exportdlg").contains(document.activeElement) ? "dialog" : document.activeElement.tagName`);
  assert(where === "dialog", `focus stays in the dialog after the export: ${where}`);
  await app.shot("design/174/after-en-dark.png");
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".exportdlg")`, 3000);
  assert(true, "Escape closes the dialog right after the export");
}, { project: exampleProject() });
