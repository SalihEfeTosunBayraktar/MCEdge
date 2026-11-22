/**
 * Q209/Q259: a single click on the empty part of the status bar shows the bottom panel (the last viewed tab, Problems the
 * first time) and a second one hides it; a double click there toggles once, not twice. Double clicks on status bar items keep their own behaviour and never toggle.
 * Hovering the empty part lifts an arrow and lights the strip, and shows the tooltip. English and Turkish, dark and
 * light; screenshots go to design/259/.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert, exampleProject, launchApp, REPO, evidence } from "./cdp.ts";

const OUT = evidence("design/259");
mkdirSync(join(REPO, OUT), { recursive: true });
const project = exampleProject();
const EMPTY = ".status .sgrow.toggle";

for (const language of ["en", "tr"] as const) {
  const s = language === "en" ? en : tr;
  const app = await launchApp({ project, language });
  try {
    await app.waitFor(`document.querySelector("${EMPTY}")`, 15000);
    const panel = () => app.eval<boolean>(`!!document.querySelector(".bottom-panel")`);
    const tab = () => app.eval<string>(`document.querySelector(".ptab.on")?.textContent ?? ""`);
    const arrow = () => app.eval<string>(`getComputedStyle(document.querySelector("${EMPTY} .ico")).opacity`);
    const dbl = (selector: string, text?: string) => app.click(selector, text, { double: true });
    const one = (selector: string) => app.click(selector);
    const hover = async () => {
      const [x, y] = await app.center(EMPTY);
      await app.mouse("mouseMoved", x, y);
      await app.waitFor(`getComputedStyle(document.querySelector("${EMPTY} .ico")).opacity === "1"`, 3000);
    };

    assert(!(await panel()), `${language}: the bottom panel starts closed`);
    assert(await app.eval<string>(`document.querySelector("${EMPTY}").title`) === s["status.togglePanel"], `${language}: the empty strip has the tooltip`);

    // Hover: the arrow fades in and the strip is lit.
    assert(await arrow() === "0", `${language}: no arrow before hover`);
    const unlit = await app.eval<string>(`getComputedStyle(document.querySelector("${EMPTY}")).backgroundColor`);
    await hover();
    assert(await app.eval<string>(`getComputedStyle(document.querySelector("${EMPTY}")).backgroundColor`) !== unlit, `${language}: the strip is lit on hover`);
    await app.shot(`${OUT}/status-hover-${language}-dark.png`);

    await one(EMPTY);
    await app.waitFor(`document.querySelector(".bottom-panel")`);
    assert(await tab() === s["panel.problems"], `${language}: first click opens Problems (got ${await tab()})`);
    await app.shot(`${OUT}/status-open-${language}-dark.png`);

    await one(EMPTY);
    await app.waitFor(`!document.querySelector(".bottom-panel")`);

    // A double click on an item opens its panel and does not toggle it away; a plain item does nothing.
    await dbl(".status button.sitem.gradle");
    await app.sleep(300);
    assert(await panel(), `${language}: double click on the Gradle item leaves its panel open`);
    const itemTab = await tab();
    assert(itemTab === s["panel.build"], `${language}: the Gradle item opened the Build tab (${itemTab})`);
    await dbl(".status button.sitem.gradle");
    await app.sleep(300);
    assert(await panel(), `${language}: a second double click on the item does not close the panel`);
    await one(EMPTY);
    await app.waitFor(`!document.querySelector(".bottom-panel")`);
    await dbl(".status .smsg");
    await app.sleep(300);
    assert(!(await panel()), `${language}: double click on the save message does not open the panel`);

    // A double click on the strip toggles once: the panel opens and stays open.
    await dbl(EMPTY);
    await app.waitFor(`document.querySelector(".bottom-panel")`);
    await app.sleep(300);
    assert(await panel(), `${language}: a double click on the strip toggles once (panel stays open)`);
    await one(EMPTY);
    await app.waitFor(`!document.querySelector(".bottom-panel")`);

    // The last viewed tab comes back.
    await one(EMPTY);
    await app.waitFor(`document.querySelector(".bottom-panel")`);
    assert(await tab() === s["panel.build"], `${language}: the last viewed tab comes back (${await tab()})`);
    await one(EMPTY);
    await app.waitFor(`!document.querySelector(".bottom-panel")`);

    if (language === "en") {
      await app.setTheme("light");
      await hover();
      await app.shot(`${OUT}/status-hover-en-light.png`);
      await one(EMPTY);
      await app.waitFor(`document.querySelector(".bottom-panel")`);
      await app.shot(`${OUT}/status-open-en-light.png`);
    }
    console.log(`PASS ${language}`);
  } catch (error) {
    console.error("FAIL", language, error);
    await app.shot("tools/ui-test/last-failure.png").catch(() => {});
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
