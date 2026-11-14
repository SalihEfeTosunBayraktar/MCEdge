/**
 * KUYRUK #117 (audit L6, L8, L11): a group list (element types, custom key prefixes, counts); element keys show their
 * type, cannot be deleted, open their element and follow renames; Reset to element name drops an en_us override; the
 * keys the generator writes beyond names (GUI labels, game rule texts...) are listed as element keys.
 *   node tools/ui-test/localization-groups.ts [en|tr] [dark|light]
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, exampleProject, REPO, run } from "./cdp.ts";

const language = process.argv[2] ?? "en";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const OUT = "design/localization";
const section = language === "tr" ? "Yerelleştirme" : "Localization";
const etr = [resolve(REPO, "..", "ETREconomy-MCEdge"), resolve(REPO, "..", "..", "ETREconomy-MCEdge")].find(existsSync)!;
const rowsCount = `Number(document.querySelector(".locgrid").dataset.rows)`;
const groups = `[...document.querySelectorAll(".locgroups .lgroup")].map((g) => ({ id: g.dataset.group, count: Number(g.querySelector(".lgcount").textContent) }))`;

// ---- ETR: groups and generator keys ----
const etrCopy = copyProject(etr, "etr");
await run(async (app) => {
  await app.click(".rtab", section);
  await app.waitFor(`document.querySelector(".locgrid tbody tr[data-key]")`, 20000);
  // The generator's keys arrive after the names: wait until a GUI label key is listed.
  await app.waitFor(`document.querySelector('.locgroups [data-group="type:gui"]')`, 20000);
  const list = await app.eval<{ id: string; count: number }[]>(groups);
  const all = list.find((g) => g.id === "all")!.count;
  const sum = list.filter((g) => g.id !== "all").reduce((n, g) => n + g.count, 0);
  assert(all === await app.eval<number>(rowsCount) && sum === all, `group counts add up: ${sum} of ${all}`);
  assert(list.some((g) => g.id.startsWith("type:")) && list.some((g) => g.id.startsWith("prefix:")), "element types and custom prefixes");

  await app.click('.locgroups [data-group="type:gui"]');
  const guiRows = await app.eval<number>(rowsCount);
  const guiKeys = await app.eval<string[]>(`[...document.querySelectorAll(".locgrid tbody tr[data-key]")].map((r) => r.dataset.key)`);
  assert(guiRows === list.find((g) => g.id === "type:gui")!.count && guiRows > 24, `GUI keys: titles and labels (${guiRows})`);
  assert(guiKeys.some((k) => k.split(".").length > 3), `a GUI label key the generator writes: ${guiKeys.slice(0, 3)}`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".locgrid tbody .ktypename")].every((s) => s.textContent.length > 0)`), "element keys show their type");
  await app.click(`.locgrid tr[data-key="${guiKeys.find((k) => k.split(".").length > 3)}"] td.lockey`);
  assert(await app.eval<boolean>(`document.querySelector(".actions .abtn.danger").disabled`), "an element key cannot be deleted");
  assert(await app.eval<boolean>(`!!document.querySelector(".locdetail .linkbtn")`), "the strip offers Open");
  await app.shot(`${OUT}/117-groups-gui-${language}-${theme}.png`);

  const prefix = list.find((g) => g.id.startsWith("prefix:"))!;
  await app.click(`.locgroups [data-group="${prefix.id}"]`);
  assert(await app.eval<number>(rowsCount) === prefix.count, `custom group ${prefix.id}`);
  assert(await app.eval<boolean>(`!document.querySelector(".locgrid tbody .ktypename")`), "custom keys have no type");
}, { project: etrCopy, language, theme });

// ---- hello: rename follows, reset to the element name, open the element ----
const hello = exampleProject();
const en = () => JSON.parse(readFileSync(join(hello, "localization", "en_us.json"), "utf8")) as Record<string, string>;
const mcp = await connect(hello);
try {
  await mcp.call("rename_element", { type: "item", id: "ruby", newId: "ruby_gem" });
} finally {
  await mcp.close();
}
assert(en()["item.hellomcedge.ruby_gem"] === "Shiny Ruby" && !("item.hellomcedge.ruby" in en()), "the override followed the rename");

await run(async (app) => {
  await app.click(".rtab", section);
  const key = "item.hellomcedge.ruby_gem";
  await app.waitFor(`document.querySelector('.locgrid tr[data-key="${key}"]')`);
  assert(await app.eval<boolean>(`!!document.querySelector('.locgrid tr[data-key="${key}"] .ktypename')`), "the renamed key is still the element's");
  await app.click(`.locgrid tr[data-key="${key}"] td.lockey`);
  await app.shot(`${OUT}/117-reset-before-${language}-${theme}.png`);
  await app.click(".actions .abtn", language === "tr" ? "Öğe adına döndür" : "Reset to element name");
  await app.sleep(800);
  assert(!(key in en()), "the en_us override is gone from the file");
  const cell = `document.querySelector('.locgrid td[data-row="${key}"][data-lang="en_us"]')`;
  assert(await app.eval<boolean>(`${cell}.classList.contains("inh")`), "the cell shows the inherited name");
  assert(await app.eval<boolean>(`document.querySelector(".actions .abtn", "x") && [...document.querySelectorAll(".actions .abtn")].find((b) => b.textContent.includes(${JSON.stringify(language === "tr" ? "Öğe adına döndür" : "Reset to element name")})).disabled`), "nothing left to reset");
  await app.shot(`${OUT}/117-reset-after-${language}-${theme}.png`);

  await app.click(".locdetail .linkbtn");
  await app.waitFor(`document.querySelector(".edhead .edname")`);
  assert((await app.eval<string>(`document.querySelector(".edhead").textContent`)).length > 0, "Open shows the element editor");
}, { project: hello, language, theme });
