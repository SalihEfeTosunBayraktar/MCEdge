/**
 * KUYRUK #149: field checks of element editors follow the UI language. The checks keep their English message for
 * MCP and the CLI (compared word for word with the texts they had before), and carry a code the app shows from
 * config/ui-strings; in Turkish the editor rows, its Problems group and the Problems panel are Turkish.
 * Screenshots go to design/149/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { typeRegistry } from "../../src/elements/registry.ts";
import { elementIdLookup, validateElement } from "../../src/elements/model.ts";
import { assert, exampleProject, run } from "./cdp.ts";

// 1. English messages are unchanged (MCP and CLI read them).
const item = typeRegistry().byId.get("item")!;
const ctx = { elementIds: elementIdLookup({ item: [{ id: "ruby" }] }), fileExists: () => false };
const messages = validateElement(item, { id: "x", name: "", stackSize: 500, rarity: "SHINY", texture: "textures/none.png", repairItems: ["nope"], guiBoundTo: 7 }, ctx).map((i) => `${i.path}: ${i.message}`);
for (const expected of ["name: required", "stackSize: must be at most 99", "rarity: unknown option \"SHINY\"", "texture: file not found: textures/none.png", "guiBoundTo: must be an element id", "model: missing value"]) {
  assert(messages.includes(expected), `English message kept: ${expected} (got ${messages.join(" | ")})`);
}

// 2. The Turkish UI shows them in Turkish.
const project = exampleProject();
const rubyFile = join(project, "elements", "items", "ruby.json");
writeFileSync(rubyFile, JSON.stringify({ ...JSON.parse(readFileSync(rubyFile, "utf8")), stackSize: 500, name: "" }, null, 2) + "\n");
await run(async (app) => {
  await app.eval(`[...document.querySelectorAll(".tile")].find((t) => t.querySelector("code")?.textContent === "ruby").id = "rubytile"`);
  await app.click("#rubytile", undefined, { double: true });
  await app.waitFor(`document.querySelector(".edhead")`);
  await app.eval(`[...document.querySelectorAll(".ltab")].find((t) => t.querySelector(".pcount") && t.textContent.includes("Özellik"))?.click()`);
  await app.waitFor(`document.querySelector('.frow[data-field="stackSize"] .ferr')`);
  const stack = await app.eval<string>(`document.querySelector('.frow[data-field="stackSize"] .ferr').textContent`);
  assert(stack === "en çok 99 olmalı", `the field row is Turkish: ${stack}`);
  const name = await app.eval<string>(`document.querySelector('.frow[data-field="name"] .ferr')?.textContent`);
  assert(name === "zorunlu", `required is Turkish: ${name}`);
  const group = await app.eval<string>(`document.querySelector(".issues").textContent`);
  assert(group.includes("en çok 99 olmalı") && !/must be|required/.test(group), `the Problems group is Turkish: ${group}`);
  await app.shot("design/149/149-editor-tr-dark.png");
  await app.click(".sitem", "sorun");
  await app.waitFor(`document.querySelector(".problems li")`);
  const panel = await app.eval<string>(`document.querySelector(".problems").textContent`);
  assert(panel.includes("en çok 99 olmalı") && !/must be at most/.test(panel), `the Problems panel is Turkish: ${panel}`);
  await app.setTheme("light");
  await app.shot("design/149/149-problems-tr-light.png");
}, { project, language: "tr" });
