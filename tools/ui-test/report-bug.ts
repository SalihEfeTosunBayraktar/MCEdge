/**
 * Q208: Help > Report a bug fills a GitHub issue and opens the new-issue page of this repository with it. The test fills
 * the form, checks the preview masks the home folder, the user name and e-mail addresses, presses Send with
 * shell.openExternal replaced in the main process (nothing opens, nothing is sent) and checks the link: repository
 * prefix, title, bug label, version line, and for a very long report the URL limit and the full text on the clipboard.
 * Dark, light and Turkish; screenshots go to design/208/.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert } from "../mcp-test/client.ts";
import { exampleProject, launchApp, REPO, evidence } from "./cdp.ts";

const OUT = evidence("design/208");
mkdirSync(join(REPO, OUT), { recursive: true });
const project = exampleProject();
const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version as string;
const home = homedir();
const user = userInfo().username;
const PREFIX = "https://github.com/SalihEfeTosunBayraktar/MCEdge/issues/new?";
const electron = `(process.mainModule ? process.mainModule.require : require)("electron")`;

for (const language of ["en", "tr"] as const) {
  const s = language === "en" ? en : tr;
  const app = await launchApp({ project, language });
  try {
    await app.waitFor(`document.querySelector(".menubar")`, 15000);
    // The browser never opens: the main process records the links instead.
    await app.mainEval(`(() => { const e = ${electron}; globalThis.__opened = []; e.shell.openExternal = async (url) => void globalThis.__opened.push(url); })()`);
    const opened = () => app.mainEval<string[]>(`globalThis.__opened`);
    const open = async () => {
      await app.click(".menu", s["menu.help"]);
      await app.click(".menulist button", s["menu.reportBug"]);
      await app.waitFor(`document.querySelector('[data-testid="report-bug"]')`, 10000);
    };
    const preview = () => app.eval<string>(`document.querySelector('[data-testid="bug-preview"]').textContent`);

    await open();
    assert(await app.eval<string>(`document.querySelector(".bugdlg .ptitle").textContent`) === s["bug.title"], `${language}: Help > ${s["menu.reportBug"]} opens the dialog`);
    assert(await app.eval<boolean>(`document.querySelector('[data-testid="bug-send"]').disabled`), `${language}: Send waits for a title`);

    await app.setValue('[data-testid="bug-title"]', `Crash at ${user}@example.com`);
    await app.setValue('[data-testid="bug-happened"]', `It failed in ${home}\\mods\\x and in C:/Users/${user}/AppData, write to ${user}@example.com`);
    await app.setValue('[data-testid="bug-steps"]', "1. Open the example\n2. Build");
    await app.setValue('[data-testid="bug-expected"]', "A jar");
    await app.waitFor(`document.querySelector('[data-testid="bug-preview"]').textContent.includes("It failed")`);
    const text = await preview();
    assert(text.includes("It failed in ~\\mods\\x and in ~/AppData"), `${language}: the home folder is shown as ~ (${text.slice(0, 160)})`);
    assert(!text.toLowerCase().includes(user.toLowerCase()) && !text.includes(home), `${language}: the preview holds neither the user name nor the home path`);
    assert(text.includes("<email>") && !text.includes("example.com"), `${language}: e-mail addresses are masked`);
    assert(text.includes(`- MCEdge: ${version}`) && text.includes("- OS: ") && text.includes("- Electron: "), `${language}: the version, OS and Electron lines are attached`);
    assert(text.includes("- Engine: "), `${language}: the engine line is attached`);
    await app.click('[data-testid="bug-engine"]');
    assert(!(await preview()).includes("- Engine: "), `${language}: unchecking the engine drops its line from the preview`);
    await app.click('[data-testid="bug-engine"]');
    assert(await app.eval<boolean>(`document.querySelector('[data-testid="bug-build"]').disabled`), `${language}: no build output yet, so that box is off`);

    await app.shot(`${OUT}/report-${language}-dark.png`);
    if (language === "en") {
      await app.key("Escape");
      await app.waitFor(`!document.querySelector(".bugdlg")`);
      await app.setTheme("light");
      await open();
      await app.setValue('[data-testid="bug-title"]', "Crash on build");
      await app.setValue('[data-testid="bug-happened"]', "The build stops after the generator step.");
      await app.shot(`${OUT}/report-${language}-light.png`);
      await app.key("Escape");
      await app.waitFor(`!document.querySelector(".bugdlg")`);
      await app.setTheme("dark");
      await open();
      await app.setValue('[data-testid="bug-title"]', `Crash at ${user}@example.com`);
      await app.setValue('[data-testid="bug-happened"]', `It failed in ${home}\\mods\\x and in C:/Users/${user}/AppData, write to ${user}@example.com`);
      await app.setValue('[data-testid="bug-steps"]', "1. Open the example\n2. Build");
      await app.setValue('[data-testid="bug-expected"]', "A jar");
    }

    await app.click('[data-testid="bug-send"]');
    await app.waitFor(`!document.querySelector(".bugdlg")`);
    const links = await opened();
    assert(links.length === 1, `${language}: Send opens one link (${links.length})`);
    const url = new URL(links[0]);
    assert(links[0].startsWith(PREFIX), `${language}: the link is this repository's new-issue page`);
    assert(url.searchParams.get("title") === "Crash at <email>", `${language}: title ${url.searchParams.get("title")}`);
    assert(url.searchParams.get("labels") === "bug", `${language}: bug label`);
    const body = url.searchParams.get("body") ?? "";
    assert(body.includes(`- MCEdge: ${version}`) && body.includes("### What happened") && body.includes("It failed in ~\\mods\\x"), `${language}: the body carries the sections and the version line`);
    assert(!body.toLowerCase().includes(user.toLowerCase()) && !body.includes(home), `${language}: the sent body is masked too`);

    // A report longer than a link can hold is cut at the end and copied whole to the clipboard.
    await open();
    const long = Array.from({ length: 400 }, (_, i) => `line ${i} of a long description`).join("\n") + "\nTHE-END";
    await app.setValue('[data-testid="bug-title"]', "Long report");
    await app.setValue('[data-testid="bug-happened"]', long);
    await app.waitFor(`document.querySelector('[data-testid="bug-trimmed"]')`);
    assert((await app.eval<string>(`document.querySelector('[data-testid="bug-trimmed"]').textContent`)) === s["bug.trimmed"], `${language}: the preview says the report is cut`);
    await app.click('[data-testid="bug-send"]');
    await app.waitFor(`!document.querySelector(".bugdlg")`);
    const sent = (await opened())[1];
    assert(sent.length <= 7000 && sent.startsWith(PREFIX), `${language}: the long link stays under the limit (${sent.length})`);
    const sentBody = new URL(sent).searchParams.get("body") ?? "";
    assert(sentBody.includes("line 0 of") && !sentBody.includes("THE-END") && sentBody.includes("clipboard"), `${language}: the end is cut and a note asks for the paste`);
    const clip = await app.mainEval<string>(`${electron}.clipboard.readText()`);
    assert(clip.includes("THE-END") && clip.includes("### Environment"), `${language}: the full report is on the clipboard`);

    // The dialog also refuses nothing but this repository: the main process rejects any other link.
    const refused = await app.eval<boolean>(`window.mcedge.openIssue("https://example.com/").then(() => false, () => true)`);
    assert(refused, `${language}: another URL is refused by the main process`);
    assert((await opened()).length === 2, `${language}: the refused URL was not opened`);
  } finally {
    await app.close();
  }
}
console.log("report bug: all checks passed");
