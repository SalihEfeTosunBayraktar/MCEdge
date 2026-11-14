/**
 * KUYRUK #32: rename an element from the element list, with the real ETREconomy project copied (854 elements): the
 * dialog previews what follows, a taken id is refused, the rename rewrites files, translations and folders, and the
 * project keeps its references and its problem count. MCP sees the same project. Screenshots go to design/rename/.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, copyProject, REPO, run } from "./cdp.ts";

const project = copyProject(resolve(REPO, "..", "ETREconomy-MCEdge"), "etr");
const OUT = "design/rename";
const json = <T>(path: string) => JSON.parse(readFileSync(join(project, path), "utf8")) as T;

const mcp = await connect(project);
const before = await mcp.call("find_references", { type: "block", id: "upgradedvending", limit: 500 });
const problemsBefore = (await mcp.call<unknown[]>("validate_project")).length;
const keysBefore = Object.keys(json<Record<string, string>>("localization/en_us.json")).filter((k) => k.endsWith(".etreco.upgradedvending"));
assert(before.usedBy.total > 5 && keysBefore.length > 0, `block has users (${before.usedBy.total}) and a translation key`);
const folder = json<{ placement: Record<string, string> }>("folders.json").placement["block/upgradedvending"];

try {
  await run(async (app) => {
    await app.click(".rtab", "Mod elements");
    await app.setValue(".findbar .search input", "upgradedvending");
    await app.waitFor(`document.querySelectorAll(".tile").length >= 1`);
    // The search matches the block and the elements named like it; take the block.
    await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.textContent.includes("Block") && t.textContent.includes("upgradedvending"))?.setAttribute("id", "target")`);
    await app.click("#target");
    await app.click("#target", undefined, { button: "right" }); // Rename lives in the right-click menu
    await app.click(".menulist.ctx button", "Rename");
    await app.waitFor(`document.querySelector(".dialog input")`);

    // A taken id is refused with its reason, and the button stays off.
    await app.setValue(".dialog input", "otomatacik");
    await app.waitFor(`document.querySelector("[data-testid=rename-error]")`, 10000);
    assert((await app.eval<string>(`document.querySelector("[data-testid=rename-error]").textContent`)).includes("already used"), "taken id refused");
    assert(await app.eval<boolean>(`document.querySelector(".dialog button[type=submit]").disabled`), "OK is off for a refused id");

    // A free id previews what follows.
    await app.setValue(".dialog input", "supervending");
    await app.waitFor(`document.querySelector("[data-testid=rename-preview]")`, 10000);
    const preview = await app.eval<string>(`document.querySelector("[data-testid=rename-preview]").textContent`);
    assert(preview.includes(String(before.usedBy.total - 0)) || /Changes \d+ places/.test(preview), `preview text: ${preview}`);
    await app.shot(`${OUT}/dialog.png`);
    await app.click(".dialog button[type=submit]");
    await app.waitFor(`!document.querySelector(".dialog")`, 15000);
    await app.waitFor(`[...document.querySelectorAll(".tile .tname")].length >= 1`);
    await app.shot(`${OUT}/after.png`);
  }, { project });

  // The files followed.
  assert(existsSync(join(project, "elements/blocks/supervending.json")) && !existsSync(join(project, "elements/blocks/upgradedvending.json")), "element file moved");
  const loc = json<Record<string, string>>("localization/en_us.json");
  assert(Object.keys(loc).some((k) => k.endsWith(".etreco.supervending")) && !Object.keys(loc).some((k) => k.endsWith(".etreco.upgradedvending")), "translation keys moved");
  assert(json<{ placement: Record<string, string> }>("folders.json").placement["block/supervending"] === folder, "folder kept");
  const after = await mcp.call("find_references", { type: "block", id: "supervending", limit: 500 });
  assert(after.usedBy.total === before.usedBy.total && after.uses.total === before.uses.total, `references kept: ${before.usedBy.total}/${before.uses.total} -> ${after.usedBy.total}/${after.uses.total}`);
  assert((await mcp.call<unknown[]>("validate_project")).length === problemsBefore, "problem count unchanged");
  assert((await mcp.call("find_references", { type: "block", id: "upgradedvending" }, true)).includes("no block"), "the old id is gone");
} finally {
  await mcp.close();
}
