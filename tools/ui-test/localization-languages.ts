/**
 * KUYRUK #115 (audit L5): the Languages menu adds a language from Minecraft's list (with flags) optionally copied from
 * another, hides a column (kept for the project across restarts), renames a code and removes a language after a
 * confirm. The same over MCP: list_languages, add_language, rename_language, remove_language.
 *   node tools/ui-test/localization-languages.ts [en|tr] [dark|light]
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, launchApp, type App } from "./cdp.ts";

const language = process.argv[2] ?? "en";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const OUT = "design/localization";
const project = exampleProject();
const file = (code: string) => join(project, "localization", `${code}.json`);
const read = (code: string) => JSON.parse(readFileSync(file(code), "utf8")) as Record<string, string>;
const section = language === "tr" ? "Yerelleştirme" : "Localization";
const columns = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".locgrid th code")].map((c) => c.textContent)`);
const menu = async (app: App, item: string) => {
  if (!(await app.eval<boolean>(`!!document.querySelector(".menulist")`))) await app.click(".actions .abtn", language === "tr" ? "Diller" : "Languages");
  await app.click(".menulist button", item);
};
const okButton = `.dialog button[type=submit]`;

// ---- MCP, on its own copy ----
{
  const other = exampleProject();
  const mcp = await connect(other);
  try {
    const before = await mcp.call("list_languages", { available: true });
    assert(before.languages.map((l: { code: string }) => l.code).join() === "en_us,tr_tr" && before.available.some((l: { code: string }) => l.code === "de_de"), "list_languages");
    await mcp.call("add_language", { code: "fr_fr", copyFrom: "en_us" });
    const fr = JSON.parse(readFileSync(join(other, "localization", "fr_fr.json"), "utf8"));
    assert(fr["item.hellomcedge.ruby"] === "Shiny Ruby" && fr["block.hellomcedge.ruby_block"] === "Block of Ruby", "add_language copies en_us with the element names");
    await mcp.call("rename_language", { from: "fr_fr", to: "fr_ca" });
    assert(existsSync(join(other, "localization", "fr_ca.json")) && !existsSync(join(other, "localization", "fr_fr.json")), "rename_language moves the file");
    const removed = await mcp.call("remove_language", { code: "fr_ca" });
    assert(!existsSync(join(other, "localization", "fr_ca.json")) && removed.length === 2, "remove_language deletes the file");
    const refused = await mcp.call("remove_language", { code: "en_us" }, true);
    assert(String(refused).includes("cannot be removed"), "en_us cannot be removed");
  } finally {
    await mcp.close();
  }
}

// ---- the app ----
// One user data folder for both runs, so the restart sees what the first run kept.
const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
const app = await launchApp({ project, language, theme, userData });
try {
  await app.click(".rtab", section);
  await app.waitFor(`document.querySelector(".locgrid tbody tr[data-key]")`);

  // Add de_de, copied from tr_tr, picked from the list.
  await menu(app, language === "tr" ? "Dil ekle" : "Add language");
  await app.waitFor(`document.querySelector(".langpick button")`);
  await app.setValue(".dialog input", "deu");
  assert(await app.eval<boolean>(`!!document.querySelector('.langpick [data-code="de_de"] svg.flag')`), "Deutsch is listed with its flag");
  await app.click('.langpick [data-code="de_de"]');
  await app.setValue(".dialog select", "tr_tr");
  await app.shot(`${OUT}/115-add-language-${language}-${theme}.png`);
  await app.click(okButton);
  await app.waitFor(`[...document.querySelectorAll(".locgrid th code")].some((c) => c.textContent === "de_de")`);
  await app.sleep(300);
  assert(JSON.stringify(read("de_de")) === JSON.stringify(read("tr_tr")), "de_de starts with the tr_tr texts");

  // Hide the de_de column; it stays hidden after a restart of the app.
  await menu(app, "de_de");
  await app.key("Escape");
  assert(!(await columns(app)).includes("de_de"), `the column is hidden: ${await columns(app)}`);
  assert(existsSync(file("de_de")), "hiding keeps the language");
  await app.shot(`${OUT}/115-column-hidden-${language}-${theme}.png`);
} finally {
  await app.close();
}

const again = await launchApp({ project, language, theme, userData });
try {
  await again.click(".rtab", section);
  await again.waitFor(`document.querySelector(".locgrid tbody tr[data-key]")`);
  assert(!(await columns(again)).includes("de_de"), "still hidden after a restart");
  await menu(again, "de_de");
  await again.key("Escape");
  assert((await columns(again)).includes("de_de"), "shown again");

  // Rename de_de to de_at: the file moves.
  await menu(again, language === "tr" ? "Dil kodunu değiştir" : "Rename language code");
  await again.setValue(".dialog select", "de_de");
  await again.setValue(".dialog input.mono", "tr_tr");
  assert(await again.eval<boolean>(`document.querySelector("${okButton}").disabled`), "a taken code is refused");
  await again.setValue(".dialog input.mono", "de_at");
  await again.click(okButton);
  await again.waitFor(`[...document.querySelectorAll(".locgrid th code")].some((c) => c.textContent === "de_at")`);
  await again.sleep(300);
  assert(existsSync(file("de_at")) && !existsSync(file("de_de")), "renamed on disk");

  // Remove de_at: the dialog says what goes and needs the button.
  await menu(again, language === "tr" ? "Dili kaldır" : "Remove language");
  await again.setValue(".dialog select", "de_at");
  const warning = await again.eval<string>(`document.querySelector(".dialog .warn-text").textContent`);
  assert(warning.includes("de_at") && warning.includes(String(Object.keys(read("de_at")).length)) && warning.includes("localization/de_at.json"), `the confirm names the language, count and file: ${warning}`);
  await again.shot(`${OUT}/115-remove-language-${language}-${theme}.png`);
  await again.key("Escape");
  assert(await again.eval<boolean>(`!!document.querySelector(".dialog")`), "Escape does not dismiss the remove confirm");
  await again.click(okButton);
  await again.waitFor(`![...document.querySelectorAll(".locgrid th code")].some((c) => c.textContent === "de_at")`);
  await again.sleep(300);
  assert(!existsSync(file("de_at")) && existsSync(file("tr_tr")), "removed on disk, others kept");
  console.log("PASS");
} catch (error) {
  console.error("FAIL", error);
  await again.shot("tools/ui-test/last-failure.png").catch(() => {});
  process.exitCode = 1;
} finally {
  await again.close();
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch { /* Chromium may still hold a lock for a moment */ }
}
