/**
 * Q241: the Scenarios panel. Creates a scenario from the template, runs it on fabric-1.21.5 against a real dedicated
 * server (heavy: Gradle + a server), sees the passes, breaks an expectation and sees the fail, and checks that a server
 * that is already running is not stopped. Screenshots (en/tr, dark/light) go to design/241/.
 *   node tools/ui-test/scenarios-view.ts
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App } from "./cdp.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting a server");
const OUT = "design/241";
const ENGINE = "fabric-1.21.5";
const project = exampleProject();
const text = (app: App, selector: string) => app.eval<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);

async function openPanel(app: App) {
  await app.click(".sitem.gradle");
  await app.click("[data-testid=tab-scenarios]");
  await app.waitFor(`document.querySelector("[data-testid=scenarios]")`);
  await app.setValue("[data-testid=scn-engine]", ENGINE);
}
async function runIt(app: App) {
  await app.click("[data-testid=scn-run]");
  await app.waitFor(`document.querySelector("[data-testid=scn-running]")`, 20_000);
  await app.waitFor(`document.querySelector("[data-testid=scn-summary], [data-testid=scn-error]")`, 20 * 60_000);
}

for (const language of ["en", "tr"] as const) {
  const app = await launchApp({ project, language, theme: "dark" });
  try {
    await openPanel(app);
    if (language === "en") {
      assert((await text(app, "[data-testid=scenarios]")).includes("No scenarios yet"), "an empty project lists no scenarios");
      await app.click("[data-testid=scn-new]");
      await app.waitFor(`document.querySelector("[data-testid=scn-file-scenario]")`);
      assert(existsSync(join(project, "scenarios", "scenario.json")), "the template is saved as scenarios/scenario.json");
      assert((await app.eval<string>(`document.querySelector("[data-testid=scn-editor]").value`)).includes("useBlock"), "the template is in the editor");
    } else {
      await app.click("[data-testid=scn-file-scenario]");
    }
    await app.waitFor(`document.querySelector("[data-testid=scn-editor]")`);
    await runIt(app);
    const summary = await text(app, "[data-testid=scn-summary]");
    const steps = await app.eval<string[]>(`[...document.querySelectorAll("[data-testid=scn-step]")].map((s) => s.dataset.state)`);
    console.log(language, summary, await text(app, ".scn-steps"), JSON.stringify(steps), await text(app, "[data-testid=scn-error]"));
    // The Turkish launch opens the file the English one broke, so it shows the failure.
    const fails = language === "en" ? 0 : 1;
    assert(steps.length === 6 && steps.filter((s) => s === "fail").length === fails && steps.filter((s) => s === "pass").length === 3 - fails, `${language}: the checks show their state: ${steps}`);
    assert(await app.eval<boolean>(`!!document.querySelector("[data-testid=scn-log]")`), `${language}: the run offers its server log`);
    await app.shot(`${OUT}/scenarios-${language === "en" ? "pass" : "fail"}-${language}-dark.png`);
    await app.setTheme("light");
    await app.shot(`${OUT}/scenarios-${language === "en" ? "pass" : "fail"}-${language}-light.png`);
    await app.setTheme("dark");

    if (language === "en") {
      // Break the inventory expectation: the player holds 3 apples, the scenario now wants 4.
      const body = await app.eval<string>(`document.querySelector("[data-testid=scn-editor]").value`);
      await app.setValue("[data-testid=scn-editor]", body.replace(/("what": "count",[\s\S]*?"expect": )3/, "$14"));
      await app.waitFor(`!document.querySelector("[data-testid=scn-save]").disabled`);
      await runIt(app);
      const broken = await app.eval<string[]>(`[...document.querySelectorAll("[data-testid=scn-step]")].map((s) => s.dataset.state)`);
      assert(broken.filter((s) => s === "fail").length === 1 && broken.at(-1) === "fail", `a broken expectation fails its step: ${broken}`);
      assert((await text(app, "[data-testid=scn-summary]")).includes("1 failed"), "the summary counts the failure");
      await app.shot(`${OUT}/scenarios-fail-en-dark.png`);
      await app.setTheme("light");
      await app.shot(`${OUT}/scenarios-fail-en-light.png`);
      await app.setTheme("dark");

      // A server of this engine that runs is not stopped for a scenario run; Reload data reaches it.
      const started = Date.now();
      await app.click(".menu", "Build & run");
      await app.click(".menulist button", "Run server");
      const logFile = join(project, "out", ENGINE, "build", "mcedge-server.log");
      for (let up = false, end = Date.now() + 20 * 60_000; !up; await app.sleep(2000)) {
        up = statSync(logFile).mtimeMs > started && /Done \(\d/.test(readFileSync(logFile, "utf8"));
        if (Date.now() > end) throw new Error("the server did not come up");
      }
      await app.click(".ptab", "Scenarios");
      await app.click("[data-testid=scn-file-scenario]");
      await app.waitFor(`!document.querySelector("[data-testid=scn-reload]").disabled`, 60_000);
      await app.click("[data-testid=scn-run]");
      await app.waitFor(`document.querySelector("[data-testid=scn-error]")`, 30_000);
      assert((await text(app, "[data-testid=scn-error]")).includes("already running"), "a running server is reported, not replaced");
      await app.click("[data-testid=scn-reload]");
      await app.waitFor(`document.querySelector("[data-testid=scn-note]")`, 120_000);
      const note = await text(app, "[data-testid=scn-note]");
      console.log("reload:", note);
      assert(/^Reloaded/.test(note), `Reload data reloads the running server: ${note}`);
      await app.shot(`${OUT}/scenarios-reload-en-dark.png`);
      await app.click(".menu", "Build & run");
      await app.click(".menulist button", "Stop server");
      await app.waitFor(`!document.querySelector(".led.running")`, 60_000);
    }
  } finally {
    await app.close();
  }
}
console.log("PASS scenarios-view");
