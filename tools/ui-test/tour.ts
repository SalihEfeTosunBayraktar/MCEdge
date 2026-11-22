/**
 * Q245: the first-mod tour, with real clicks and keys (the window stays hidden).
 * 1. A user who answers "new" in the setup is offered the tour on the start screen; No thanks saves it as skipped and
 *    Help > Guided tour starts it again.
 * 2. Start opens New project; the tour panel then lists create a block, paint its texture, test it. Each step ticks
 *    only when the project is in that state: the block exists, its texture is set and not the one it started with, and
 *    its scenario passed. The panel does not block the UI, outlines what the step points at, works in Simple mode.
 * 3. Close pauses it, Help > Guided tour brings it back with the same progress; Skip saves skipped.
 * 4. The test step (en dark only, it starts Gradle and a headless dedicated server) runs the real scenario and ticks.
 *   node tools/ui-test/tour.ts          the whole thing; TOUR_NO_SERVER=1 skips the real scenario run
 * Screenshots in design/245/ (en/tr, dark/light).
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, launchApp, REPO, type App, evidence } from "./cdp.ts";

const OUT = evidence("design/245");
const ENGINE = "fabric-1.21.5";
const SERVER = !process.env.TOUR_NO_SERVER;
if (SERVER && existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting a server");
type Prefs = { level?: string; mode?: string; tour?: { status: string; subject?: string; tested?: string } };
const saved = (userData: string) => (JSON.parse(readFileSync(join(userData, "app-state.json"), "utf8")) as { preferences: Prefs }).preferences;
const exists = (app: App, selector: string) => app.eval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
const stateOf = (app: App, step: string) => app.eval<string>(`document.querySelector('[data-testid=tour] li[data-step=${step}]')?.dataset.state ?? ""`);
const waitState = (app: App, step: string, state: string) => app.waitFor(`document.querySelector('[data-testid=tour] li[data-step=${step}]')?.dataset.state === "${state}"`, 20_000);
const helpTour = async (app: App, s: Record<string, string>) => {
  await app.click(".menubar .menu", s["menu.help"]);
  await app.click(".menulist button", s["menu.tour"]);
};

async function createProject(app: App, s: Record<string, string>, parent: string) {
  await app.waitFor(`document.querySelector('[data-testid="new-project"]')`);
  await app.setValue('[data-testid="new-project"] input[name="name"]', "Tour Mod");
  await app.setValue('[data-testid="new-project"] input[name="parent"]', parent);
  // One engine, the one whose toolchain the scenario test uses.
  const engines = await app.eval<string[]>(`[...document.querySelectorAll('[data-testid="new-project"] input[name="engine"]')].filter((i) => i.checked).map((i) => i.value)`);
  for (const id of engines.filter((e) => e !== ENGINE)) await app.eval(`document.querySelector('[data-testid="new-project"] input[name="engine"][value="${id}"]').click()`);
  if (!engines.includes(ENGINE)) await app.eval(`document.querySelector('[data-testid="new-project"] input[name="engine"][value="${ENGINE}"]').click()`);
  await app.click('[data-testid="new-project"] .dlg-buttons button', s["newProject.create"]);
  await app.waitFor(`document.querySelector(".rail")`, 60_000);
}

for (const [lang, theme, full] of [["en", "dark", true], ["tr", "light", false], ["en", "light", false], ["tr", "dark", false]] as const) {
  const s = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  const parent = mkdtempSync(join(tmpdir(), "mcedge-tour-"));
  const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
  let app = await launchApp({ theme, language: lang, level: null, userData });
  try {
    // 1. The offer, and No thanks.
    await app.waitFor(`document.querySelector("[data-testid=setup]")`);
    await app.click(".setup-level", s["setup.level.new"]);
    await app.click(".dialog button[type=submit]");
    await app.waitFor(`document.querySelector("[data-testid=tour-offer]")`);
    assert(saved(userData).level === "new" && saved(userData).mode === "simple", "the setup answer new turned on Simple mode");
    assert(!(await exists(app, "[data-testid=tour]")), "no panel before the tour is started");
    await app.shot(`${OUT}/offer-${lang}-${theme}.png`);
    await app.click("[data-testid=tour-decline]");
    await app.waitFor(`!document.querySelector("[data-testid=tour-offer]")`);
    assert(saved(userData).tour?.status === "skipped", `declined: ${JSON.stringify(saved(userData).tour)}`);
    await helpTour(app, s);
    await app.waitFor(`document.querySelector('[data-testid="new-project"]')`);
    assert(saved(userData).tour?.status === "active", "Help > Guided tour starts a skipped tour again");

    // 2. The tour on a new project, in Simple mode.
    await createProject(app, s, parent);
    await app.waitFor(`document.querySelector("[data-testid=tour]")`);
    assert(await app.eval<boolean>(`document.documentElement.dataset.mode === "simple"`), "Simple mode is on");
    await waitState(app, "block", "current");
    assert((await stateOf(app, "texture")) === "todo" && (await stateOf(app, "test")) === "todo", "later steps wait");
    await app.waitFor(`document.querySelector(".tour-point")`);
    await app.shot(`${OUT}/step1-${lang}-${theme}.png`);

    // The panel does not block: the New popup opens under it and the step points into the popup.
    await app.key("n", 2);
    await app.waitFor(`document.querySelector(".addpop")`);
    await app.waitFor(`document.querySelector(".addpop.tour-point, .addpop .tour-point")`);
    await app.setValue(".addpop .popsearch input", lang === "en" ? "block" : "blok");
    await app.click(".addpop .ptype[data-type=block]");
    await app.waitFor(`document.querySelector(".popform input")`);
    await app.type("Tour Ruby");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".pagetabs")`, 20_000);
    await waitState(app, "block", "done");
    await waitState(app, "texture", "current");
    assert(saved(userData).tour?.subject === "tour_ruby", `the block is the tour's subject: ${JSON.stringify(saved(userData).tour)}`);
    // The texture field is on the first page: the step outlines it.
    await app.waitFor(`document.querySelector("[data-field=texture].tour-point")`);
    await app.shot(`${OUT}/step2-${lang}-${theme}.png`);

    // Close pauses; Help > Guided tour continues with the same progress.
    await app.click("[data-testid=tour-close]");
    await app.waitFor(`!document.querySelector("[data-testid=tour]")`);
    assert(saved(userData).tour?.status === "paused", "closing pauses the tour");
    await helpTour(app, s);
    await app.waitFor(`document.querySelector("[data-testid=tour]")`);
    await waitState(app, "block", "done");
    await waitState(app, "texture", "current");
    assert((await app.eval<string>(`document.querySelector("[data-testid=tour-progress]").textContent`)).startsWith("1"), "the progress was kept");

    // Paint a new texture in Resources; the step ticks only when the block uses it.
    await app.click(".rail [data-section=resources]");
    await app.waitFor(`document.querySelector(".content .abtn.primary")`);
    await app.click(".abtn", s["resources.create"]);
    await app.waitFor(`document.querySelector(".dialog input")`);
    await app.click(".dialog input");
    await app.type("tour_ruby");
    await app.setValue(".dialog select", "block");
    await app.click(".dialog .abtn.primary");
    await app.waitFor(`document.querySelector(".paintcanvas")`);
    const r = await app.rect(".paintcanvas");
    await app.mouse("mousePressed", r.x + r.width * 0.3, r.y + r.height * 0.3);
    await app.mouse("mouseReleased", r.x + r.width * 0.3, r.y + r.height * 0.3);
    await app.key("s", 2);
    await app.waitFor(`!document.querySelector(".edname .unsaved")`, 10_000);
    assert((await stateOf(app, "texture")) === "current", "a painted texture the block does not use does not tick the step");
    await app.click(".rail [data-section=elements]");
    await app.click(".tiles .tile", "Tour Ruby", { double: true });
    await app.waitFor(`document.querySelector(".pagetabs")`);
    await app.click(".texpicked");
    await app.waitFor(`document.querySelector(".texpop .texcell")`);
    await app.click(`.texpop .texcell[title$="tour_ruby.png"]`);
    await waitState(app, "texture", "done");
    await waitState(app, "test", "current");
    assert(await exists(app, "[data-testid=tour-test]"), "the test step offers its button, though the Scenarios tab is hidden");
    await app.shot(`${OUT}/step3-${lang}-${theme}.png`);

    if (full && SERVER) {
      // 4. The real run: scenarios/tour-tour_ruby.json on a headless dedicated server.
      await app.click("[data-testid=tour-test]");
      await app.waitFor(`document.querySelector("[data-testid=tour-running]")`, 20_000);
      await app.shot(`${OUT}/testing-${lang}-${theme}.png`);
      await app.waitFor(`document.querySelector("[data-testid=tour-finished], [data-testid=tour-problem]")`, 25 * 60_000);
      const problem = await app.eval<string>(`document.querySelector("[data-testid=tour-problem]")?.textContent ?? ""`);
      assert(!problem, `the scenario passed: ${problem}`);
      assert(existsSync(join(parent, "tour_mod", "scenarios", "tour-tour_ruby.json")), "the scenario is a file of the project");
      assert(saved(userData).tour?.tested === "tour_ruby", "the passed test is saved");
      await app.shot(`${OUT}/finished-${lang}-${theme}.png`);
      await app.click("[data-testid=tour-finish]");
      await app.waitFor(`!document.querySelector("[data-testid=tour]")`);
      assert(saved(userData).tour?.status === "done", "Finish saves done");
    } else {
      // 3. Skip.
      await app.click("[data-testid=tour-skip]");
      await app.waitFor(`!document.querySelector("[data-testid=tour]")`);
      assert(saved(userData).tour?.status === "skipped", "Skip saves skipped");
    }
    await app.close();

    // A restart keeps a finished or skipped tour away.
    app = await launchApp({ theme, language: lang, userData, project: join(parent, "tour_mod") });
    await app.sleep(800);
    assert(!(await exists(app, "[data-testid=tour]")), "no panel after the tour ended");
  } catch (error) {
    await app.shot("tools/ui-test/last-failure.png").catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
  console.log(`PASS tour ${lang} ${theme}${full && SERVER ? " (with the real scenario run)" : ""}`);
}
