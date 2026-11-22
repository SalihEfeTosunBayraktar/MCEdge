/**
 * KUYRUK #69: icon-only Build and Run buttons beside the engine picker in the title bar. The main process handlers are
 * replaced by recorders, so no Gradle build or game starts: the test checks that the buttons exist with tooltips, that
 * they call the same commands as the Build & run menu, and that Run turns into Stop while the client runs.
 * Screenshots go to design/title-run-build/.
 */
import { assert, exampleProject, run, evidence } from "./cdp.ts";

const OUT = evidence("design/title-run-build");
const btn = (id: string) => `document.querySelector('[data-testid="${id}"]')`;

await run(async (app) => {
  await app.waitFor(`!!${btn("top-run")}`);
  await app.mainEval(`(() => {
    const { ipcMain } = (process.mainModule ? process.mainModule.require : require)("electron");
    globalThis.__calls = [];
    for (const channel of ["build:run", "client:run"]) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_e, ...args) => { globalThis.__calls.push([channel, ...args.slice(1)]); return []; });
    }
    return true;
  })()`);
  const info = await app.eval<{ text: string; run: string; build: string; engine: boolean }>(`({
    text: ${btn("top-run")}.textContent + ${btn("top-build")}.textContent,
    run: ${btn("top-run")}.title, build: ${btn("top-build")}.title,
    engine: !!document.querySelector(".enginebtn") && ${btn("top-run")}.compareDocumentPosition(document.querySelector(".enginebtn")) !== 0,
  })`);
  assert(info.text === "" && info.engine, `icon only, beside the engine picker: ${JSON.stringify(info)}`);
  assert(/Run client/.test(info.run) && /Build/.test(info.build), `tooltips: ${info.run} / ${info.build}`);
  await app.shot(`${OUT}/idle.png`);

  const calls = () => app.mainEval<string>(`JSON.stringify(globalThis.__calls)`);
  await app.click('[data-testid="top-run"]');
  await app.waitFor(`/Stop client/.test(${btn("top-run")}.title)`);
  assert((await calls()).includes("client:run"), `Run calls the client: ${await calls()}`);
  await app.shot(`${OUT}/running.png`);
  await app.click('[data-testid="top-run"]'); // Stop; the stubbed run never reports the end, so the build state stays.

  await app.click('[data-testid="top-build"]');
  await app.waitFor(`${btn("top-build")}.disabled`);
  assert((await calls()).includes("build:run"), `Build calls the build: ${await calls()}`);
}, { project: exampleProject() });
