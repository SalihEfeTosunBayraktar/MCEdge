/**
 * KUYRUK 126: New project from the welcome screen and from File > New project. Name -> suggested mod id and package,
 * a template, the target engines and the parent folder; Create makes the project and opens it, the engine menu lists
 * only its engines, and a second project in the same folder is refused with the reason. Args: language (en|tr), theme.
 * Screenshots go to design/126/.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, REPO, run, type App, evidence } from "./cdp.ts";

const lang = (process.argv[2] ?? "en") as "en" | "tr";
const theme = (process.argv[3] ?? "dark") as "dark" | "light";
const s = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
const parent = mkdtempSync(join(tmpdir(), "mcedge-new-ui-"));
const shot = (app: App, name: string) => app.shot(evidence(`design/126/${name}-${lang}-${theme}.png`));
const value = (app: App, name: string) => app.eval<string>(`document.querySelector('[data-testid="new-project"] input[name="${name}"]').value`);
const fill = async (app: App, name: string) => {
  await app.setValue('[data-testid="new-project"] input[name="name"]', name);
  await app.setValue('[data-testid="new-project"] input[name="parent"]', parent);
};

await run(async (app) => {
  await app.setTheme(theme);
  await app.waitFor(`!!document.querySelector('[data-testid="welcome-new"]')`);
  await shot(app, "welcome");
  await app.click('[data-testid="welcome-new"]');
  await app.waitFor(`!!document.querySelector('[data-testid="new-project"]')`);
  assert(await app.eval<boolean>(`document.activeElement?.closest('[data-testid="new-project"]') != null`), "the dialog takes the focus");
  await fill(app, "Gem Works");
  assert(await value(app, "modId") === "gem_works" && await value(app, "package") === "com.example.gem_works", "mod id and package follow the name");
  await app.setValue('[data-testid="new-project"] input[name="author"]', "Salih");
  assert(await value(app, "package") === "com.salih.gem_works", "the package follows the author");
  // Target two engines.
  const engines = await app.eval<string[]>(`[...document.querySelectorAll('[data-testid="new-project"] input[name="engine"]')].map((i) => i.value)`);
  assert(engines.length === 5, "all 5 engines offered");
  for (const id of engines.filter((e) => !["neoforge-1.21.5", "fabric-1.21.5"].includes(e))) {
    await app.eval(`document.querySelector('[data-testid="new-project"] input[name="engine"][value="${id}"]').click()`);
  }
  const path = await app.eval<string>(`document.querySelector('[data-testid="new-project-path"]').textContent`);
  assert(path.endsWith("gem_works"), `the project folder is shown (${path})`);
  await shot(app, "dialog");
  await app.click('[data-testid="new-project"] .dlg-buttons button', s["newProject.create"]);
  await app.waitFor(`document.querySelectorAll(".tile").length >= 7`, 60_000);
  const dir = join(parent, "gem_works");
  const mod = JSON.parse(readFileSync(join(dir, "mcedge.json"), "utf8")).mod;
  assert(mod.id === "gem_works" && mod.name === "Gem Works" && mod.package === "com.salih.gem_works", "the project is written with the settings");
  assert(JSON.stringify([...mod.engines].sort()) === JSON.stringify(["fabric-1.21.5", "neoforge-1.21.5"]), `target engines saved (${JSON.stringify(mod.engines)})`);
  assert((await app.eval<string>(`document.querySelector(".wsname").textContent`)).includes("Gem Works"), "the new project is open");
  await app.click(".enginebtn");
  const menu = await app.eval<string[]>(`[...document.querySelectorAll(".menulist button")].map((b) => b.textContent)`);
  assert(menu.length === 2, `the engine menu lists the project's 2 engines (${menu.join(", ")})`);
  await app.key("Escape");
  await shot(app, "opened");

  // File > New project with the same folder is refused with the reason, and the dialog stays.
  await app.click(".menu", s["menu.file"]);
  await app.click(".menulist button", s["menu.newProject"]);
  await app.waitFor(`!!document.querySelector('[data-testid="new-project"]')`);
  await fill(app, "Gem Works");
  await app.click('[data-testid="new-project"] .dlg-buttons button', s["newProject.create"]);
  await app.waitFor(`!!document.querySelector('[data-testid="new-project-error"]')`);
  const error = await app.eval<string>(`document.querySelector('[data-testid="new-project-error"]').textContent`);
  assert(error.includes("not empty") && !error.includes("invoking remote method"), `the reason is shown (${error})`);
  await shot(app, "dialog-error");
  await app.key("Escape");
  await app.sleep(200);
  assert(await app.eval<boolean>(`!document.querySelector('[data-testid="new-project"]')`) && existsSync(dir), "Escape closes the dialog");
  console.log(`${lang} ${theme}: new project from the welcome screen and File menu`);
}, { language: lang });
