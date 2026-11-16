/**
 * KUYRUK #16: an agent connected over MCP does what the app does. Runs every area of docs/MCP.md against a copy
 * of the example project: mod settings and dependencies, element types and schema, element CRUD with validation,
 * variables, localization, textures, GUI/overlay layouts, procedures, resources, coverage, logs and git (with a
 * local bare remote for push/pull). `--build` also exports a jar (heavy: Gradle).
 *   node tools/mcp-test/surface.ts [--build]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const sh = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const mcp = await connect(project);
try {
  // ---- mod settings and dependencies ----
  const mod = await mcp.call("get_mod");
  assert(mod.id === "hellomcedge", "get_mod");
  const updated = await mcp.call("update_mod", { version: "0.2.0", dependencies: [{ modId: "jei", version: ">=19.0.0", required: false, side: "client" }] });
  assert(updated.mod.version === "0.2.0" && updated.mod.dependencies[0].modId === "jei" && updated.mod.name === mod.name, "update_mod changes only given keys, sets dependencies");
  assert(JSON.parse(readFileSync(join(project, "mcedge.json"), "utf8")).mod.version === "0.2.0", "mod settings saved to mcedge.json");

  // ---- element types ----
  const types = await mcp.call("list_element_types");
  assert(types.length >= 37 && types.some((t: { id: string }) => t.id === "living_entity"), `list_element_types (${types.length})`);
  const schema = await mcp.call("element_type_schema", { type: "item" });
  assert(schema.pages.length > 0 && schema.jsonSchema, "element_type_schema returns pages and JSON schema");

  // ---- elements ----
  const created = await mcp.call("create_element", { type: "item", id: "sapphire", values: { name: "Sapphire", stackSize: 16 } });
  assert(created.element.stackSize === 16 && existsSync(join(project, "elements", "items", "sapphire.json")), "create_element writes the file with defaults + values");
  const bad = await mcp.call("update_element", { type: "item", id: "sapphire", values: { stackSize: 500 } });
  assert(bad.issues.some((i: { path: string }) => i.path === "stackSize"), "update_element reports validation problems");
  await mcp.call("update_element", { type: "item", id: "sapphire", values: { stackSize: 64 } });
  assert((await mcp.call("read_element", { type: "item", id: "sapphire" })).stackSize === 64, "read_element sees the update");
  const dup = await mcp.call("create_element", { type: "item", id: "sapphire" }, true);
  assert(String(dup).includes("already used"), "duplicate ids refused");
  assert((await mcp.call("list_elements", { type: "item" })).elements.some((e: { id: string }) => e.id === "sapphire"), "list_elements");
  assert(Array.isArray(await mcp.call("validate_project")), "validate_project");

  // ---- variables and localization ----
  await mcp.call("set_variables", { variables: [{ name: "mana", type: "number", scope: "player_persistent", initial: "20" }] });
  assert((await mcp.call("get_variables"))[0].name === "mana", "set_variables / get_variables");
  await mcp.call("set_translations", { language: "tr_tr", entries: { "item.hellomcedge.sapphire": "Safir" } });
  assert((await mcp.call("get_localization", { language: "tr_tr" }))["item.hellomcedge.sapphire"] === "Safir", "set_translations / get_localization");
  await mcp.call("set_translations", { language: "tr_tr", entries: { "item.hellomcedge.sapphire": null } });
  assert(!("item.hellomcedge.sapphire" in (await mcp.call("get_localization", { language: "tr_tr" }))), "null removes a translation");

  // ---- textures (texture editor) ----
  await mcp.call("create_texture", { path: "textures/item/sapphire.png", width: 16, height: 16, fill: "transparent" });
  await mcp.call("write_texture_pixels", {
    path: "textures/item/sapphire.png", rects: [{ x: 4, y: 4, width: 8, height: 8, color: "#2e5c8a" }],
    pixels: [{ x: 0, y: 0, color: "#ff000080" }], rows: { x: 0, y: 15, colors: [["#ffffff", "#000000"]] },
  });
  const tex = await mcp.call("read_texture", { path: "textures/item/sapphire.png", x: 0, y: 0, width: 6, height: 6 });
  assert(tex.rows[0].startsWith("#ff000080") && tex.rows[5].split(" ")[5] === "#2e5c8aff", "write_texture_pixels / read_texture");
  await mcp.call("resize_texture", { path: "textures/item/sapphire.png", width: 32, height: 32 });
  assert((await mcp.call("read_texture", { path: "textures/item/sapphire.png", x: 9, y: 9, width: 1, height: 1 })).rows[0] === "#2e5c8aff", "resize_texture doubles pixels");
  await mcp.call("update_element", { type: "item", id: "sapphire", values: { texture: "textures/item/sapphire.png" } });
  assert(String(await mcp.call("delete_texture", { path: "textures/item/sapphire.png" }, true)).includes("item/sapphire"), "delete_texture refuses a used texture");
  assert((await mcp.call("list_textures")).some((t: { path: string; width: number }) => t.path === "textures/item/sapphire.png" && t.width === 32), "list_textures");

  // ---- procedures, GUI layout ----
  await mcp.call("create_element", { type: "procedure", id: "on_craft" });
  assert((await mcp.call("read_procedure", { id: "on_craft" })) !== undefined, "read_procedure");
  // Q202: the server-wide player loop and the online player by name in the block catalog.
  const playerBlocks = (await mcp.call("procedure_blocks", { query: "player" })).blocks as { id: string; fields: { name: string; options?: string[]; default?: unknown }[]; engines: string[] }[];
  const loop = playerBlocks.find((b) => b.id === "for_each_player");
  const byName = playerBlocks.find((b) => b.id === "player_by_name");
  assert(loop?.fields.some((f) => f.name === "scope" && f.options?.join() === "dimension,server" && f.default === "dimension") && byName?.engines.length === 5,
    "procedure_blocks lists for_each_player's scope field and player_by_name on 5 engines");
  await mcp.call("create_element", { type: "gui", id: "forge_gui", values: { type: 1 } });
  await mcp.call("write_gui_layout", {
    type: "gui", id: "forge_gui", widgets: [
      { kind: "label", x: 8, y: 6, text: "Forge", color: "#404040" },
      { kind: "slot", x: 26, y: 26, id: 0 }, { kind: "slot", x: 116, y: 26, id: 1, output: true },
      { kind: "button", x: 60, y: 50, width: 50, height: 20, text: "Craft", procedure: "on_craft" },
      { kind: "image", x: 80, y: 26, image: "textures/item/sapphire.png", z: 2 },
    ],
  });
  const layout = await mcp.call("read_gui_layout", { type: "gui", id: "forge_gui" });
  assert(layout.widgets.length === 5 && layout.inventory.y === 83 && layout.width === 176, "write_gui_layout / read_gui_layout with inventory frame");
  assert(layout.widgets[4].z === 2, "a widget's z is written and read (KUYRUK 103)");
  const badZ = await mcp.call("write_gui_layout", { type: "gui", id: "forge_gui", widgets: [{ kind: "image", x: 0, y: 0, image: "textures/item/sapphire.png", z: 1.5 }] }, true);
  assert(String(badZ).toLowerCase().includes("int"), "z must be an integer");
  // KUYRUK 96: a toggle button with four textures and a state procedure.
  await mcp.call("create_element", { type: "procedure", id: "lamp_on", values: { returnType: "logic" } });
  const toggle = { kind: "toggle_button", x: 10, y: 10, width: 16, height: 16, image: "textures/item/sapphire.png", hoverImage: "textures/ruby.png",
    onImage: "textures/ruby.png", onHoverImage: "textures/item/sapphire.png", stateProcedure: "lamp_on", procedure: "on_craft" };
  await mcp.call("write_gui_layout", { type: "gui", id: "forge_gui", widgets: [toggle] });
  const toggled = (await mcp.call("read_gui_layout", { type: "gui", id: "forge_gui" })).widgets[0];
  assert(toggled.kind === "toggle_button" && toggled.onImage === toggle.onImage && toggled.stateProcedure === "lamp_on", "toggle_button written and read");
  assert(JSON.stringify(await mcp.call("find_references", { type: "procedure", id: "lamp_on" })).includes("stateProcedure"), "a toggle's state procedure is a reference");
  const badToggle = await mcp.call("write_gui_layout", { type: "gui", id: "forge_gui", widgets: [{ ...toggle, onImage: "textures/nope.png" }, { kind: "image", x: 0, y: 0, image: "textures/ruby.png", onImage: "textures/ruby.png" }] }, true);
  assert(String(badToggle).includes("onImage \"textures/nope.png\" not in the project") && String(badToggle).includes("for toggle_button only"), `toggle_button checks: ${badToggle}`);
  // KUYRUK 186: a state image, its states' conditions are references; checks on images, procedures and keys.
  const stateImage = { kind: "state_image", x: 30, y: 10, width: 16, height: 16, stateProcedure: "", updateTicks: 5, restartAnimation: true,
    states: [{ image: "textures/ruby.png", condition: "lamp_on" }, { image: "textures/item/sapphire.png", frame: 0 }] };
  await mcp.call("write_gui_layout", { type: "gui", id: "forge_gui", widgets: [stateImage] });
  const stated = (await mcp.call("read_gui_layout", { type: "gui", id: "forge_gui" })).widgets[0];
  assert(stated.kind === "state_image" && stated.states.length === 2 && stated.states[1].frame === 0 && stated.updateTicks === 5, "state_image written and read");
  assert(JSON.stringify(await mcp.call("find_references", { type: "procedure", id: "lamp_on" })).includes("states[0].condition"), "a state's condition is a reference");
  const badState = await mcp.call("write_gui_layout", { type: "gui", id: "forge_gui", widgets: [{ ...stateImage, states: [{ image: "textures/nope.png", condition: "nope" }] },
    { kind: "state_image", x: 0, y: 0 }, { kind: "image", x: 0, y: 0, image: "textures/ruby.png", updateTicks: 2 }] }, true);
  assert(String(badState).includes("state 0 image \"textures/nope.png\" not in the project") && String(badState).includes("state 0: no procedure \"nope\"")
    && String(badState).includes("1: a state_image needs states") && String(badState).includes("2: states, stateValue"), `state_image checks: ${badState}`);
  const dupSlot = await mcp.call("write_gui_layout", { type: "gui", id: "forge_gui", widgets: [{ kind: "slot", x: 0, y: 0, id: 0 }, { kind: "slot", x: 20, y: 0, id: 0 }] }, true);
  assert(String(dupSlot).includes("used twice"), "duplicate slot index refused");
  // Q203: a GUI's onSlotChanged procedure, given the slot id, is in the schema; update_element sets it.
  const guiSchema = await mcp.call("element_type_schema", { type: "gui" });
  const slotField = guiSchema.pages.flatMap((p: { groups: { fields: { key: string }[] }[] }) => p.groups.flatMap((g) => g.fields)).find((f: { key: string }) => f.key === "onSlotChanged");
  assert(slotField?.type === "procedure" && slotField.dependencies.includes("slot") && guiSchema.jsonSchema.properties.onSlotChanged, "element_type_schema gui lists onSlotChanged with the slot dependency");
  await mcp.call("update_element", { type: "gui", id: "forge_gui", values: { onSlotChanged: "on_craft" } });
  assert((await mcp.call("read_element", { type: "gui", id: "forge_gui" })).onSlotChanged === "on_craft", "update_element sets onSlotChanged");
  assert(JSON.stringify(await mcp.call("find_references", { type: "procedure", id: "on_craft" })).includes("onSlotChanged"), "onSlotChanged is a reference");
  await mcp.call("create_element", { type: "overlay", id: "hud" });
  const overlayButton = await mcp.call("write_gui_layout", { type: "overlay", id: "hud", widgets: [{ kind: "button", x: 0, y: 0 }] }, true);
  assert(String(overlayButton).includes("labels, images and state images only"), "overlays refuse buttons");
  // KUYRUK 170: anchors and scale modes, as the generated code places the widgets.
  await mcp.call("write_gui_layout", { type: "overlay", id: "hud", widgets: [
    { kind: "label", x: 4, y: 4, text: "Hi", anchor: "top_left" }, { kind: "image", x: 400, y: 220, width: 16, height: 16, image: "textures/item/sapphire.png", anchor: "bottom_right" },
    { kind: "label", x: 200, y: 100, text: "Mid" },
  ] });
  const hud = await mcp.call("overlay_layout", { id: "hud", screens: [{ width: 1920, height: 1080 }] });
  const at = (s: { widgets: { x: number; y: number }[] }) => s.widgets.map((w) => `${w.x},${w.y}`).join(" ");
  assert(hud.screens[0].guiScale === 4 && hud.screens[0].screen.width === 480 && at(hud.screens[0]) === "4,4 453,250 227,115", `overlay_layout anchors: ${JSON.stringify(hud.screens[0])}`);
  const badAnchor = await mcp.call("write_gui_layout", { type: "gui", id: "forge_gui", widgets: [{ kind: "label", x: 0, y: 0, text: "x", anchor: "top" }] }, true);
  assert(String(badAnchor).includes("overlay widgets only"), "anchor refused on a GUI");
  // KUYRUK 182: a label's background; not on other kinds.
  await mcp.call("write_gui_layout", { type: "overlay", id: "hud", widgets: [{ kind: "label", x: 4, y: 4, text: "Hi", background: "#000000", backgroundOpacity: 40, backgroundPadding: 2 }] });
  assert((await mcp.call("read_gui_layout", { type: "overlay", id: "hud" })).widgets[0].backgroundOpacity === 40, "write_gui_layout keeps a label background");
  const badBackground = await mcp.call("write_gui_layout", { type: "overlay", id: "hud", widgets: [{ kind: "image", x: 0, y: 0, image: "textures/item/sapphire.png", background: "#000000" }] }, true);
  assert(String(badBackground).includes("labels only"), "background refused on an image");
  // KUYRUK 183: a centred label stands around its point, also in overlay_layout.
  await mcp.call("create_element", { type: "overlay", id: "hud2" });
  await mcp.call("write_gui_layout", { type: "overlay", id: "hud2", widgets: [{ kind: "label", x: 200, y: 100, text: "Mid", align: "center" }] });
  const centred = (await mcp.call("overlay_layout", { id: "hud2", screens: [{ width: 1920, height: 1080 }] })).screens[0].widgets[0];
  assert(centred.x === 227 - 9 && centred.y === 115, `overlay_layout: a centred label's top left: ${JSON.stringify(centred)}`);
  const badAlign = await mcp.call("write_gui_layout", { type: "overlay", id: "hud2", widgets: [{ kind: "image", x: 0, y: 0, image: "textures/item/sapphire.png", align: "center" }] }, true);
  assert(String(badAlign).includes("align is for labels only"), "align refused on an image");
  await mcp.call("write_gui_layout", { type: "overlay", id: "hud", widgets: [
    { kind: "label", x: 4, y: 4, text: "Hi", anchor: "top_left" }, { kind: "image", x: 400, y: 220, width: 16, height: 16, image: "textures/item/sapphire.png", anchor: "bottom_right" },
    { kind: "label", x: 200, y: 100, text: "Mid" },
  ] });
  await mcp.call("update_element", { type: "overlay", id: "hud", values: { scaleMode: "fixed", fixedScale: 2 } });
  const fixed = (await mcp.call("overlay_layout", { id: "hud", screens: [{ width: 1920, height: 1080 }], guiScale: 3 })).screens[0];
  assert(fixed.guiScale === 3 && fixed.screen.width === 960 && fixed.pixels === 2 && at(fixed) === "4,4 933,520 467,250", `overlay_layout fixed GUI scale: ${JSON.stringify(fixed)}`);
  assert((await mcp.call("read_gui_layout", { type: "overlay", id: "hud" })).scaleMode === "fixed", "read_gui_layout gives the scale mode");

  // ---- creative tab order (KUYRUK 98) ----
  const tabNow = await mcp.call("read_tab_order", { tab: "ruby_tab" });
  const names = (o: { kind: string; id?: string; title?: string }[]) => o.map((e) => e.id ?? `[${e.kind}${e.title ? ` ${e.title}` : ""}]`).join(",");
  assert(names(tabNow.order).split(",").sort().join() === "ruby,ruby_apple,ruby_block,ruby_pickaxe", `read_tab_order lists the members: ${names(tabNow.order)}`);
  const written = await mcp.call("write_tab_order", { tab: "ruby_tab", order: [
    { kind: "element", type: "tool", id: "ruby_pickaxe" }, { kind: "section", title: "Food" }, { kind: "element", type: "item", id: "ruby_apple" }, { kind: "spacer", slots: 3 },
  ] });
  assert(names(written.order) === "ruby_pickaxe,[section Food],ruby_apple,[spacer],ruby_block,ruby" || names(written.order) === "ruby_pickaxe,[section Food],ruby_apple,[spacer],ruby,ruby_block", `write_tab_order keeps the order, appends the rest: ${names(written.order)}`);
  assert((await mcp.call("read_element", { type: "creative_tab", id: "ruby_tab" })).order[3].slots === 3, "the order is saved in the creative tab");
  // KUYRUK 172: a section end; one that closes no section is dropped.
  const ended = await mcp.call("write_tab_order", { tab: "ruby_tab", order: [
    { kind: "end" }, { kind: "section", title: "Food" }, { kind: "element", type: "item", id: "ruby_apple" }, { kind: "end" }, { kind: "end" }, { kind: "element", type: "tool", id: "ruby_pickaxe" },
  ] });
  assert(names(ended.order).startsWith("[section Food],ruby_apple,[end],ruby_pickaxe,"), `write_tab_order keeps a section end, drops ends closing nothing: ${names(ended.order)}`);
  const badOrder = await mcp.call("write_tab_order", { tab: "ruby_tab", order: [{ kind: "element", type: "item", id: "sapphire" }] }, true);
  assert(String(badOrder).includes("not in tab"), `an element outside the tab is refused: ${badOrder}`);
  assert(JSON.stringify(await mcp.call("find_references", { type: "item", id: "ruby_apple" })).includes("order["), "the tab order is a reference of its elements");

  // ---- optional mod integrations (KUYRUK 101) ----
  const offered = await mcp.call("list_integrations");
  const viewer = offered.find((i: { id: string }) => i.id === "recipe_viewer");
  assert(viewer && viewer.use === "off" && viewer.engines["fabric-1.21.5"] === "REI" && viewer.engines["neoforge-1.21.5"] === "JEI" && viewer.fields.block.some((f: { key: string }) => f.key === "rvRecipes"),
    "list_integrations: recipe viewer, off, JEI/REI per engine, its block fields");
  const turned = await mcp.call("set_integration", { id: "recipe_viewer", use: "optional" });
  assert(turned.mod.integrations[0].id === "recipe_viewer" && turned.mod.integrations[0].required === false && !turned.issues.length, "set_integration optional");
  assert((await mcp.call("list_integrations")).find((i: { id: string }) => i.id === "recipe_viewer").use === "optional", "list_integrations shows it on");
  await mcp.call("update_element", { type: "block", id: "ruby_block", values: { rvCategory: true, rvRecipes: [{ inputs: [{ item: "ruby", count: 4 }], outputs: [{ item: "ruby_block", count: 1 }], time: 40, energy: 0 }] } });
  assert((await mcp.call("read_element", { type: "block", id: "ruby_block" })).rvRecipes[0].inputs[0].count === 4, "integration fields edited with update_element");
  assert(String(await mcp.call("set_integration", { id: "nope", use: "required" }, true)).includes("no integration"), "an unknown integration is refused");
  assert(!(await mcp.call("set_integration", { id: "recipe_viewer", use: "off" })).mod.integrations.length, "set_integration off");

  // ---- resources, coverage, logs ----
  assert((await mcp.call("list_resources")).sounds !== undefined, "list_resources");
  if (mcp.tools.includes("coverage")) assert(typeof (await mcp.call("coverage", { type: "item" })) === "object", "coverage report");
  assert(String(await mcp.call("client_log")).startsWith("running: false"), "client_log");
  assert(String(await mcp.call("server_log")).startsWith("running: false"), "server_log");

  // ---- git, with a local bare remote ----
  await mcp.call("git_init");
  sh(project, "config", "user.email", "test@mcedge.dev");
  sh(project, "config", "user.name", "MCEdge test");
  let status = await mcp.call("git_status");
  assert(status.repo && status.files.some((f: { path: string; index: string }) => f.path === "mcedge.json" && f.index === "?"), "git_status lists untracked files");
  assert(String(await mcp.call("git_diff", { path: "mcedge.json" })).includes("hellomcedge"), "git_diff of an untracked file");
  await mcp.call("git_stage", { paths: ["mcedge.json"] });
  status = await mcp.call("git_unstage", { paths: ["mcedge.json"] });
  assert(status.files.find((f: { path: string }) => f.path === "mcedge.json").index === "?", "git_unstage");
  const first = await mcp.call("git_commit", { message: "Initial project", all: true });
  assert(/^[0-9a-f]{7,}$/.test(first.commit), "git_commit all");
  await mcp.call("update_element", { type: "item", id: "sapphire", values: { stackSize: 32 } });
  assert(String(await mcp.call("git_diff", { path: "elements/items/sapphire.json" })).includes("+  \"stackSize\": 32"), "git_diff shows the element change");
  const second = await mcp.call("git_commit", { message: "Smaller sapphire stacks", all: true });
  const log = await mcp.call("git_log", { limit: 5 });
  assert(log[0].subject === "Smaller sapphire stacks" && log.length === 2, "git_log");
  assert(String(await mcp.call("git_show", { hash: second.commit })).includes("stackSize"), "git_show");
  await mcp.call("git_revert", { hash: second.commit });
  assert((await mcp.call("read_element", { type: "item", id: "sapphire" })).stackSize === 64, "git_revert undoes the commit");
  // Branches (KUYRUK #92): create, switch, commit on a new branch.
  const base = (await mcp.call("git_status")).branch;
  let branches = await mcp.call("git_branches");
  assert(branches.length === 1 && branches[0].current && branches[0].name === base, "git_branches lists the current branch");
  branches = await mcp.call("git_create_branch", { name: "feature/ore" });
  assert(branches.find((b: { name: string; current: boolean }) => b.current)?.name === "feature/ore", "git_create_branch switches to the new branch");
  await mcp.call("git_create_branch", { name: "later", checkout: false });
  assert((await mcp.call("git_status")).branch === "feature/ore", "git_create_branch checkout=false stays");
  await mcp.call("update_element", { type: "item", id: "sapphire", values: { stackSize: 8 } });
  const onBranch = await mcp.call("git_commit", { message: "Tiny sapphire stacks", all: true, branch: "feature/tiny" });
  assert(onBranch.branch === "feature/tiny" && (await mcp.call("git_log", { limit: 1 }))[0].subject === "Tiny sapphire stacks", "git_commit on a new branch");
  assert((await mcp.call("git_switch_branch", { name: base })).branch === base, "git_switch_branch");
  // KUYRUK 197: parents and refs for the branch graph; all=true reaches the other branches.
  const own = await mcp.call("git_log", { limit: 10 });
  assert(own.length === 3 && own[0].refs.includes(`HEAD -> ${base}`) && own[0].parents[0] === own[1].hash && own[2].parents.length === 0, "git_log parents and refs");
  const every = await mcp.call("git_log", { limit: 10, all: true });
  assert(every.length === 4 && every[0].subject === "Tiny sapphire stacks" && every[0].refs.join() === "feature/tiny" && every[0].parents[0] === own[0].hash, "git_log all=true lists every branch");
  assert((await mcp.call("read_element", { type: "item", id: "sapphire" })).stackSize === 64, "switching back restores the files");
  assert((await mcp.call("git_branches")).map((b: { name: string }) => b.name).sort().join() === [base, "feature/ore", "feature/tiny", "later"].sort().join(), "git_branches lists all");
  assert(String(await mcp.call("git_create_branch", { name: "bad name" }, true)).includes("not a valid branch name"), "invalid branch name is refused");
  writeFileSync(join(project, "scratch.txt"), "x");
  await mcp.call("git_discard", { paths: ["scratch.txt"] });
  assert(!existsSync(join(project, "scratch.txt")), "git_discard deletes an untracked file");
  const remote = join(mkdtempSync(join(tmpdir(), "mcedge-remote-")), "remote.git");
  spawnSync("git", ["init", "--bare", remote]);
  sh(project, "remote", "add", "origin", remote);
  await mcp.call("git_push");
  assert((await mcp.call("git_status")).upstream?.startsWith("origin/"), "git_push sets the upstream");
  const other = join(mkdtempSync(join(tmpdir(), "mcedge-clone-")), "clone");
  spawnSync("git", ["clone", remote, other]);
  sh(other, "-c", "user.email=a@b.c", "-c", "user.name=Other", "commit", "--allow-empty", "-m", "From another machine");
  sh(other, "push");
  await mcp.call("git_pull");
  assert((await mcp.call("git_log", { limit: 1 }))[0].subject === "From another machine", "git_pull");

  // ---- build and export (heavy) ----
  if (process.argv.includes("--build")) {
    const folder = mkdtempSync(join(tmpdir(), "mcedge-jars-"));
    const [result] = await mcp.call("export_jar", { engines: ["fabric-1.21.5"], folder });
    assert(result.ok && existsSync(result.jar), `export_jar ${result.jar ?? JSON.stringify(result.errors)}`);
  }
  console.log(`PASS (${mcp.tools.length} tools)`);
} finally {
  await mcp.close();
}
