/**
 * KUYRUK #101: optional mod integrations. Workspace settings list the recipe viewer integration (off); turning it on as an
 * optional dependency saves mod.integrations, and a block then shows the Integrations page with the recipe viewer
 * fields (hidden while it is off). Generation is checked by tools/codegen-test/integrations-check.ts, MCP by
 * tools/mcp-test/surface.ts. Screenshots go to design/integrations/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const project = exampleProject();
const OUT = "design/integrations";
const mod = () => JSON.parse(readFileSync(join(project, "mcedge.json"), "utf8")).mod as { integrations?: { id: string; required: boolean }[] };
const pageTabs = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".pagetabs .ltab")].map((b) => b.textContent)`);

await run(async (app) => {
  // A block has no Integrations page while nothing is on.
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "ruby_block", { double: true });
  await app.waitFor(`document.querySelector(".pagetabs")`);
  assert(!(await pageTabs(app)).some((p) => p.includes("Integrations")), `no Integrations page while off: ${await pageTabs(app)}`);
  await app.click(".abtn", "Back to elements");

  await app.click(".rtab", "Workspace settings");
  // Since KUYRUK 121 integrations have their own tab: select the row, its panel holds the setting.
  await app.click(".view [role=tab]", "Integrations");
  await app.click(".view .grid tbody tr", "Recipe viewer");
  await app.waitFor(`document.querySelector("select[aria-label='Recipe viewer (JEI / REI)']")`);
  await app.setValue("select[aria-label='Recipe viewer (JEI / REI)']", "optional");
  await app.sleep(800);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
  assert(JSON.stringify(mod().integrations) === JSON.stringify([{ id: "recipe_viewer", required: false }]), `saved: ${JSON.stringify(mod().integrations)}`);
  await app.shot(`${OUT}/settings-dark.png`);

  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "ruby_block", { double: true });
  await app.waitFor(`[...document.querySelectorAll(".pagetabs .ltab")].some((b) => b.textContent.includes("Integrations"))`);
  await app.click(".pagetabs .ltab", "Integrations");
  await app.waitFor(`[...document.querySelectorAll(".efrow > label")].some((l) => l.textContent.includes("Recipe category"))`);
  await app.click(".efrow .check input");
  await app.waitFor(`[...document.querySelectorAll(".efrow > label")].some((l) => l.textContent.includes("Recipes"))`);
  await app.shot(`${OUT}/block-fields-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/block-fields-light.png`);
}, { project });
