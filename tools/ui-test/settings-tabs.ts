/**
 * KUYRUK 121: Workspace settings in three tabs (Mod, Dependencies, Integrations), each with its own find bar and toolbar,
 * and the mod id and package changed through a confirm that rewrites ids, translation keys and folders. Runs on a copy
 * of examples/hello. Screenshots go to design/121/ (args: suffix, theme; "before" only shoots the old screen).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/121";
const suffix = process.argv[2] ?? "after";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const project = exampleProject();
const read = (path: string) => JSON.parse(readFileSync(join(project, path), "utf8"));
const placeholder = (app: App) => app.eval<string>(`document.querySelector(".view .findbar input").placeholder`);
const buttons = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".view .actions .abtn")].map((b) => b.textContent)`);
const enabled = (app: App, label: string) => app.eval<boolean>(`!![...document.querySelectorAll(".view .actions .abtn")].find((b) => b.textContent === ${JSON.stringify(label)} && !b.disabled)`);
const tab = (app: App, name: string) => app.click(".view [role=tab]", name);

await run(async (app) => {
  await app.setTheme(theme);
  await app.click(".rtab", "Workspace settings");
  await app.waitFor(`document.querySelector(".view .findbar")`);
  if (suffix === "before") return void (await app.shot(`${OUT}/settings-${theme}-before.png`));

  // 1. Three tabs under the toolbar; each brings its own find bar and toolbar.
  const tabs = await app.eval<string[]>(`[...document.querySelectorAll(".view [role=tab]")].map((b) => b.textContent)`);
  assert(tabs.length === 3 && tabs[0] === "Mod" && tabs[1].startsWith("Dependencies3") && tabs[2].startsWith("Integrations0"), `tabs: ${tabs.join("|")}`);
  const seen = new Set<string>();
  for (const name of ["Mod", "Dependencies", "Integrations"]) {
    await tab(app, name);
    await app.sleep(150);
    seen.add(`${await placeholder(app)} / ${(await buttons(app)).join(",")}`);
  }
  assert(seen.size === 3, `each tab has its own find bar and toolbar: ${[...seen].join(" | ")}`);

  // 2. Mod: the find bar narrows the form; the identity change rewrites what names the mod.
  await tab(app, "Mod");
  await app.setValue(".view .findbar input", "vers");
  await app.sleep(150);
  const labels = await app.eval<string[]>(`[...document.querySelectorAll(".view .frow > label")].map((l) => l.textContent)`);
  assert(labels.length === 1 && labels[0] === "Version", `search narrows the form: ${labels.join(", ")}`);
  await app.setValue(".view .findbar input", "");
  await app.shot(`${OUT}/mod-${theme}-${suffix}.png`);
  await app.click(".view .actions .abtn", "Change id and package");
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.setField("Mod ID", "rubymod", ".dialog");
  await app.setField("Java package", "dev.ruby.mod", ".dialog");
  await app.waitFor(`document.querySelector("[data-testid=identity-preview]")?.textContent.includes("4 translation keys")`, 5000);
  await app.shot(`${OUT}/identity-${theme}-${suffix}.png`);
  await app.setField("Mod ID", "Bad Id", ".dialog");
  await app.waitFor(`document.querySelector(".dialog .ferr")`);
  assert(await app.eval<boolean>(`document.querySelector(".dialog button[type=submit]").disabled`), "an invalid id cannot be applied");
  await app.setField("Mod ID", "rubymod", ".dialog");
  await app.waitFor(`!document.querySelector(".dialog button[type=submit]").disabled`);
  await app.click(".dialog button[type=submit]");
  await app.waitFor(`!document.querySelector(".dialog")`);
  await app.waitFor(`document.querySelector(".view .fmeta").textContent.includes("rubymod")`);
  assert(read("mcedge.json").mod.id === "rubymod" && read("mcedge.json").mod.package === "dev.ruby.mod", "mcedge.json has the new identity");
  const tr = read("localization/tr_tr.json");
  assert(tr["item.rubymod.ruby"] === "Yakut" && !("item.hellomcedge.ruby" in tr), `keys renamed: ${Object.keys(tr).join(", ")}`);
  // A later edit keeps the new identity (the form's draft follows the change).
  await app.setField("Display name", "Ruby Mod");
  await app.sleep(1200);
  assert(read("mcedge.json").mod.id === "rubymod" && read("mcedge.json").mod.name === "Ruby Mod", `edit after the change keeps the id: ${JSON.stringify(read("mcedge.json").mod)}`);

  // 3. Dependencies: a selection the search hides is dropped; Add clears the search so the new row shows.
  await tab(app, "Dependencies");
  await app.click(".view .grid tbody tr", "geckolib");
  assert(await enabled(app, "Delete selected"), "Delete is enabled for the selected dependency");
  await app.setValue(".view .findbar input", "jei");
  await app.sleep(200);
  assert(!(await enabled(app, "Delete selected")), "Delete is disabled once the search hides the selection");
  await app.click(".view .actions .abtn", "Add dependency");
  await app.sleep(200);
  assert(await app.eval<string>(`document.querySelector(".view .findbar input").value`) === "", "Add clears the search");
  assert(await app.eval<boolean>(`!!document.querySelector(".view .grid tbody tr.sel")`) && await enabled(app, "Delete selected"), "the new dependency is selected");
  await app.click(".view .actions .abtn", "Delete selected");
  await app.shot(`${OUT}/dependencies-${theme}-${suffix}.png`);

  // 4. Integrations: the toolbar turns the selected integration on.
  await tab(app, "Integrations");
  await app.click(".view .grid tbody tr");
  await app.click(".view .actions .abtn", "Optional");
  await app.sleep(1200);
  assert(JSON.stringify(read("mcedge.json").mod.integrations) === JSON.stringify([{ id: "recipe_viewer", required: false }]), `integration saved: ${JSON.stringify(read("mcedge.json").mod.integrations)}`);
  assert(await app.eval<boolean>(`[...document.querySelectorAll(".view .actions .abtn")].find((b) => b.textContent === "Optional").getAttribute("aria-pressed") === "true"`), "Optional is shown as on");
  await app.shot(`${OUT}/integrations-${theme}-${suffix}.png`);
  console.log("settings tabs, identity change, dependencies and integrations OK");
}, { project });
