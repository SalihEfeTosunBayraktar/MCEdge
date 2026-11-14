/**
 * KUYRUK #145 part 1-2: whole-job MCP tools on a copy of the example project: project_summary, find_elements,
 * batch_elements (atomic, problem gate, dry run), clone_elements (references inside the set rewired) and templates.
 *   node tools/mcp-test/agent-tools.ts
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const mcp = await connect(project);
const exists = (folder: string, id: string) => existsSync(join(project, "elements", folder, `${id}.json`));
try {
  // ---- project_summary ----
  await mcp.call("write_procedure", { id: "big_one", program: { format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [{ block: "start" }, { block: "return_void" }] }] } }, true);
  const summary = await mcp.call("project_summary");
  assert(summary.elements.byType.item === 2 && summary.elements.total >= 7, `project_summary counts (${JSON.stringify(summary.elements)})`);
  assert(summary.engines.length === 5 && summary.engines.every((e: any) => typeof e.counts.ignoredFields === "number"), "project_summary has gaps for all 5 engines");
  assert(typeof summary.problems.total === "number" && Array.isArray(summary.biggestProcedures), "project_summary problems and biggest procedures");
  const one = await mcp.call("project_summary", { engines: ["forge-1.16.5"] });
  assert(one.engines.length === 1 && one.engines[0].engine === "forge-1.16.5", "project_summary for one engine");

  // ---- find_elements ----
  const inTab = await mcp.call("find_elements", { where: [{ field: "creativeTabs", op: "contains", value: "ruby_tab" }] });
  assert(inTab.elements.some((e: any) => e.type === "item" && e.id === "ruby"), "find_elements: list contains");
  const stack = await mcp.call("find_elements", { type: "item", where: [{ field: "stackSize", op: "equals", value: 64 }, { field: "eatResultItem", op: "empty" }], select: ["name"] });
  assert(stack.elements.length === 1 && stack.elements[0].id === "ruby" && stack.elements[0].values.name === "Ruby", `find_elements: equals and empty, select (${stack.total})`);
  const regex = await mcp.call("find_elements", { where: [{ field: "smeltingInputStack", op: "matches", value: "^ruby_" }] });
  assert(regex.total === 1 && regex.elements[0].id === "ruby_from_smelting", "find_elements: matches");
  const none = await mcp.call("find_elements", { type: "item", where: [{ field: "name", op: "not_equals", value: "Ruby" }, { field: "texture", op: "not_empty" }] });
  assert(none.elements.length === 1 && none.elements[0].id === "ruby_apple", "find_elements: not_equals and not_empty");

  // ---- batch_elements ----
  const failed = await mcp.call("batch_elements", { ops: [{ op: "create", type: "item", id: "gem_a" }, { op: "update", type: "item", id: "no_such", values: {} }] }, true);
  assert(!failed.applied && failed.errors[0].index === 1 && !exists("items", "gem_a"), "batch_elements: a failing op writes nothing");
  const badRef = [{ op: "create", type: "item", id: "gem_b", values: { name: "Gem B" } }, { op: "create", type: "recipe", id: "gem_b_smelt", values: { recipeType: "Smelting", smeltingInputStack: "no_such_item", smeltingReturnStack: "gem_b" } }];
  const gated = await mcp.call("batch_elements", { ops: badRef }, true);
  assert(!gated.applied && gated.newProblems.length > 0 && !exists("items", "gem_b"), `batch_elements: new problems stop the batch (${gated.newProblems.map((p: any) => p.message).join("; ")})`);
  const dry = await mcp.call("batch_elements", { ops: badRef, dryRun: true });
  assert(!dry.applied && dry.dryRun && !exists("items", "gem_b"), "batch_elements: dry run");
  const forced = await mcp.call("batch_elements", { ops: badRef, allowProblems: true });
  assert(forced.applied && exists("items", "gem_b") && exists("recipes", "gem_b_smelt"), "batch_elements: allowProblems writes");
  const fix = await mcp.call("batch_elements", { ops: [{ op: "delete", type: "recipe", id: "gem_b_smelt" }, { op: "update", type: "item", id: "gem_b", values: { stackSize: 16 } }] });
  assert(fix.applied && fix.fixedProblems > 0 && !exists("recipes", "gem_b_smelt"), "batch_elements: delete and update, problems fixed counted");
  assert((await mcp.call("read_element", { type: "item", id: "gem_b" })).stackSize === 16, "batch_elements: update kept");

  // ---- clone_elements ----
  const clone = await mcp.call("clone_elements", {
    elements: [{ type: "block", id: "ruby_block", newId: "sapphire_block" }, { type: "recipe", id: "ruby_from_smelting", newId: "sapphire_from_smelting", values: { xpReward: 1 } }],
    replace: [{ from: "Ruby", to: "Sapphire" }],
  });
  assert(clone.applied, `clone_elements applied (${JSON.stringify(clone.newProblems)})`);
  const recipe = await mcp.call("read_element", { type: "recipe", id: "sapphire_from_smelting" });
  assert(recipe.smeltingInputStack === "sapphire_block", "clone_elements: reference inside the set points at the copy");
  assert(recipe.smeltingReturnStack === "ruby", "clone_elements: reference outside the set stays");
  assert(recipe.xpReward === 1 && recipe.title === "Sapphire from Smelting", "clone_elements: values and text replacement");
  const block = await mcp.call("read_element", { type: "block", id: "sapphire_block" });
  const source = await mcp.call("read_element", { type: "block", id: "ruby_block" });
  assert(block.name === source.name.replace("Ruby", "Sapphire") && block.texture === source.texture, "clone_elements: name replaced, texture shared");
  const taken = await mcp.call("clone_elements", { elements: [{ type: "item", id: "ruby", newId: "ruby_apple" }] }, true);
  assert(!taken.applied && taken.errors.length === 1, "clone_elements: a taken id writes nothing");

  // ---- templates ----
  const saved = await mcp.call("save_template", { name: "gem_set", description: "A gem, its block and smelting", params: { name: "ruby" }, elements: [{ type: "item", id: "ruby" }, { type: "block", id: "ruby_block" }, { type: "recipe", id: "ruby_from_smelting" }] });
  assert(saved.elements.join() === "item/{{name}},block/{{name}}_block,recipe/{{name}}_from_smelting", `save_template placeholders (${saved.elements.join()})`);
  const listed = await mcp.call("list_templates");
  assert(listed.length === 1 && listed[0].params.name === "ruby", "list_templates");
  const blocked = await mcp.call("create_from_template", { name: "gem_set", params: { name: "topaz" } }, true);
  assert(!blocked.applied && blocked.newProblems.some((p: any) => /topaz/.test(p.message) || /texture/i.test(p.message)), "create_from_template: missing textures are new problems");
  const made = await mcp.call("create_from_template", { name: "gem_set", params: { name: "topaz" }, allowProblems: true });
  assert(made.applied && made.changes.length === 3, "create_from_template applied");
  const topaz = await mcp.call("read_element", { type: "item", id: "topaz" });
  const topazRecipe = await mcp.call("read_element", { type: "recipe", id: "topaz_from_smelting" });
  assert(topaz.name === "Topaz" && topaz.texture === "textures/topaz.png", "create_from_template: name and texture filled");
  assert(topazRecipe.smeltingInputStack === "topaz_block" && topazRecipe.smeltingReturnStack === "topaz", "create_from_template: references between template elements");
  const missing = await mcp.call("create_from_template", { name: "gem_set", params: {} }, true);
  assert(typeof missing === "string" && missing.includes("missing parameters"), "create_from_template: missing parameter refused");
  assert(mcp.tools.includes("batch_elements") && mcp.tools.includes("find_elements"), "tools listed");
  console.log("PASS");
} finally {
  await mcp.close();
}
