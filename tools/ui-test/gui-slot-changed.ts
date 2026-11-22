/**
 * Q203: a GUI's Screen tab has "When a slot changes" (onSlotChanged) beside the other screen events, as a procedure
 * picker; picking a procedure saves it to the element. Dark and light screenshots go to design/203/.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, REPO, run, openSection, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/203");
mkdirSync(join(REPO, OUT), { recursive: true });
const project = exampleProject();
addElement(project, "gui", "trade", { title: "Trade", type: 1, components: [{ kind: "slot", x: 25, y: 30, id: 0 }, { kind: "slot", x: 61, y: 30, id: 1 }] });
addElement(project, "procedure", "offer_changed", { title: "Offer changed" });

const saved = () => JSON.parse(readFileSync(join(project, "elements/guis/trade.json"), "utf8")).onSlotChanged as string;
const row = `[...document.querySelectorAll(".frow")].find((r) => r.textContent.includes("When a slot changes"))`;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "trade", { double: true });
  await app.waitFor(`document.querySelector(".guistage")`);
  await openSection(app, "Screen");
  await app.waitFor(`!!${row}`);
  assert(await app.eval<boolean>(`!!${row}.querySelector(".procpicker") && !!${row}.querySelector(".procnew")`), "onSlotChanged is a procedure picker with New");
  const order = await app.eval<string[]>(`[...document.querySelectorAll(".frow")].map((r) => r.querySelector("label, .flabel")?.textContent?.trim() ?? "").filter((l) => /^When|^While/.test(l))`);
  console.log("screen events:", order);
  assert(order.indexOf("When a slot changes") === order.indexOf("When closed") + 1, `listed after When closed: ${order}`);

  await app.eval(`${row}.querySelector(".procpicked").id = "pp"`);
  await app.click("#pp");
  await app.waitFor(`document.querySelector(".proclist")`);
  await app.type("offer");
  await app.sleep(200);
  await app.key("Enter");
  await app.waitFor(`!document.querySelector(".proclistpop")`);
  await app.sleep(700);
  assert(saved() === "offer_changed", `picked procedure saved: ${saved()}`);
  assert(await app.eval<string>(`${row}.querySelector(".procpicked").title`) === "offer_changed", "the field shows the choice");

  await app.eval(`${row}.scrollIntoView({ block: "center" })`);
  await app.shot(`${OUT}/slot-changed-dark.png`);
  await app.setTheme("light");
  await app.sleep(300);
  await app.shot(`${OUT}/slot-changed-light.png`);
  console.log("gui slot changed: all checks passed");
}, { project });
