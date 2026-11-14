/**
 * KUYRUK 190, heavy (Gradle and two games): the real app starts two clients of the selected engine at once, Dev from the
 * Run button and Dev2 from Run another client, each in its own Build output entry and log; Stop on Dev2's entry ends
 * only Dev2, then the title bar Stop ends Dev. Needs npm run build:app; refused while C:/BrainOS/.ingame exists.
 * Screenshot: design/190/app-two-clients-dark.png.
 *   node tools/ui-test/multi-client-run.ts
 */
import { existsSync } from "node:fs";
import { assert, exampleProject, run } from "./cdp.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame)");
const btn = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
type Event = { type: string; engineId: string; line?: string; ok?: boolean; stopped?: boolean };

await run(async (app) => {
  await app.waitFor(`!!${btn("top-run")}`);
  await app.eval(`(window.__events = [], window.mcedge.onBuildEvent((e) => window.__events.push(e)), true)`);
  const events = () => app.eval<Event[]>(`window.__events`);
  const user = async (key: string, name: string) => (await events()).some((e) => e.engineId === key && e.line?.includes(`Setting user: ${name}`));
  const waitUser = async (key: string, name: string) => {
    for (let i = 0; i < 900 && !(await user(key, name)); i++) {
      const failed = (await events()).find((e) => e.engineId === key && e.type === "done");
      if (failed) throw new Error(`${key} ended before the game started: ${JSON.stringify(failed)}`);
      await app.sleep(1000);
    }
    assert(await user(key, name), `${key} plays as ${name}`);
  };

  await app.click('[data-testid="top-run"]');
  await app.waitFor(`/Stop client/.test(${btn("top-run")}.title)`);
  const engineId = (await events()).find((e) => e.type === "start")!.engineId.replace(/ client$/, "");
  await app.click('[data-testid="top-run-another"]');
  await app.waitFor(`document.querySelector('[name="player"]')?.value === "Dev2"`);
  await app.click('[data-testid="run-client"] button[type="submit"]');
  await waitUser(`${engineId} client`, "Dev");
  await waitUser(`${engineId} client Dev2`, "Dev2");
  await app.sleep(10_000);
  await app.click(".engines .eng", `${engineId} client Dev2`);
  await app.shot("design/190/app-two-clients-dark.png");

  await app.click(`.engines li:has([aria-label$="client Dev2"]) [data-testid="run-stop"]`);
  for (let i = 0; i < 60 && !(await events()).some((e) => e.engineId === `${engineId} client Dev2` && e.type === "done"); i++) await app.sleep(1000);
  const dev2 = (await events()).find((e) => e.engineId === `${engineId} client Dev2` && e.type === "done");
  assert(dev2?.stopped && !(await events()).some((e) => e.engineId === `${engineId} client` && e.type === "done"), `Dev2 stopped, Dev still runs: ${JSON.stringify(dev2)}`);
  await app.click('[data-testid="top-run"]');
  for (let i = 0; i < 60 && !(await events()).some((e) => e.engineId === `${engineId} client` && e.type === "done"); i++) await app.sleep(1000);
  const dev = (await events()).find((e) => e.engineId === `${engineId} client` && e.type === "done");
  assert(dev?.stopped, `Dev stopped: ${JSON.stringify(dev)}`);
  console.log(`${engineId}: Dev and Dev2 ran at once, each stopped on its own`);
}, { project: exampleProject() });
