/**
 * KUYRUK #50: a filter, search and open folder of the element list survive opening an element and coming back
 * (user, 2026-11-07: "bir filtre uygulayıp filtreden seçilen nesneden çıkınca filtresiz defulta atıyor").
 */
import { resolve } from "node:path";
import { assert, copyProject, REPO, run, evidence } from "./cdp.ts";

const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");
const filterSelect = `document.querySelector(".fsel select")`;
const tiles = `document.querySelectorAll(".tile").length`;

await run(async (app) => {
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 3`, 20000);
  await app.eval(`(() => { const s = ${filterSelect}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "procedure"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await app.sleep(500);
  const filtered = await app.eval<number>(tiles);
  console.log("procedures listed", filtered);
  assert(filtered > 100, "the procedure filter lists procedures");

  await app.eval(`document.getElementById("target")?.removeAttribute("id"); document.querySelector(".tile").setAttribute("id", "target")`);
  await app.click("#target", undefined, { double: true });
  await app.waitFor(`!document.querySelector(".fsel select") || document.querySelectorAll(".tile").length === 0`, 20000);
  await app.sleep(1500);
  await app.key("Escape");
  await app.click(".rtab", "Mod elements");
  await app.waitFor(`document.querySelectorAll(".tile").length > 3`, 20000);

  const value = await app.eval<string>(`${filterSelect}.value`);
  const after = await app.eval<number>(tiles);
  console.log("filter after coming back", value, after);
  assert(value === "procedure", "the filter is kept");
  assert(after === filtered, "the same elements are listed");
  await app.shot(evidence("design/folders/filter-kept.png"));
}, { project });
