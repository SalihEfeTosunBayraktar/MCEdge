/**
 * Q222: the Problems tab lists translation keys nothing uses, one info entry per language, with a Remove button (quick fix).
 * On a copy of examples/hello with the fixture of tools/mcp-test/cascade-fixture.ts: en_us and tr_tr each get an entry, the keys
 * the engine needs by name are not counted, the button removes the keys of that language only. Screenshots (dark, light) go to
 * design/222/.
 *   node tools/ui-test/unused-translations.ts [en|tr]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { buildCascadeFixture } from "../mcp-test/cascade-fixture.ts";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";

const language = process.argv[2] === "tr" ? "tr" : "en";
const s: Record<string, string> = language === "tr" ? tr : en;
const project = exampleProject();
buildCascadeFixture(project);
const OUT = "design/222";
mkdirSync(join(REPO, OUT), { recursive: true });
const lang = (code: string) => JSON.parse(readFileSync(join(project, `localization/${code}.json`), "utf8")) as Record<string, string>;
const entries = (app: App) => app.eval<{ path: string; severity: string; text: string; fix: boolean }[]>(`[...document.querySelectorAll(".problems li[data-severity]")].filter((li) => li.querySelector("code")?.textContent.startsWith("localization.")).map((li) => ({
  path: li.querySelector("code").textContent, severity: li.dataset.severity, text: li.textContent, fix: !!li.querySelector("[data-testid=fix-unused-translations]") }))`);
const fix = (app: App, code: string) => app.eval(`[...document.querySelectorAll(".problems li")].find((li) => li.querySelector("code")?.textContent === "localization.${code}").querySelector("[data-testid=fix-unused-translations]").click()`);

await run(async (app) => {
  await app.eval(`[...document.querySelectorAll("button.sitem")].find((b) => /problem|sorun/i.test(b.textContent)).click()`);
  await app.waitFor(`document.querySelectorAll(".problems li[data-severity]").length > 0 && [...document.querySelectorAll(".problems code")].some((c) => c.textContent === "localization.en_us")`, 60000);
  const found = await entries(app);
  assert(found.map((e) => e.path).sort().join() === "localization.en_us,localization.tr_tr", `one entry per language: ${found.map((e) => e.path)}`);
  assert(found.every((e) => e.severity === "info" && e.fix), "info severity with a quick fix");
  assert(found[0].text.includes("2") && found[0].text.includes("item.hellomcedge.long_gone, old.removed_block"), `en_us: two keys named: ${found[0].text}`);
  assert(found[1].text.includes("1") && found[1].text.includes("old.removed_block"), `tr_tr: one key: ${found[1].text}`);
  await app.shot(`${OUT}/problems-${language}-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/problems-${language}-light.png`);
  await app.setTheme("dark");

  // The quick fix removes the keys of that language only; the entry goes, the other stays.
  await fix(app, "tr_tr");
  await app.waitFor(`![...document.querySelectorAll(".problems code")].some((c) => c.textContent === "localization.tr_tr")`, 30000);
  assert(!("old.removed_block" in lang("tr_tr")) && lang("tr_tr")["gem.msg"] === "Mücevher buldun", "tr_tr lost its unused key and kept the used ones");
  assert("old.removed_block" in lang("en_us"), "en_us is untouched");
  assert((await entries(app)).map((e) => e.path).join() === "localization.en_us", "the en_us entry is still listed");
  await fix(app, "en_us");
  await app.waitFor(`![...document.querySelectorAll(".problems code")].some((c) => c.textContent.startsWith("localization."))`, 30000);
  const en_us = lang("en_us");
  assert(!("old.removed_block" in en_us) && !("item.hellomcedge.long_gone" in en_us) && "subtitles.hellomcedge.chime" in en_us && "shared.msg" in en_us && "item.minecraft.diamond" in en_us, "en_us lost only the unused keys");
  await app.shot(`${OUT}/problems-after-${language}-dark.png`);
}, { project, language, theme: "dark" });
