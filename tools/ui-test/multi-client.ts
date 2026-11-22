/**
 * KUYRUK 190: several clients of one engine with their own player names, and joining the test server. The main process
 * handlers of client:run / client:stop are replaced by recorders that report the run as started, so no Gradle build or
 * game starts (tools/codegen-test/multi-client-check.ts runs the real games). Checks the title bar button and the Build
 * & run items, the Run another client dialog (default Dev2, name checks, join), one Build output entry with its own
 * Stop per client, and Join test server while the server runs. Screenshots (dark and light) go to design/190/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/190");
const btn = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const menu = async (app: App, top: string, item: string) => {
  await app.click(".menu", top);
  await app.click(".menulist button", item);
};
const menuItem = (item: string) => `[...document.querySelectorAll(".menulist button")].find((b) => b.textContent.includes(${JSON.stringify(item)}))`;

await run(async (app) => {
  await app.waitFor(`!!${btn("top-run")}`);
  await app.mainEval(`(() => {
    const { ipcMain } = (process.mainModule ? process.mainModule.require : require)("electron");
    globalThis.__calls = [];
    const key = (engineId, player) => !player || player === "Dev" ? engineId + " client" : engineId + " client " + player;
    ipcMain.removeHandler("client:run");
    ipcMain.handle("client:run", (e, _dir, engineId, options) => {
      globalThis.__calls.push(["client:run", engineId, options ?? {}]);
      globalThis.__sender = e.sender;
      e.sender.send("build:event", { type: "start", engineId: key(engineId, options?.player) });
      e.sender.send("build:event", { type: "line", engineId: key(engineId, options?.player), line: "[mcedge] player " + (options?.player ?? "Dev") + (options?.join ? ", joining the test server on port 25565" : "") });
    });
    ipcMain.removeHandler("client:stop");
    ipcMain.handle("client:stop", (e, k) => {
      globalThis.__calls.push(["client:stop", k]);
      e.sender.send("build:event", { type: "done", engineId: k, ok: false, stopped: true });
    });
    return true;
  })()`);
  const calls = async () => JSON.parse(await app.mainEval<string>(`JSON.stringify(globalThis.__calls)`)) as [string, ...unknown[]][];
  const engine = await app.eval<string>(`document.querySelector(".enginebtn").textContent`);

  // Title bar: an icon-only button beside Run with a tooltip.
  const another = await app.eval<{ text: string; title: string; after: boolean }>(`({
    text: ${btn("top-run-another")}.textContent, title: ${btn("top-run-another")}.title,
    after: !!(${btn("top-run")}.compareDocumentPosition(${btn("top-run-another")}) & Node.DOCUMENT_POSITION_FOLLOWING),
  })`);
  assert(another.text === "" && another.title === "Run another client" && another.after, `title bar button: ${JSON.stringify(another)}`);

  // Build & run: Run another client is there, Join test server is off while no server runs.
  await app.click(".menu", "Build & run");
  assert(await app.eval(`!${menuItem("Run another client...")}.disabled && ${menuItem("Join test server")}.disabled`), "menu items: another client on, join off without a server");
  await app.key("Escape");

  // Dev with Run (F5 button), then another client from the title bar button: the dialog offers Dev2.
  await app.click('[data-testid="top-run"]');
  await app.waitFor(`/Stop client/.test(${btn("top-run")}.title)`);
  await app.click('[data-testid="top-run-another"]');
  await app.waitFor(`!!document.querySelector('[data-testid="run-client"]')`);
  const dialog = await app.eval<{ player: string; join: boolean }>(`({ player: document.querySelector('[name="player"]').value, join: document.querySelector('[name="join"]').checked })`);
  assert(dialog.player === "Dev2" && !dialog.join, `dialog defaults: ${JSON.stringify(dialog)}`);
  // A running player's name and a bad name are refused.
  await app.setValue('[name="player"]', "Dev");
  await app.waitFor(`document.querySelector('[data-testid="run-client-error"]')?.textContent.includes("already running")`);
  assert(await app.eval(`document.querySelector('[data-testid="run-client"] button[type="submit"]').disabled`), "Run is off for a running player's name");
  await app.setValue('[name="player"]', "a b");
  await app.waitFor(`document.querySelector('[data-testid="run-client-error"]')?.textContent.includes("3 to 16")`);
  await app.setValue('[name="player"]', "Alex");
  await app.waitFor(`!document.querySelector('[data-testid="run-client-error"]')`);
  await app.shot(`${OUT}/run-client-dialog-dark.png`);
  // The theme button is behind the dialog: close it, switch, open it again.
  await app.key("Escape");
  await app.setTheme("light");
  await app.click('[data-testid="top-run-another"]');
  await app.setValue('[name="player"]', "Alex");
  await app.shot(`${OUT}/run-client-dialog-light.png`);
  await app.click('[data-testid="run-client"] button[type="submit"]');
  await app.waitFor(`!document.querySelector('[data-testid="run-client"]')`);
  await app.setTheme("dark");

  // The server runs: Join test server starts the next free player (Dev2) joining it.
  const engineId = (await calls()).find((c) => c[0] === "client:run")![1] as string;
  await app.mainEval(`(globalThis.__sender.send("build:event", { type: "start", engineId: ${JSON.stringify(`${engineId} server`)} }), true)`);
  await menu(app, "Build & run", "Join test server");
  await app.waitFor(`[...document.querySelectorAll(".engines .eng")].some((e) => e.textContent === ${JSON.stringify(`${engineId} client Dev2`)})`);
  const runs = (await calls()).filter((c) => c[0] === "client:run").map((c) => c[2]);
  assert(JSON.stringify(runs) === JSON.stringify([{}, { player: "Alex", join: false }, { player: "Dev2", join: true }]), `client runs: ${JSON.stringify(runs)}`);

  // Build output: one entry per client and the server, each with its own Stop.
  const entries = await app.eval<{ name: string; stop: boolean }[]>(`[...document.querySelectorAll(".engines li")].map((li) => ({
    name: li.querySelector(".eng")?.textContent, stop: !!li.querySelector('[data-testid="run-stop"]') }))`);
  for (const name of ["client", "client Alex", "client Dev2", "server"]) {
    assert(entries.some((e) => e.name === `${engineId} ${name}` && e.stop), `entry ${name} with Stop: ${JSON.stringify(entries)}`);
  }
  await app.click(".engines .eng", `${engineId} client Dev2`);
  await app.shot(`${OUT}/build-output-clients-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/build-output-clients-light.png`);
  await app.setTheme("dark");
  await app.shot(`${OUT}/title-bar-dark.png`);

  // Stop one client: only Alex ends, Dev keeps running (the title bar still offers Stop).
  await app.click(`.engines li:has([data-testid="run-stop"][aria-label$="client Alex"]) [data-testid="run-stop"]`);
  await app.waitFor(`[...document.querySelectorAll(".engines li")].some((li) => li.textContent.includes("client Alex") && li.textContent.includes("Stopped"))`);
  assert((await calls()).some((c) => c[0] === "client:stop" && c[1] === `${engineId} client Alex`), `stop Alex only: ${JSON.stringify(await calls())}`);
  assert(await app.eval(`/Stop client/.test(${btn("top-run")}.title)`), "Dev still runs");
  console.log(`engine ${engine}: run another client, join test server and per-client stop OK`);
}, { project: exampleProject() });
