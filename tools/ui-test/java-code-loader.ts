/**
 * Q282: the java_code block has a loader dropdown next to its Minecraft version. A block saved without the field shows
 * "any loader"; choosing NeoForge with a real click is saved as fields.loader. en and tr, dark and light.
 * Screenshots go to design/282/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/282");
const WS = `document.querySelector(".blocklyhost").blocklyWorkspace`;
const program = { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, { block: "java_code", fields: { code: "// legacy block without a loader", deps: "", imports: "", gen: "26.3" } }] }] };

for (const [language, theme, any, neo] of [["en", "dark", "any loader", "NeoForge"], ["tr", "light", "her yükleyici", "NeoForge"], ["en", "light", "any loader", "NeoForge"], ["tr", "dark", "her yükleyici", "NeoForge"]] as const) {
  const project = exampleProject();
  addElement(project, "procedure", "demo", { title: "demo", returnType: "none", program });
  await run(async (app) => {
    await app.click(".rtab", language === "tr" ? "Mod öğeleri" : "Mod elements");
    await app.waitFor(`[...document.querySelectorAll(".tile")].some((t) => t.textContent.includes("demo"))`, 20000);
    await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.textContent.includes("demo")).setAttribute("id", "target")`);
    await app.click("#target", undefined, { double: true });
    await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`, 60000);
    const field = `(() => { const b = ${WS}.getAllBlocks(false).find((x) => x.type === "java_code"); return b; })()`;
    await app.waitFor(`${field}`, 20000);
    assert(await app.eval<boolean>(`${field}.getField("gen") != null && ${field}.getField("loader") != null`), `${language}/${theme}: gen and loader fields exist`);
    assert(await app.eval<string>(`${field}.getField("loader").getText()`) === any, `${language}/${theme}: a block without the field shows "${any}", got ${await app.eval<string>(`${field}.getField("loader").getText()`)}`);
    await app.eval(`${WS}.centerOnBlock(${field}.id)`);
    await app.sleep(300);
    await app.shot(`${OUT}/block-${language}-${theme}.png`);
    const at = await app.eval<[number, number]>(`(() => { const r = ${field}.getField("loader").getSvgRoot().getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await app.mouse("mouseMoved", at[0], at[1]);
    await app.mouse("mousePressed", at[0], at[1], 1);
    await app.mouse("mouseReleased", at[0], at[1], 0);
    await app.waitFor(`document.querySelector(".blocklyDropDownDiv .blocklyMenuItem")`, 5000);
    const items = await app.eval<string[]>(`[...document.querySelectorAll(".blocklyDropDownDiv .blocklyMenuItem")].map((i) => i.textContent.trim())`);
    assert(items.join("|") === [any, "NeoForge", "Forge", "Fabric"].join("|"), `${language}/${theme}: loader options, got ${items.join("|")}`);
    await app.shot(`${OUT}/menu-${language}-${theme}.png`);
    await app.click(".blocklyDropDownDiv .blocklyMenuItem", neo);
    await app.sleep(300);
    assert(await app.eval<string>(`${field}.getField("loader").getValue()`) === "neoforge", `${language}/${theme}: loader is neoforge`);
    await app.shot(`${OUT}/chosen-${language}-${theme}.png`);
    // The autosave writes the choice into the element file.
    const file = join(project, "elements", "procedures", "demo.json");
    const deadline = Date.now() + 20000;
    let saved = "";
    while (Date.now() < deadline) {
      saved = readFileSync(file, "utf8");
      if (saved.includes('"loader": "neoforge"')) break;
      await app.sleep(500);
    }
    assert(saved.includes('"loader": "neoforge"') && saved.includes('"gen": "26.3"'), `${language}/${theme}: loader saved into the procedure file`);
  }, { project, language, theme });
}
console.log("java-code-loader UI OK");
