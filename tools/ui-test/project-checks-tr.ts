/**
 * KUYRUK 157: project-level checks (ids, mod settings, variables, languages, registry ids, game rules, tags, sound
 * events) carry a check code like the field checks of row 149, so the Turkish UI shows them in Turkish while MCP and
 * the CLI keep the English message. A copy of examples/hello gets problems planted in each kind; every project issue
 * has a code with a string in en and tr, the English messages read as before, and the Problems panel shows them in
 * Turkish. Screenshots go to design/157/ (LIGHT=1 runs it in the light theme).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { loadTags, validateTags } from "../../src/tags/tags.ts";
import { assert, exampleProject, run } from "./cdp.ts";

const OUT = "design/157";
const theme = process.env.LIGHT ? "light" : "dark";
const project = exampleProject();
const json = (file: string) => JSON.parse(readFileSync(join(project, file), "utf8"));
const write = (file: string, value: unknown) => writeFileSync(join(project, file), JSON.stringify(value, null, 2) + "\n");

// Planted problems: a duplicate and a badly named variable, a bad language code, tags with a bad id, a twice-listed tag
// and an entry naming no element, a sound event with a missing file, a dependency with a bad mod id.
const vars = json("variables.json");
vars.variables.push({ ...vars.variables[0] }, { name: "bad name", type: "number", scope: "global_map", initial: "x" });
write("variables.json", vars);
write("localization/english.json", { "item.hellomcedge.ruby": "Ruby" });
write("tags.json", { tags: [
  { type: "item", id: "Bad Tag", entries: [] },
  { type: "block", id: "hellomcedge:shiny", entries: ["no_such_block"] },
  { type: "block", id: "hellomcedge:shiny", entries: [] },
] });
mkdirSync(join(project, "sounds"), { recursive: true });
writeFileSync(join(project, "sounds", "ding.ogg"), "OggS");
write("sound_events.json", { bell: { category: "block", files: ["ding", "missing"] } });
const mod = json("mcedge.json");
mod.mod.dependencies = [{ modId: "Bad Id", version: "*", required: true, side: "both" }];
write("mcedge.json", mod);

const loaded = loadProject(project);
const issues = [...validateProject(loaded, project), ...validateTags(loadTags(project), loaded)];
const uncoded = issues.filter((i) => !i.code);
assert(!uncoded.length, `every project issue has a code: ${JSON.stringify(uncoded)}`);
for (const i of issues) {
  assert(`check.${i.code}` in en && `check.${i.code}` in tr, `strings for check.${i.code}`);
}
// The English messages MCP and the CLI show read as before.
const messages = issues.map((i) => i.message);
for (const expected of ['duplicate variable "playerMoney"', "must be a Java identifier", "must be a number", "language code like en_us",
  '"Bad Tag" is not a tag id (namespace:path, lower case)', "block tag hellomcedge:shiny is listed twice", 'no block element "no_such_block" in this mod',
  'sound event "bell": no sound file sounds/missing.ogg', "must be a valid mod id"]) {
  assert(messages.includes(expected), `English message kept: ${expected} (got ${messages.join(" | ")})`);
}
console.log(`${issues.length} project issues, all coded:`, [...new Set(issues.map((i) => i.code))].join(", "));

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  if (theme === "light") await app.setTheme("light");
  await app.click(".sitem", "sorun");
  await app.waitFor(`document.querySelectorAll(".problems li").length >= ${issues.length}`);
  const panel = await app.eval<string>(`document.querySelector(".problems").textContent`);
  for (const expected of ['yinelenen değişken "playerMoney"', "bir Java tanımlayıcısı olmalı", "en_us gibi bir dil kodu olmalı", "bir etiket kimliği değil",
    "Bloklar için iki kez listelenmiş", 'bu modda Bloklar için "no_such_block" öğesi yok', '"bell" ses olayı: sounds/missing.ogg ses dosyası yok', "geçerli bir mod kimliği olmalı"]) {
    assert(panel.includes(expected), `Turkish: ${expected}`);
  }
  assert(!/duplicate variable|must be a|language code like|is not a tag id|listed twice|in this mod|no sound file/.test(panel), `no English left: ${panel}`);
  await app.shot(`${OUT}/after-problems-tr-${theme}.png`);
}, { project, language: "tr" });
