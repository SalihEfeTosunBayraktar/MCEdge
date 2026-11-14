/**
 * KUYRUK #126: create_project makes a new project (File > New project): the empty template and the example starter
 * renamed to a new mod id and package, target engines, refusals for bad input. `--build`: the new example starter
 * builds on one engine (heavy: Gradle).
 *   node tools/mcp-test/create-project.ts [--build]
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const parent = mkdtempSync(join(tmpdir(), "mcedge-new-"));
const mcp = await connect(exampleProject());
try {
  assert(mcp.tools.includes("create_project"), "tool create_project");

  // ---- empty ----
  const empty = await mcp.call("create_project", { parent, name: "Gem Works", modId: "gemworks", package: "com.salih.gemworks", engines: ["neoforge-1.21.5", "fabric-1.21.5"] });
  assert(empty.dir === join(parent, "gemworks") && existsSync(join(empty.dir, "mcedge.json")), "empty project in <parent>/<mod id>");
  const p = loadProject(empty.dir);
  assert(p.mod.id === "gemworks" && p.mod.name === "Gem Works" && p.mod.package === "com.salih.gemworks" && Object.keys(p.elements).length === 0, "mod settings, no elements");
  assert(JSON.stringify(p.mod.engines) === JSON.stringify(["neoforge-1.21.5", "fabric-1.21.5"]), "target engines are saved");
  assert(validateProject(p, empty.dir).length === 0 && existsSync(join(empty.dir, "schemas", "project.schema.json")) && existsSync(join(empty.dir, ".gitignore")), "valid, with schemas and .gitignore");

  // ---- example starter ----
  const starter = await mcp.call("create_project", { parent, name: "Sapphire Mod", modId: "sapphire", template: "example", author: "Salih", folder: "Sapphire Mod" });
  const s = loadProject(starter.dir);
  assert(starter.dir === join(parent, "Sapphire Mod") && s.mod.id === "sapphire" && s.mod.package === "com.salih.sapphire", `starter renamed (${s.mod.id}, ${s.mod.package}), package suggested from the author`);
  assert(s.elements.item?.length === 2 && s.elements.block?.length === 1 && s.mod.dependencies.length === 0 && s.mod.engines === undefined, "the example's elements, no dependencies, all engines");
  const lang = readFileSync(join(starter.dir, "localization", "en_us.json"), "utf8");
  assert(!lang.includes("hellomcedge") && lang.includes("item.sapphire."), "lang keys use the new mod id");
  assert(!existsSync(join(starter.dir, "out")), "no build output copied");
  assert(validateProject(s, starter.dir).length === 0, `the starter is valid (${JSON.stringify(validateProject(s, starter.dir))})`);

  // ---- refusals ----
  const taken = await mcp.call("create_project", { parent, name: "Again", modId: "gemworks" }, true);
  assert(String(taken).includes("not empty"), "an existing non-empty folder is refused");
  for (const [args, what] of [[{ modId: "Bad-Id" }, "mod id"], [{ modId: "okid", package: "Com.Bad" }, "package"], [{ modId: "okid2", engines: ["nope-1.0"] }, "engine"], [{ modId: "okid3", parent: "relative/dir" }, "absolute"]] as const) {
    const answer = await mcp.call("create_project", { parent, name: "X", ...args }, true);
    assert(typeof answer === "string" && answer.includes(what), `refused: ${what}`);
  }

  if (process.argv.includes("--build")) {
    if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on");
    const other = await connect(starter.dir);
    try {
      const built = String(await other.call("build", { engine: "neoforge-1.21.5" }, true));
      assert(JSON.parse(built.slice(0, built.indexOf("\n\n"))).ok, `the new starter builds on neoforge-1.21.5${built.includes("\"ok\": true") ? "" : `\n${built.slice(0, 1500)}`}`);
    } finally {
      await other.close();
    }
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
