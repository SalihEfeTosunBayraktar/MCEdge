/**
 * KUYRUK 135, one check per item on a copy of examples/hello:
 *   data lists   Tools > Minecraft data lists...: kinds, search, copy an id; MCP minecraft_ids.
 *   common tags  Tags > Common tags...: forge:storage_blocks suggests ruby_block; added to tags.json and generated as
 *                c:storage_blocks (1.21.5) and forge:storage_blocks (1.16.5); MCP list_common_tags.
 *   Gradle       Build & run > Run Gradle task... runs "help" in the Gradle console; Build, then Cancel task stops it;
 *                Clear Gradle caches removes out/<engine>/build and .gradle; MCP clear_gradle_caches.
 *   ZIP import   File > Import project from ZIP...: an exported workspace opens from its new folder; importing it again
 *                into the same folder is refused; MCP import_workspace_zip.
 * Screenshots go to design/135/ (LIGHT=1 runs it in the light theme). GRADLE=0 skips the Gradle part.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportWorkspace } from "../../src/resources/files.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, REPO, run, type App } from "./cdp.ts";

const OUT = "design/135";
const theme = process.env.LIGHT ? "light" : "dark";
const project = exampleProject();
const menu = async (app: App, name: string, item: string) => (await app.click(".menu", name), await app.click(".menulist button", item));
const log = (app: App) => app.eval<string>(`document.querySelector(".bottompanel pre.log, pre.log")?.textContent ?? ""`);

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  if (theme === "light") await app.setTheme("light");
  const mcp = await connect(project);
  try {
    // ---- data lists
    await menu(app, "Tools", "Minecraft data lists...");
    await app.waitFor(`document.querySelector("[data-testid=data-lists]")`);
    await app.setValue("[data-testid=data-lists] select", "particle");
    await app.setValue("[data-testid=data-lists] input", "flame");
    await app.waitFor(`document.querySelectorAll(".datalist-ids li code").length >= 1`);
    const ids = await app.eval<string[]>(`[...document.querySelectorAll(".datalist-ids li code")].map((c) => c.textContent)`);
    assert(ids.length && ids.every((id) => id.includes("flame")), `particle search ${ids}`);
    await app.click(".datalist-ids .mbtn");
    await app.waitFor(`document.querySelector(".datalist-ids .mbtn")?.textContent === "Copied"`);
    await app.shot(`${OUT}/after-data-lists-${theme}.png`);
    await app.key("Escape");
    const kinds = await mcp.call<Record<string, number>>("minecraft_ids", {});
    assert(kinds.item > 0 && (await mcp.call<string[]>("minecraft_ids", { kind: "particle", query: "flame" })).length === ids.length, "mcp minecraft_ids");

    // ---- common tags
    await menu(app, "Workspace", "Element tags");
    await app.waitFor(`[...document.querySelectorAll(".abtn")].some((b) => b.textContent === "Common tags...")`);
    await app.click(".abtn", "Common tags...");
    await app.waitFor(`document.querySelector("[data-testid=common-tags]")`);
    await app.setValue("[data-testid=common-tags] input", "storage");
    await app.click(".commontag-list button", "#forge:storage_blocks");
    await app.waitFor(`[...document.querySelectorAll("[data-testid=common-tags] .check code")].some((c) => c.textContent === "ruby_block")`);
    await app.shot(`${OUT}/after-common-tags-${theme}.png`);
    await app.click("[data-testid=common-tags] .abtn.primary");
    const tagsFile = () => (existsSync(join(project, "tags.json")) ? readFileSync(join(project, "tags.json"), "utf8") : "");
    for (let i = 0; i < 50 && !tagsFile().includes("forge:storage_blocks"); i++) await app.sleep(200);
    const saved = JSON.parse(tagsFile()).tags as { type: string; id: string; entries: string[] }[];
    assert(saved.some((x) => x.type === "block" && x.id === "forge:storage_blocks" && x.entries.join() === "ruby_block"), `tags.json ${tagsFile()}`);
    const offered = await mcp.call<{ id: string; type: string; suggested: string[] }[]>("list_common_tags");
    assert(offered.find((x) => x.id === "forge:storage_blocks" && x.type === "block")?.suggested.join() === "ruby_block", "mcp list_common_tags");
    for (const [engine, path] of [["neoforge-1.21.5", "data/c/tags/block/storage_blocks.json"], ["forge-1.16.5", "data/forge/tags/blocks/storage_blocks.json"]]) {
      const gen = spawnSync("node", ["src/cli.ts", "build", project, "--target", engine, "--no-gradle"], { cwd: REPO, encoding: "utf8" });
      const file = join(project, "out", engine, "src/main/resources", path);
      assert(gen.status === 0 && existsSync(file) && readFileSync(file, "utf8").includes("hellomcedge:ruby_block"), `${engine}: ${path}`);
    }

    // ---- Gradle utilities
    if (process.env.GRADLE !== "0") {
      await menu(app, "Build & run", "Run Gradle task...");
      await app.waitFor(`document.querySelector("[data-testid=gradle-task]")`);
      await app.type("help");
      await app.shot(`${OUT}/after-gradle-task-${theme}.png`);
      await app.key("Enter");
      await app.waitFor(`(document.querySelector("pre.log")?.textContent ?? "").includes("[mcedge] gradle help")`, 30000);
      await app.waitFor(`/BUILD SUCCESSFUL|BUILD FAILED/.test(document.querySelector("pre.log")?.textContent ?? "")`, 300000);
      assert((await log(app)).includes("BUILD SUCCESSFUL"), "gradle help ran");

      await app.key("b", 2);
      await app.waitFor(`/Gradle|gradle/.test([...document.querySelectorAll("pre.log")].map((p) => p.textContent).join(""))`, 120000);
      await app.sleep(4000);
      const cancelEnabled = async () => {
        await app.click(".menu", "Build & run");
        const on = await app.eval<boolean>(`!([...document.querySelectorAll(".menulist button")].find((b) => b.textContent.includes("Cancel task"))?.disabled ?? true)`);
        await app.key("Escape");
        return on;
      };
      assert(await cancelEnabled(), "Cancel task is offered while the build runs");
      await menu(app, "Build & run", "Cancel task");
      let stopped = false;
      for (let i = 0; i < 60 && !stopped; i++) (await app.sleep(1000), (stopped = !(await cancelEnabled())));
      assert(stopped, "the build stopped after Cancel task");
      assert(/Cancelled/.test(await app.eval<string>(`document.body.textContent`)), "the build reads Cancelled");

      await menu(app, "Build & run", "Clear Gradle caches");
      await app.waitFor(`document.querySelector(".dialog")?.textContent.includes("Clear Gradle caches")`, 10000);
      await app.shot(`${OUT}/after-clear-caches-${theme}.png`);
      const notice = await app.eval<string>(`document.querySelector(".dialog").textContent`);
      assert(/out\/[a-z0-9.-]+\/(build|\.gradle)/.test(notice), `caches cleared: ${notice}`);
      assert(!existsSync(join(project, "out", "fabric-1.21.5", ".gradle")) && !existsSync(join(project, "out", "fabric-1.21.5", "build")), "folders removed");
      await app.key("Escape");
      assert(Array.isArray((await mcp.call<{ removed: string[] }>("clear_gradle_caches")).removed), "mcp clear_gradle_caches");
    }

    // ---- ZIP import
    const zipDir = mkdtempSync(join(tmpdir(), "mcedge-zip-"));
    const zip = join(zipDir, "hello-workspace.zip");
    exportWorkspace(project, zip);
    const parent = join(zipDir, "imported");
    await menu(app, "File", "Import project from ZIP...");
    await app.waitFor(`document.querySelector("[data-testid=import-zip]")`);
    await app.setValue("[data-testid=import-zip] input[name=zip]", zip);
    await app.setValue("[data-testid=import-zip] input[name=parent]", parent);
    await app.shot(`${OUT}/after-import-zip-${theme}.png`);
    await app.click("[data-testid=import-zip] .abtn.primary");
    await app.waitFor(`!document.querySelector("[data-testid=import-zip]")`, 20000);
    assert(existsSync(join(parent, "hellomcedge", "mcedge.json")) && existsSync(join(parent, "hellomcedge", "elements", "items", "ruby.json")), "imported into parent/hellomcedge");
    await app.waitFor(`document.querySelector(".tile")`);
    await menu(app, "File", "Import project from ZIP...");
    await app.setValue("[data-testid=import-zip] input[name=zip]", zip);
    await app.setValue("[data-testid=import-zip] input[name=parent]", parent);
    await app.click("[data-testid=import-zip] .abtn.primary");
    await app.waitFor(`document.querySelector("[data-testid=import-zip-error]")?.textContent.includes("already exists")`);
    await app.key("Escape");
    const viaMcp = await mcp.call<{ dir: string }>("import_workspace_zip", { zip, parent: join(zipDir, "mcp") });
    assert(existsSync(join(viaMcp.dir, "mcedge.json")), "mcp import_workspace_zip");
  } finally {
    await mcp.close();
  }
}, { project });
