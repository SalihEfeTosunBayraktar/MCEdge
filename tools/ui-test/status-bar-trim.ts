/**
 * Q260: the status bar keeps only what the header does not show. With no problems the problems item is its icon alone
 * (named by tooltip and aria-label), with problems it shows the count; the engine name and the element count are gone.
 * English and Turkish, dark and light; screenshots in design/260/.
 *   node tools/ui-test/status-bar-trim.ts
 */
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert, exampleProject, launchApp, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/260");
const bar = `(() => { const s = document.querySelector(".status"); const p = s.querySelector("button.sitem:not(.gradle):not(.agent)");
  return { text: s.textContent, problems: p.textContent.trim(), label: p.getAttribute("aria-label"), title: p.title, icon: !!p.querySelector("svg.ico"), engine: document.querySelector(".engname")?.textContent ?? "" }; })()`;
type Bar = { text: string; problems: string; label: string | null; title: string; icon: boolean; engine: string };

let failed = false;
for (const language of ["en", "tr"] as const) {
  const s = (language === "en" ? en : tr) as Record<string, string>;
  for (const theme of ["dark", "light"] as const) {
    for (const broken of [false, true]) {
      const project = exampleProject();
      // A recipe whose result does not exist is a problem the editor lists.
      if (broken) addElement(project, "recipe", "broken_recipe", { name: "Broken", result: "nosuchmod:nothing" });
      const app = await launchApp({ project, language, theme });
      const tag = `${language}-${theme}-${broken ? "problems" : "clean"}`;
      try {
        await app.waitFor(`!!document.querySelector(".status .sitem.gradle")`, 15000);
        const b = await app.eval<Bar>(bar);
        assert(b.engine && !b.text.includes(b.engine), `${tag}: the engine name (${b.engine}) is not in the status bar: ${b.text}`);
        assert(!/\d+ (elements|öğe)/.test(b.text), `${tag}: no element count: ${b.text}`);
        assert(b.icon, `${tag}: the problems item has its icon`);
        if (broken) {
          assert(b.problems.length > 0 && b.label === null, `${tag}: with problems the count shows: ${JSON.stringify(b)}`);
        } else {
          assert(b.problems === "" && b.label === s["status.noProblems"] && b.title === s["status.noProblems"], `${tag}: icon only, named: ${JSON.stringify(b)}`);
        }
        await app.click(".status button.sitem", broken ? b.problems : undefined);
        await app.waitFor(`document.querySelector(".ptab.on")?.textContent === ${JSON.stringify(s["panel.problems"])}`);
        await app.click(".status .sgrow.toggle");
        await app.waitFor(`!document.querySelector(".bottom-panel")`);
        await app.shot(`${OUT}/status-${tag}.png`);
        console.log(`PASS ${tag}`);
      } catch (e) {
        failed = true;
        console.error(`FAIL ${tag}: ${(e as Error).message}`);
      } finally {
        await app.close();
      }
    }
  }
}
if (failed) process.exit(1);
console.log("PASS status-bar-trim");
