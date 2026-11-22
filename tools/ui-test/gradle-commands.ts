/**
 * KUYRUK #7, Gradle-backed menu commands on the selected engine (fabric-1.21.5 by default): Tools > Gradle console
 * (help), Tools > Reload Gradle project, Build & run > Debug client (JDWP on 5005, then Stop) and Run server
 * (until the server is up, then Stop server). Heavy: downloads and starts Minecraft. Do not run while the user
 * is playing. Screenshots go to design/menu-commands/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/menu-commands");
const menu = async (app: App, top: string, item: string) => {
  await app.click(".menu", top);
  await app.click(".menulist button", item);
};
const log = (app: App) => app.eval<string>(`document.querySelector(".bottom-panel pre.log")?.textContent ?? ""`);
const waitLog = async (app: App, pattern: RegExp, minutes: number) => {
  const end = Date.now() + minutes * 60_000;
  while (Date.now() < end) {
    const text = await log(app);
    if (pattern.test(text)) return text;
    if (/BU.{1,2}LD FAILED|FAILURE: /.test(text)) throw new Error(`gradle failed:\n${text.slice(-3000)}`);
    await app.sleep(1000);
  }
  throw new Error(`timeout waiting for ${pattern}:\n${(await log(app)).slice(-3000)}`);
};
/** The state a Build output entry shows (KUYRUK 154): "Running", "Stopped", ... */
const state = (app: App, key: string) => app.eval<string>(`[...document.querySelectorAll(".engines li button")].find((b) => b.querySelector(".eng")?.textContent.endsWith(${JSON.stringify(key)}))?.querySelector(".dim")?.textContent ?? ""`);
const led = (app: App, key: string) => app.eval<string>(`[...document.querySelectorAll(".engines li button")].find((b) => b.textContent.includes(${JSON.stringify(key)}))?.querySelector(".led")?.className ?? ""`);

await run(async (app) => {
  const engine = await app.eval<string>(`document.querySelector(".enginebtn").textContent.trim()`);
  console.log(`engine: ${engine}`);

  // Gradle console: run "help" by hand.
  await menu(app, "Tools", "Gradle console");
  await app.click(".gradle-input input");
  await app.type("help");
  await app.key("Enter");
  await waitLog(app, /BU.{1,2}LD SUCCESSFUL/, 20);
  await app.shot(`${OUT}/gradle-console-run-dark.png`);

  // Reload Gradle project: regenerate + configure.
  await menu(app, "Tools", "Reload Gradle project");
  await app.sleep(1500);
  await waitLog(app, /gradle help[\s\S]*BUILD SUCCESSFUL/, 20);

  // Debug client: the game JVM listens for a debugger; Stop ends it.
  await menu(app, "Build & run", "Debug client");
  await waitLog(app, /Listening for transport dt_socket at address: 5005/, 20);
  assert((await state(app, " client")) === "Running", `a running debug client says Running: ${await state(app, " client")}`);
  await app.shot(`${OUT}/debug-client-dark.png`);
  await menu(app, "Build & run", "Stop client");
  await app.waitFor(`!document.querySelector(".led.running, .led.waiting")`, 60_000);
  assert((await state(app, " client")) === "Stopped", `a stopped debug client says Stopped, not Failed: ${await state(app, " client")}`);

  // Run server until it is up, then stop it from the menu.
  await menu(app, "Build & run", "Run server");
  try {
    await waitLog(app, /Done \(\d/, 20);
  } catch (error) {
    const text = await log(app);
    // The generated mod, not the command, can keep the server from starting (missing dependency mods).
    if (/KnotServer|Starting minecraft server/.test(text) && /Incompatible mods found|requires .* which is missing/.test(text)) {
      await app.shot(`${OUT}/run-server-blocked-dark.png`);
      throw new Error(`BLOCKED: the server launched but the generated mod failed to load:\n${text.split("\n").filter((l) => /requires|Incompatible/.test(l)).join("\n")}`);
    }
    throw error;
  }
  assert((await state(app, " server")) === "Running", `a running server says Running, not Building: ${await state(app, " server")}`);
  await app.shot(`${OUT}/run-server-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/run-server-light.png`);
  await app.setTheme("dark");
  await menu(app, "Build & run", "Stop server");
  await app.waitFor(`!document.querySelector(".led.running, .led.waiting")`, 60_000);
  assert(!(await led(app, "server")).includes("running"), "server stopped");
  assert((await state(app, " server")) === "Stopped", `a stopped server says Stopped: ${await state(app, " server")}`);
  await app.shot(`${OUT}/run-states-stopped-dark.png`);
}, { project: exampleProject(), height: 1000 });
