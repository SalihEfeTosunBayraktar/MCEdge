/**
 * Q220: delete_element lists what only the element used and deletes it on request. On copies of examples/hello with the
 * item "gem" (see cascade-fixture.ts): a dry run lists its exclusive procedures, GUI, recipe, texture, model, translation keys and
 * folder entries and not what the ruby item shares; a plain delete changes only the element and says what is left; an
 * explicit cascade deletes just the named things and refuses others; "all" deletes everything listed, keeps the shared
 * things and cleans folders.json and texture-folders.json.
 *   node tools/mcp-test/delete-cascade.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";
import { buildCascadeFixture } from "./cascade-fixture.ts";

const json = (project: string, file: string) => JSON.parse(readFileSync(join(project, file), "utf8"));
const ids = (rows: { type: string; id: string }[]) => rows.map((r) => `${r.type}/${r.id}`).sort();
const EXCLUSIVE = ["gui/gem_menu", "procedure/gem_helper", "procedure/gem_use", "recipe/gem_recipe"];

// Dry run, then a plain delete, on the first copy.
let project = exampleProject();
buildCascadeFixture(project);
let mcp = await connect(project);
try {
  const dry = await mcp.call("delete_element", { type: "item", id: "gem", dryRun: true });
  assert(JSON.stringify(ids(dry.exclusive.elements)) === JSON.stringify(EXCLUSIVE), `exclusive elements: ${JSON.stringify(dry.exclusive.elements)}`);
  assert(!ids(dry.exclusive.elements).includes("procedure/shared_fx"), "the procedure ruby also calls is not listed");
  assert(JSON.stringify(dry.exclusive.textures) === JSON.stringify([{ path: "textures/gem.png", folder: "Art" }]), `textures: ${JSON.stringify(dry.exclusive.textures)} (textures/ruby.png is shared)`);
  assert(JSON.stringify(dry.exclusive.models) === JSON.stringify([{ path: "models/gem_model.json", folder: "Art" }]), `models: ${JSON.stringify(dry.exclusive.models)}`);
  const keys = dry.exclusive.langKeys.map((k: { key: string }) => k.key);
  assert(JSON.stringify(keys) === JSON.stringify(["gem.msg", "gui.hellomcedge.gem_menu", "item.hellomcedge.gem"]), `translation keys: ${keys} (shared.msg is used by shared_fx)`);
  assert(dry.exclusive.langKeys.find((k: { key: string }) => k.key === "gem.msg").languages.join() === "en_us,tr_tr", "languages with text are listed");
  assert(dry.exclusive.elements.find((e: { id: string }) => e.id === "gem_use").folder === "Gems", "element folder is shown");
  assert(existsSync(join(project, "elements/items/gem.json")) && existsSync(join(project, "textures/gem.png")), "a dry run deletes nothing");

  // Plain delete: the element only; the rest is reported, and its own folder entry goes.
  const plain = await mcp.call("delete_element", { type: "item", id: "gem" });
  assert(plain.deleted.join() === "item/gem" && plain.exclusiveLeft.elements.length === 4, `plain delete: ${JSON.stringify(plain)}`);
  assert(!existsSync(join(project, "elements/items/gem.json")) && existsSync(join(project, "elements/procedures/gem_use.json")) && existsSync(join(project, "textures/gem.png")), "only the element file went");
  assert(!("item/gem" in json(project, "folders.json").placement) && json(project, "folders.json").placement["procedure/gem_use"] === "Gems", "its folder entry went, the others stay");
  assert("gem.msg" in json(project, "localization/en_us.json"), "translation keys stay");
} finally {
  await mcp.close();
}

// Explicit cascade, on a second copy.
project = exampleProject();
buildCascadeFixture(project);
mcp = await connect(project);
try {
  const refused = await mcp.call("delete_element", { type: "item", id: "gem", cascade: { elements: ["procedure/shared_fx"] } }, true);
  assert(String(refused).includes("not something only item/gem uses") && existsSync(join(project, "elements/items/gem.json")), `a shared procedure is refused and nothing is deleted: ${refused}`);
  const some = await mcp.call("delete_element", { type: "item", id: "gem", cascade: { elements: ["procedure/gem_use", "procedure/gem_helper"], langKeys: ["gem.msg"] } });
  assert(some.deleted.join() === "item/gem,procedure/gem_use,procedure/gem_helper", `deleted: ${some.deleted}`);
  assert(existsSync(join(project, "elements/guis/gem_menu.json")) && existsSync(join(project, "textures/gem.png")), "the GUI and the texture were not named, so they stay");
  assert(JSON.stringify(ids(some.exclusiveLeft.elements)) === JSON.stringify(["gui/gem_menu", "recipe/gem_recipe"]), `left: ${JSON.stringify(some.exclusiveLeft)}`);
  assert(!("gem.msg" in json(project, "localization/en_us.json")) && !("gem.msg" in json(project, "localization/tr_tr.json")) && "item.hellomcedge.gem" in json(project, "localization/en_us.json"), "the named key went from every language, the others stay");
} finally {
  await mcp.close();
}

// "all", on a third copy.
project = exampleProject();
buildCascadeFixture(project);
mcp = await connect(project);
try {
  const all = await mcp.call("delete_element", { type: "item", id: "gem", cascade: "all" });
  assert(JSON.stringify([...all.deleted].sort()) === JSON.stringify(["item/gem", ...EXCLUSIVE].sort()), `deleted: ${all.deleted}`);
  assert(all.textures.join() === "textures/gem.png" && !all.exclusiveLeft, `textures ${all.textures}, nothing left`);
  for (const gone of ["elements/items/gem.json", "elements/procedures/gem_use.json", "elements/procedures/gem_helper.json", "elements/guis/gem_menu.json", "elements/recipes/gem_recipe.json", "textures/gem.png"]) assert(!existsSync(join(project, gone)), `${gone} is gone`);
  for (const kept of ["elements/procedures/shared_fx.json", "elements/items/ruby.json", "textures/ruby.png"]) assert(existsSync(join(project, kept)), `${kept} stays`);
  const en = json(project, "localization/en_us.json");
  assert(!("item.hellomcedge.gem" in en) && !("gui.hellomcedge.gem_menu" in en) && !("gem.msg" in en) && en["shared.msg"] === "Shared text" && en["old.removed_block"], "only the exclusive keys went from en_us");
  assert(JSON.stringify(json(project, "folders.json").placement) === JSON.stringify({ "item/ruby": "Gems" }), `folders.json: ${JSON.stringify(json(project, "folders.json"))}`);
  assert(JSON.stringify(json(project, "texture-folders.json").placement) === JSON.stringify({ "textures/ruby.png": "Art" }), `texture-folders.json: ${JSON.stringify(json(project, "texture-folders.json"))}`);
  assert(!existsSync(join(project, "models/gem_model.json")) && !("models/gem_model.json" in (json(project, "texture-folders.json").resources?.models?.placement ?? {})), "the model and its folder entry (resources.models) are gone");
  assert(all.folderEntries.length === 5, `folder entries: ${all.folderEntries}`);
  const problems = await mcp.call("validate_project");
  assert(!JSON.stringify(problems).includes("shared_fx") && !JSON.stringify(problems).includes("unknownProcedure"), "no broken reference is left");
  console.log("PASS");
} finally {
  await mcp.close();
}
