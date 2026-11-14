/**
 * KUYRUK 168: File > Export mod jar drafts the changelog of the version from the commits since the last export in
 * which every engine built. On a copy of examples/hello made a git repository (two commits, a remembered export, then
 * two more): the Changelog box lists only the two newer commits under the version, says since which export, can be
 * edited and copied. EXPORT=1 also exports (in the tr run) fabric-1.21.5 for real and checks that the export is remembered and the
 * next changelog is empty (heavy: a Gradle build). BEFORE=1 only takes the before screenshot. Screenshots go to
 * design/168/ (en and tr, dark and light).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAST_EXPORT, recordExport } from "../../src/vcs/changelog.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/168";
const project = exampleProject();
const git = (...args: string[]) => {
  const r = spawnSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};
const commit = (subject: string) => {
  writeFileSync(join(project, "notes.txt"), `${subject}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", subject);
};
git("init", "-q");
commit("Add the ruby");
commit("Fix the ruby block drop");
await recordExport(project, "0.1.0");
commit("Add the sapphire ore");
commit("Make the ruby sword faster");

const BOX = ".exportdlg .changelog textarea";
const open = async (app: App) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.key("e", 2);
  await app.waitFor(`document.querySelector(${JSON.stringify(BOX)})?.value.includes("##")`, 15000);
};
const value = (app: App) => app.eval<string>(`document.querySelector(${JSON.stringify(BOX)}).value`);
const source = (app: App) => app.eval<string>(`document.querySelector(".exportdlg .clsource").textContent`);

for (const language of ["en", "tr"]) {
  await run(async (app) => {
    if (process.env.BEFORE) {
      await app.waitFor(`document.querySelector(".tile")`, 60000);
      await app.key("e", 2);
      await app.waitFor(`document.querySelector(".exportdlg")`);
      await app.sleep(500);
      await app.shot(`${OUT}/before-${language}-dark.png`);
      return;
    }
    await open(app);
    assert(await value(app) === "## 0.1.0\n\n- Make the ruby sword faster\n- Add the sapphire ore\n", `only the commits after the export: ${JSON.stringify(await value(app))}`);
    const said = await source(app);
    assert(said.includes("0.1.0") && said.includes("2"), `says since which export: ${said}`);
    await app.sleep(300);
    await app.shot(`${OUT}/after-${language}-dark.png`);
    // The theme button is behind the dialog's backdrop: close, switch, open again.
    const reopenIn = async (theme: "dark" | "light") => {
      await app.key("Escape");
      await app.waitFor(`!document.querySelector(".exportdlg")`);
      await app.setTheme(theme);
      await open(app);
    };
    await reopenIn("light");
    await app.sleep(400);
    await app.shot(`${OUT}/after-${language}-light.png`);
    await reopenIn("dark");

    // Editable and copyable.
    await app.setValue(BOX, "## 0.1.0\n\n- New ore: sapphire\n");
    await app.click(".exportdlg .clbar button");
    await app.waitFor(`document.querySelector(".exportdlg .clbar button").textContent.includes(${JSON.stringify(language === "en" ? "Copied" : "Kopyalandı")})`);
    const copied = await app.mainEval<string>(`(process.mainModule ? process.mainModule.require : require)("electron").clipboard.readText()`);
    // Windows keeps clipboard text with CRLF line ends.
    assert(copied.replaceAll("\r\n", "\n") === "## 0.1.0\n\n- New ore: sapphire\n", `copied the edited text: ${JSON.stringify(copied)}`);

    if (!process.env.EXPORT || language !== "tr") return;
    // A real export of one engine (in the last run, as it moves the start of the changelog): when it builds, the export is remembered and the next changelog is empty.
    const folder = join(mkdtempSync(join(tmpdir(), "mcedge-export-")), "dist");
    await app.setValue(".exportdlg .fpair > input", folder);
    await app.click(".exportdlg button[type=submit]");
    await app.waitFor(`document.querySelector(".exportdlg .eres")`, 15 * 60_000);
    assert(await app.eval<boolean>(`!!document.querySelector(".exportdlg .eres.ok")`), "the export built");
    const mark = JSON.parse(readFileSync(join(project, LAST_EXPORT), "utf8"));
    const head = spawnSync("git", ["-C", project, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    assert(mark.commit === head && mark.version === "0.1.0", `remembered at HEAD: ${JSON.stringify(mark)}`);
    await app.click(".exportdlg .dlg-buttons button", "Kapat");
    await app.waitFor(`!document.querySelector(".exportdlg")`);
    await open(app);
    assert(await value(app) === "## 0.1.0\n\n", `nothing since the new export: ${JSON.stringify(await value(app))}`);
    assert(existsSync(folder), "the jar folder exists");
  }, { project, language, width: 1440, height: 900 });
}
