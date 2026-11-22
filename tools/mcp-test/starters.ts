/**
 * Q252: the template gallery over MCP. list_starters lists the verified starters, create_from_starter adds one to the
 * project (elements and textures, a dry run writes nothing, a taken name is refused), create_project can start from one.
 *   node tools/mcp-test/starters.ts
 */
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../../src/ir/createProject.ts";
import { connect, assert } from "./client.ts";

const parent = mkdtempSync(join(tmpdir(), "mcedge-mcp-starters-"));
const dir = createProject({ parent, name: "Empty", modId: "empty_mod", package: "dev.t.empty", template: "empty" });
const mcp = await connect(dir);
try {
  assert(mcp.tools.includes("list_starters") && mcp.tools.includes("create_from_starter"), "the starter tools are listed");
  const starters = await mcp.call("list_starters");
  assert(Array.isArray(starters) && starters.length >= 2, `list_starters lists the verified starters (${starters.map((s: any) => s.id).join(", ")})`);
  const first = starters[0];
  assert(first.name && first.description && first.params.name && first.elements.length && first.verifiedOn.length >= 5, "a starter has its name, description, parameters, elements and the engines it was verified on");

  const dry = await mcp.call("create_from_starter", { id: first.id, params: { name: "topaz" }, dryRun: true });
  assert(dry.dryRun && !dry.applied && dry.changes.length === first.elements.length, "create_from_starter: a dry run reports and writes nothing");
  assert(!existsSync(join(dir, "textures")) || readdirSync(join(dir, "textures")).length === 0, "create_from_starter: a dry run leaves no texture behind");

  const added = await mcp.call("create_from_starter", { id: first.id, params: { name: "topaz" } });
  assert(added.applied && added.textures.length >= 1 && added.textures.every((t: string) => existsSync(join(dir, t))), `create_from_starter: applied (${added.textures.join(", ")})`);
  const again = await mcp.call("create_from_starter", { id: first.id, params: { name: "topaz" } }, true);
  assert(typeof again === "string" && again.includes("already has"), "create_from_starter: a taken name is refused");
  const bad = await mcp.call("create_from_starter", { id: first.id, params: { name: "Bad Name" } }, true);
  assert(typeof bad === "string" && bad.includes("lowercase"), "create_from_starter: a bad name word is refused");
  const unknown = await mcp.call("create_from_starter", { id: "nope", params: { name: "x" } }, true);
  assert(typeof unknown === "string" && unknown.includes("no starter"), "create_from_starter: an unknown starter is refused");

  const project = await mcp.call("create_project", { parent, name: "From Starter", modId: "from_starter", template: "empty", starter: { id: first.id, params: { name: "onyx" } } });
  assert(Object.values(project.elements).flat().some((id) => String(id).includes("onyx")), "create_project starts from a starter");
  console.log("PASS");
} finally {
  await mcp.close();
}
