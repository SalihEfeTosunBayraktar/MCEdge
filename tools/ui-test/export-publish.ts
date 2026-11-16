/**
 * Q238: the Publish section of File > Export mod jar. Ticking a platform (a real click) shows the release type and the
 * gate's explanation and turns Export into "Export and publish"; without a project in Mod settings and a token in
 * Preferences the publish stops before any build and the report says what to set where. Unticking turns it back into a
 * plain export. Screenshots in design/238/ (en and tr, dark and light). The uploads themselves are covered by
 * tools/mcp-test/publish.ts against a mock API.
 */
import { assert, exampleProject, run, type App } from "./cdp.ts";

const OUT = "design/238";
const project = exampleProject();
const DLG = ".exportdlg";

const open = async (app: App) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.key("e", 2);
  await app.waitFor(`document.querySelector("${DLG} [data-testid=publish-modrinth]")`, 15000);
};
const submitText = (app: App) => app.eval<string>(`document.querySelector("${DLG} button[type=submit]").textContent`);

for (const language of ["en", "tr"]) {
  await run(async (app) => {
    await open(app);
    const plain = await submitText(app);
    assert(!(await app.eval<boolean>(`!!document.querySelector("${DLG} select")`)), "no release type before a platform is ticked");
    await app.click(`${DLG} [data-testid=publish-modrinth]`);
    await app.click(`${DLG} [data-testid=publish-curseforge]`);
    await app.waitFor(`document.querySelector("${DLG} select")`);
    const publishText = await submitText(app);
    assert(publishText !== plain && publishText.includes(language === "en" ? "publish" : "yayınla"), `button says publish: ${publishText}`);
    const hint = await app.eval<string>(`[...document.querySelectorAll("${DLG} .hint")].map((h) => h.textContent).join(" ")`);
    assert(hint.includes("v0.1.0"), `the gate is explained with the tag: ${hint}`);
    await app.sleep(300);
    await app.shot(`${OUT}/publish-${language}-dark.png`);

    await app.setValue(`${DLG} .fpair > input`, `${project}-jars`);
    await app.click(`${DLG} button[type=submit]`);
    await app.waitFor(`document.querySelector("[data-testid=publish-report]")`, 30000);
    const report = await app.eval<string>(`document.querySelector("[data-testid=publish-report]").textContent`);
    const expect = language === "en" ? ["Modrinth: set the project", "CurseForge: set the project", "Modrinth: add a token", "CurseForge: add a token"]
      : ["Modrinth: projeyi", "CurseForge: projeyi", "Modrinth: Tercihler", "CurseForge: Tercihler"];
    for (const text of expect) assert(report.includes(text), `report says "${text}": ${report}`);
    assert(!(await app.eval<boolean>(`!!document.querySelector("${DLG} .estate")`)), "no build started");
    await app.sleep(300);
    await app.shot(`${OUT}/problems-${language}-dark.png`);

    await app.key("Escape");
    await app.waitFor(`!document.querySelector("${DLG}")`);
    await app.setTheme("light");
    await open(app);
    await app.click(`${DLG} [data-testid=publish-modrinth]`);
    await app.waitFor(`document.querySelector("${DLG} select")`);
    await app.sleep(300);
    await app.shot(`${OUT}/publish-${language}-light.png`);
    await app.click(`${DLG} [data-testid=publish-modrinth]`);
    await app.waitFor(`!document.querySelector("${DLG} select")`);
    assert(await submitText(app) === plain, "unticked: a plain export again");
  }, { project, language, width: 1440, height: 900 });
}
