/**
 * KUYRUK #154: Build output entries of runs have their own states. Events go through the build event channel the
 * way the main process sends them (no Gradle): a build is Building / OK / Failed; a server or client run is Starting,
 * Running, Stopped (the user stopped it, whatever the exit code), Ended (exit 0) or Crashed (exited non-zero on its
 * own). The real stop flags of the main process are checked by gradle-commands.ts (heavy). Screenshots: design/154/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/154");
type Event = { type: "start" | "line" | "done"; engineId: string; ok?: boolean; stopped?: boolean; line?: string };
const send = (app: App, events: Event[]) => app.mainEval(`(() => {
  const { BrowserWindow } = (process.mainModule ? process.mainModule.require : require)("electron");
  for (const e of ${JSON.stringify(events)}) BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("build:event", e));
  return true;
})()`);
const state = (app: App, key: string) => app.eval<[string, string]>(`(() => {
  const b = [...document.querySelectorAll(".engines li button")].find((b) => b.querySelector(".eng")?.textContent === ${JSON.stringify(key)});
  return b ? [b.querySelector(".dim").textContent, b.querySelector(".led").className] : ["", ""];
})()`);

await run(async (app) => {
  const E = "fabric-1.21.5";
  await send(app, [{ type: "start", engineId: E }, { type: "start", engineId: `${E} server` }, { type: "start", engineId: `${E} client` }]);
  await app.click(".sitem.gradle");
  await app.waitFor(`document.querySelectorAll(".engines li").length === 3`);
  await send(app, [{ type: "line", engineId: `${E} server`, line: "[Server thread/INFO]: Done (3.2s)!" }]);
  // Waiting entries: a build waits, a run starts.
  let [label, led] = await state(app, `${E} client`);
  assert(label === "Running" || label === "Starting", `a started client is not "Building": ${label}`);
  [label, led] = await state(app, `${E} server`);
  assert(label === "Running" && led.includes("run"), `a running server says Running: ${label} ${led}`);
  assert((await state(app, E))[0] === "Building", "a build still says Building");
  await app.shot(`${OUT}/154-running-dark.png`);

  // The user stops the server (non-zero exit), the client crashes, the build fails.
  await send(app, [
    { type: "done", engineId: `${E} server`, ok: false, stopped: true },
    { type: "done", engineId: `${E} client`, ok: false },
    { type: "done", engineId: E, ok: false },
  ]);
  await app.waitFor(`!document.querySelector(".engines .led.running, .engines .led.waiting")`);
  assert((await state(app, `${E} server`))[0] === "Stopped", `a stopped server says Stopped: ${(await state(app, `${E} server`))[0]}`);
  [label, led] = await state(app, `${E} client`);
  assert(label === "Crashed" && led.includes("failed"), `a client that exits non-zero on its own says Crashed: ${label}`);
  assert((await state(app, E))[0] === "Failed", "a failed build says Failed");
  await app.shot(`${OUT}/154-ended-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/154-ended-light.png`);

  // A run that ends by itself with exit 0 says Ended.
  await send(app, [{ type: "start", engineId: `${E} client` }, { type: "done", engineId: `${E} client`, ok: true }]);
  await app.waitFor(`[...document.querySelectorAll(".engines li")].some((li) => li.textContent.includes("Ended"))`);
}, { project: exampleProject() });
