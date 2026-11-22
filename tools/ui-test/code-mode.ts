/**
 * KUYRUK #8: opens a copy of ETREconomy-Legacy (a plain Forge 1.16.5 Gradle mod) in code project mode:
 * file tree, Monaco, save, live reload of an MCP edit (the real MCP server), the unsaved-edits conflict, new and
 * deleted files. `--build` also builds, exports the jar and starts/stops the client (heavy).
 * Screenshots go to design/code-mode/.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, run, type App, evidence } from "./cdp.ts";

const project = copyProject("C:\\MyProjects\\AI-Assisted\\ETREconomy-Legacy", "ETREconomy-Legacy");
const OUT = evidence("design/code-mode");
const FILE = "src/main/java/etreco/EtrecoMod.java";
const heavy = process.argv.includes("--build");

const editorText = (app: App) => app.eval<string>(`document.querySelector(".monaco-editor .view-lines")?.innerText.replace(/\u00a0/g, " ") ?? ""`);
const tab = (app: App, name: string) => app.eval<string>(`[...document.querySelectorAll(".ctab")].find((t) => t.textContent.includes(${JSON.stringify(name)}))?.className ?? ""`);
const log = (app: App) => app.eval<string>(`document.querySelector(".bottom-panel pre.log")?.textContent ?? ""`);
const waitLog = async (app: App, pattern: RegExp, minutes: number) => {
  const end = Date.now() + minutes * 60_000;
  while (Date.now() < end) {
    const text = await log(app);
    if (pattern.test(text)) return;
    if (/BU.{1,2}LD FAILED/.test(text)) throw new Error(`gradle failed:\n${text.slice(-3000)}`);
    await app.sleep(1000);
  }
  throw new Error(`timeout waiting for ${pattern}`);
};

await run(async (app) => {
  await app.waitFor(`document.querySelectorAll(".codetree .trow").length > 5`, 20000);
  assert(await app.eval<number>(`document.querySelectorAll(".rail .rtab").length`) === 2, "code mode rail has Files and Version control");
  // src/main/java is expanded by default; open the etreco package, then the main class.
  await app.click(".codetree .trow", "etreco");
  await app.click(".codetree .trow", "EtrecoMod.java");
  await app.waitFor(`document.querySelector(".monaco-editor .view-lines")?.innerText.replace(/\u00a0/g, " ").includes("package etreco")`, 15000);
  assert((await tab(app, "EtrecoMod.java")).includes("on"), "file opened in a tab");
  await app.waitFor(`new Set([...document.querySelectorAll(".view-lines span span")].map((s) => s.className)).size > 3`, 10000);
  await app.shot(`${OUT}/editor-dark.png`);

  // Type and save with Ctrl+S.
  await app.click(".monaco-editor .view-lines");
  await app.key("Home", 2);
  await app.type("// edited in MCEdge\n");
  assert(await app.eval<boolean>(`!!document.querySelector(".ctab.on .cdirty")`), "typing marks the tab unsaved");
  await app.key("s", 2);
  await app.waitFor(`!document.querySelector(".ctab.on .cdirty")`, 5000);
  assert(readFileSync(join(project, FILE), "utf8").startsWith("// edited in MCEdge"), "Ctrl+S writes the file");

  // An AI agent edits the same file over MCP: the open editor reloads in place.
  const mcp = await connect(project);
  try {
    await mcp.call("edit_file", { path: FILE, oldText: "// edited in MCEdge", newText: "// edited in MCEdge, then by the agent" });
    await app.waitFor(`document.querySelector(".monaco-editor .view-lines").innerText.replace(/\u00a0/g, " ").includes("then by the agent")`, 10000);
    assert((await tab(app, "EtrecoMod.java")).includes("on") && (await editorText(app)).includes("then by the agent"), "MCP edit shows live");
    assert(await app.eval<boolean>(`!!document.querySelector(".ctab.on .creload")`), "tab shows it was updated");
    await app.shot(`${OUT}/live-reload-dark.png`);

    // Unsaved edits + outside change: kept, with Reload from disk offered.
    await app.click(".monaco-editor .view-lines");
    await app.type("int x;");
    await mcp.call("edit_file", { path: FILE, oldText: "then by the agent", newText: "then by the agent twice" });
    await app.waitFor(`document.querySelector(".ctab.on.conflict")`, 10000);
    assert((await editorText(app)).includes("int x;"), "unsaved edits are kept on conflict");
    await app.shot(`${OUT}/conflict-dark.png`);
    await app.click(".abtn", "Reload from disk");
    await app.waitFor(`!document.querySelector(".ctab.on.conflict") && !document.querySelector(".ctab.on .cdirty")`);
    await app.click(".monaco-editor .view-lines");
    await app.key("Home", 2);
    await app.waitFor(`document.querySelector(".monaco-editor .view-lines").innerText.replace(/\u00a0/g, " ").includes("twice")`);
    assert(!(await editorText(app)).includes("int x;"), "Reload from disk takes the disk version");

    // A file the agent creates appears in the tree.
    await mcp.call("write_file", { path: "src/main/java/etreco/AgentNote.java", content: "package etreco;\n\nclass AgentNote {}\n" });
    await app.waitFor(`[...document.querySelectorAll(".codetree .trow")].some((r) => r.textContent.includes("AgentNote.java"))`, 10000);
  } finally {
    await mcp.close();
  }

  // New file and delete from the toolbar.
  await app.click(".codetree .trow", "etreco");
  await app.click(".codetree .trow", "etreco");
  await app.click(".abtn", "New file");
  await app.click(".dialog input");
  await app.type("Notes.md");
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`[...document.querySelectorAll(".ctab")].some((t) => t.textContent.includes("Notes.md"))`);
  assert(existsSync(join(project, "src/main/java/etreco/Notes.md")), "New file creates it in the selected folder");
  await app.click(".codetree .trow", "Notes.md");
  await app.click(".abtn", "Delete");
  await app.click(".dialog .abtn.primary");
  await app.waitFor(`![...document.querySelectorAll(".codetree .trow")].some((r) => r.textContent.includes("Notes.md"))`);
  assert(!existsSync(join(project, "src/main/java/etreco/Notes.md")), "Delete removes it");

  // Version control in code mode; the editor and its tabs survive the switch.
  await app.click(".rtab", "Version control");
  await app.waitFor(`[...document.querySelectorAll(".abtn")].some((b) => b.textContent.includes("Initialize repository"))`);
  await app.click(".rtab", "Files");
  await app.waitFor(`[...document.querySelectorAll(".ctab")].some((t) => t.textContent.includes("EtrecoMod.java"))`);

  await app.click(".codetree .trow", "EtrecoMod.java");
  await app.setTheme("light");
  await app.shot(`${OUT}/editor-light.png`);
  await app.setTheme("dark");

  if (heavy) {
    await app.click(".abtn", "Build");
    await waitLog(app, /BU.{1,2}LD SUCCESSFUL/, 25);
    await app.shot(`${OUT}/build-dark.png`);
    const target = join(project, "..", "exported.jar");
    await app.mockDialogs({ save: target });
    await app.click(".abtn", "Export jar");
    await app.waitFor(`document.querySelector(".dialog")`, 25 * 60_000);
    assert(existsSync(target), "Export jar copies the jar");
    await app.click(".dialog .abtn", "Close");
    await app.click(".abtn", "Run client");
    await waitLog(app, /Setting user:|LWJGL|Loading Minecraft|ModLauncher running/, 25);
    await app.shot(`${OUT}/run-client-dark.png`);
    await app.click(".abtn", "Stop client");
    await app.waitFor(`!document.querySelector(".led.running, .led.waiting")`, 60_000);
  }
}, { project, kind: "code" });
