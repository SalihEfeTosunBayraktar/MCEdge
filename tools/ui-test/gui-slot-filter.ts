/**
 * Q257: a GUI slot has an "Allowed items" list (items and #tags) beside "Only this item". In the widget panel, with a
 * slot selected, Add makes a row, its picker takes an item id and a #tag, and both are saved to the slot as
 * `allowed: [{ item }]`. Args: theme, language. Screenshots in design/257/.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const theme = (process.argv[2] ?? "dark") as "dark" | "light";
const lang = process.argv[3] ?? "en";
const S = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
mkdirSync(join(REPO, evidence("design/257")), { recursive: true });
const project = exampleProject();
addElement(project, "gui", "teleporter", { type: 1, width: 176, height: 166, components: [
  { kind: "slot", x: 25, y: 30, id: 0, lockCondition: "" }, { kind: "slot", x: 61, y: 30, id: 1 }, { kind: "slot", x: 97, y: 30, id: 2 },
] });
type W = { kind: string; id?: number; allowed?: { item: string }[] };
const saved = () => (JSON.parse(readFileSync(join(project, "elements", "guis", "teleporter.json"), "utf8")) as { components: W[] }).components;
const waitSaved = async (app: App) => {
  await app.sleep(600);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const row = `[...document.querySelectorAll(".guiform .frow")].find((r) => r.textContent.includes(${JSON.stringify(S["gui.field.allowed"])}))`;

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "teleporter", { double: true });
  await app.waitFor(`document.querySelectorAll(".guistage .gwidget.k-slot").length === 3`);
  await app.click(".guilist .lrow", "1");
  await app.waitFor(`!!${row}`);
  const labels = await app.eval<string[]>(`[...document.querySelectorAll(".guiform .frow")].map((r) => r.querySelector("label, .flabel")?.textContent?.trim())`);
  assert(labels.includes(S["gui.field.limit"]) && labels.includes(S["gui.field.allowed"]), `slot fields: ${labels}`);

  // Add a row and give it an item id, then another with a tag.
  for (const value of ["etreco:ticket", "#forge:battery"]) {
    await app.eval(`${row}.querySelector("button[aria-label='${S["list.add"]}'], .minibar button").click()`);
    await app.sleep(300);
    await app.eval(`(${row}).querySelector(".listform .regpicked").click()`);
    await app.waitFor(`document.querySelector(".regpop .regsearch input")`);
    await app.type(value);
    await app.sleep(200);
    await app.key("Enter");
    await app.sleep(300);
  }
  await waitSaved(app);
  const slot = saved().find((w) => w.id === 0)!;
  assert(JSON.stringify(slot.allowed) === JSON.stringify([{ item: "etreco:ticket" }, { item: "#forge:battery" }]), `rows saved: ${JSON.stringify(slot.allowed)}`);
  assert(!saved().find((w) => w.id === 1)?.allowed, "the other slots have no filter");
  await app.eval(`${row}.scrollIntoView({ block: "center" })`);
  await app.shot(evidence(`design/257/slot-filter-${theme}-${lang}.png`));
  console.log(`gui slot filter (${theme}, ${lang}): all checks passed`);
}, { project, language: lang, theme });
