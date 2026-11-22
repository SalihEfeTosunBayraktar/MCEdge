/**
 * KUYRUK #65 (fix 1): a procedure field has New beside Open, like MCreator's "+": it creates an empty procedure
 * named after the element and the field, sets the field and opens the procedure; Back returns to the element.
 * Open and New are styled buttons on one row (they were unstyled "btn" and wrapped). Screenshots go to
 * design/usability/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/usability");
const project = exampleProject();
addElement(project, "item", "gem", { name: "Ruby Gem" });

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "Ruby Gem", { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby Gem"`);
  let clicks = 0;
  await app.click(".pagetabs .ltab", "Triggers"), clicks++;
  // Open and New sit on the select's row, icon and text side by side.
  const row = await app.eval<{ open: DOMRect; text: DOMRect; select: DOMRect; height: number }>(`(() => {
    const r = [...document.querySelectorAll(".frow")].find((r) => r.textContent.includes("Right-clicked in the air"));
    const b = r.querySelector(".procnew");
    return { open: r.querySelector(".procopen").getBoundingClientRect().toJSON(), text: b.querySelector("span").getBoundingClientRect().toJSON(), select: r.querySelector(".procpicked").getBoundingClientRect().toJSON(), height: b.getBoundingClientRect().height };
  })()`);
  assert(row.height <= 26 && Math.abs(row.open.y + row.open.height / 2 - (row.select.y + row.select.height / 2)) < 4, `Open/New on the select's row: ${JSON.stringify(row)}`);
  await app.shot(`${OUT}/after-procedure-field.png`);

  await app.eval(`[...document.querySelectorAll(".frow")].find((r) => r.textContent.includes("Right-clicked in the air")).querySelector(".procnew").id = "newproc"`);
  await app.click("#newproc"), clicks++;
  await app.waitFor(`document.querySelector(".blocklyhost") && document.querySelector(".edname")?.textContent === "gem_right_clicked_in_air"`);
  const back = await app.eval<string>(`document.querySelector(".actions .abtn").textContent`);
  assert(back === "Back to Ruby Gem", `Back names the item: ${back}`);
  await app.shot(`${OUT}/after-procedure-created.png`);
  await app.sleep(600);
  const item = JSON.parse(readFileSync(join(project, "elements/items/gem.json"), "utf8"));
  assert(item.onRightClickedInAir === "gem_right_clicked_in_air", `field set and saved: ${item.onRightClickedInAir}`);
  JSON.parse(readFileSync(join(project, "elements/procedures/gem_right_clicked_in_air.json"), "utf8"));

  await app.click(".abtn", "Back to Ruby Gem"), clicks++;
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby Gem"`);
  const value = await app.eval<string>(`[...document.querySelectorAll(".frow")].find((r) => r.textContent.includes("Right-clicked in the air")).querySelector(".procpicked").title`);
  assert(value === "gem_right_clicked_in_air", `back on the item with the field set: ${value}`);
  assert(await app.eval<string>(`document.querySelector(".actions .abtn").textContent`) === "Back to elements", "the item's Back goes to the list again");
  console.log(`right-click procedure task: ${clicks} clicks, 0 keys (before: 13 clicks, 30 keys)`);

  // A second New on the same field picks a free id.
  await app.eval(`[...document.querySelectorAll(".frow")].find((r) => r.textContent.includes("Right-clicked in the air")).querySelector(".procnew").id = "newproc2"`);
  await app.click("#newproc2");
  await app.waitFor(`document.querySelector(".edname")?.textContent === "gem_right_clicked_in_air_2"`);
}, { project });
