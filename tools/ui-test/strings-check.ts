/**
 * KUYRUK 124: the string table follows the wording rules of design/WORKBENCH-RULES.md section 4, in en and tr. No app
 * is started: it reads config/ui-strings, the element type texts and the toolbar code.
 *   node tools/ui-test/strings-check.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./cdp.ts";

const read = (path: string) => JSON.parse(readFileSync(join(REPO, path), "utf8"));
const en = read("config/ui-strings/en.json") as Record<string, string>;
const tr = read("config/ui-strings/tr.json") as Record<string, string>;
const problems: string[] = [];
const fail = (message: string) => problems.push(message);

// 1. Complete Turkish, no emoji anywhere.
for (const key of Object.keys(en)) if (!tr[key]?.trim()) fail(`tr is missing ${key}`);
for (const key of Object.keys(tr)) if (!(key in en)) fail(`tr has ${key}, which en lacks`);
for (const [lang, table] of [["en", en], ["tr", tr]] as const) {
  for (const [key, value] of Object.entries(table)) if (/\p{Extended_Pictographic}/u.test(value)) fail(`${lang} ${key} has an emoji`);
}

// 2. No MCreator internals and no stale "for now" texts in what the user reads (the About disclaimer may name it).
const userTexts: [string, string][] = [];
const collect = (where: string, node: unknown) => {
  if (Array.isArray(node)) return node.forEach((n, i) => collect(`${where}[${i}]`, n));
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && ["label", "help", "description", "name", "title"].includes(key)) userTexts.push([`${where}.${key}`, value]);
    else collect(`${where}.${key}`, value);
  }
};
for (const type of readdirSync(join(REPO, "element-types"))) {
  try {
    collect(`element-types/${type}`, read(`element-types/${type}/type.json`));
  } catch {
    // Not a type folder.
  }
}
collect("config/element-types/tr.json", read("config/element-types/tr.json"));
for (const [lang, table] of [["en", en], ["tr", tr]] as const) for (const [key, value] of Object.entries(table)) if (key !== "about.note") userTexts.push([`${lang} ${key}`, value]);
for (const [where, text] of userTexts) {
  if (/MCreator/.test(text)) fail(`${where} mentions MCreator: ${text}`);
  if (/\bfor now\b|şimdilik/i.test(text)) fail(`${where} is a stale "for now" text: ${text}`);
}

// 3. Verbs. "New X" creates a project object, "Add X" puts a row into a list that belongs to something else.
const NEW = ["action.new", "folders.new", "tags.add", "variables.add", "localization.addKey", "resources.create", "menu.createTexture", "git.newBranch", "code.newFile", "code.newFolder"];
const ADD = ["settings.dep.add", "tags.addEntry", "gui.add", "localization.addLanguage", "gui.layer.add"];
// Plain "New" is the element list's New, whose kind is picked next.
for (const key of NEW) if (!/^New\b/.test(en[key] ?? "") || !/^Yeni\b/.test(tr[key] ?? "")) fail(`${key} must read "New ..." / "Yeni ...": ${en[key]} / ${tr[key]}`);
for (const key of ADD) if (!en[key]?.startsWith("Add ") || !/ ekle$/.test(tr[key] ?? "")) fail(`${key} must read "Add ..." / "... ekle": ${en[key]} / ${tr[key]}`);

// Toolbars: no "Create", and a destructive button on a list acts on the selection and says so. Delete removes from
// the project (Sil), Remove takes out of a list (Kaldır); Discard and Revert are git's own verbs, Stop ends a run.
const toolbars: { file: string; key: string; danger: boolean }[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    const path = `${dir}/${name.name}`;
    if (name.isDirectory()) walk(path);
    else if (name.name.endsWith(".tsx")) {
      for (const m of readFileSync(join(REPO, path), "utf8").matchAll(/<ActionButton\b[^>]*?label=\{t\("([^"]+)"\)\}[^>]*>/gs)) toolbars.push({ file: name.name, key: m[1], danger: /tone="danger"/.test(m[0]) });
    }
  }
};
walk("app/renderer/src");
/** Editors whose Delete acts on the open element itself, not on a selection in a list. */
const OWN_OBJECT = new Set(["ElementEditor.tsx"]);
for (const { file, key, danger } of toolbars) {
  if (/^Create\b/.test(en[key] ?? "")) fail(`${file} ${key}: a toolbar says "New", not "Create": ${en[key]}`);
  if (!danger || OWN_OBJECT.has(file) || /^(Discard|Revert|Stop)\b/.test(en[key] ?? "")) continue;
  const ok = (en[key] === "Delete selected" && tr[key] === "Seçileni sil") || (en[key] === "Remove selected" && tr[key] === "Seçileni kaldır");
  if (!ok) fail(`${file} ${key}: a destructive toolbar button reads "Delete selected" or "Remove selected": ${en[key]} / ${tr[key]}`);
}

// 4. A menu item that opens a dialog or a file picker ends with "...".
const DIALOG_MENUS = ["menu.openProject", "menu.importTextures", "menu.createTexture", "menu.importSounds", "menu.importModel", "menu.importStructure", "menu.exportJar", "menu.exportWorkspace", "menu.preferences", "menu.docs", "menu.shortcuts", "menu.checkUpdates", "menu.newElement", "menu.quickOpen"];
for (const key of DIALOG_MENUS) if (!en[key]?.endsWith("...") || !tr[key]?.endsWith("...")) fail(`${key} opens a dialog and ends with "...": ${en[key]} / ${tr[key]}`);

console.log(`checked ${Object.keys(en).length} strings, ${userTexts.length} user texts, ${toolbars.length} toolbar buttons`);
if (problems.length) {
  console.error(`FAIL\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} else console.log("PASS");
