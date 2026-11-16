import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { typeFields, valuesOfType, type Element } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { loadProject, saveElement, saveTextureFolders } from "../ir/storage.ts";
import { ensureFolder, folderMembers, FOLDER_ICONS, kindFolders, moveElements, moveFolder, removeFolder, withKindFolders, type FolderKind, removeFolderTree, renameFolder, setFolderColor, setFolderIcon, summarizeFolders } from "../ir/folders.ts";
import { describeModel, resolveModel, type BlockModelJson } from "../resources/blockModel.ts";
import { vanillaCatalog } from "../resources/vanillaAssets.ts";
import { QUICK_KINDS, quickItems, quickSearch } from "../ir/quickSearch.ts";
import { displayName, REGISTRY_PROVIDERS } from "../elements/model.ts";
import { loadTags } from "../tags/tags.ts";
import { clearGradleCaches, deleteResource, exportWorkspace, importResources, listResources, resourceBlocker, type ResourceKind } from "../resources/files.ts";
import { elementsNaming } from "../resources/resourceUse.ts";
import VANILLA_IDS from "../../config/vanilla-ids.json" with { type: "json" };
import { OFFERED_TAGS, suggestedEntries } from "../tags/offered.ts";
import { mappedSlots, modelTextureSlots } from "../resources/modelTextures.ts";
import { blockbenchCandidates, findBlockbench, launchBlockbench, prepareBlockbench, syncBlockbench, watchBlockbench, type BlockbenchSession } from "../resources/blockbenchEdit.ts";
import { deleteSoundEvent, projectSoundFiles, saveSoundEvent, SOUND_CATEGORIES, soundEvents } from "../resources/soundEvents.ts";
import { projectAnimations } from "../generator/mob/models.ts";
import { createPack, PACK_KINDS, previewPack } from "../ir/packs.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const KIND = z.enum(["sound", "model", "structure"]);

/**
 * Resources > Import sounds / model / structure and File > Export workspace for agents: the same core functions
 * the app's menus call (src/resources/files.ts).
 */
export function registerResourceTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool(
    "list_resources",
    {
      description: "List imported sounds (sounds/*.ogg), models (models/*.json|java|obj|bbmodel) and structures (structures/*.nbt), with the id elements use. "
        + "Models also give their kind (json, obj: block/item models; java: entity and worn armor models; bbmodel: both) and the element fields that use them "
        + "(\"block/ruby_lamp.customModelName\"); assign one with update_element on a model field that lists its kind in modelKinds.",
    },
    () => guard(() => {
      const project = loadProject(root);
      const modId = project.mod.id;
      const of = (kind: ResourceKind) => listResources(root, kind).map((path) => {
        const name = path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf("."));
        if (kind !== "model") return { path, use: `${modId}:${name}` };
        return { path, use: name, kind: path.slice(path.lastIndexOf(".") + 1), usedBy: modelUsers(project.elements, name) };
      });
      return json({ sounds: of("sound"), models: of("model"), structures: of("structure") });
    }),
  );
  server.registerTool(
    "import_resources",
    {
      description: "Copy files from this computer into the project: sounds (.ogg), models (.bbmodel is converted to a JSON block model "
        + "with its textures in textures/block; .json, .java, .obj, .mtl are copied) or structures (.nbt). Names become lower_snake_case.",
      inputSchema: { kind: KIND, files: z.array(z.string()).min(1).describe("Absolute paths of the files to import") },
    },
    ({ kind, files }) => guard(() => {
      if (files.some((f) => !isAbsolute(f))) throw new Error("files must be absolute paths");
      return json(importResources(root, kind, files.map((f) => resolve(f))));
    }),
  );
  server.registerTool(
    "inspect_model",
    {
      description: "What the app's 3D model preview draws for a project JSON block model (models/<name>.json): the project parent chain, "
        + "number of cubes and rotated cubes, bounds in 0-16 units, every texture variable and face texture with the project PNG it resolves to "
        + "(or why it shows as missing), and the display contexts (gui, ground, fixed, head, hands) it defines.",
      inputSchema: { name: z.string().describe("Model name as model fields take it, e.g. ruby_lamp") },
    },
    ({ name }) => guard(async () => {
      const modId = loadProject(root).mod.id;
      const model = await resolveModel(name, modId, (n) => {
        const file = join(root, "models", `${n}.json`);
        return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as BlockModelJson) : undefined;
      });
      return json(describeModel(model, modId, projectPngs(root)));
    }),
  );
  server.registerTool(
    "minecraft_ids",
    {
      description: "Tools > Minecraft data lists (KUYRUK 135): the game ids the editor knows, by kind (" + Object.keys(VANILLA_IDS).filter((k) => !k.startsWith("$")).join(", ")
        + "); query filters by text. Without kind, the kinds and their counts.",
      inputSchema: { kind: z.string().optional(), query: z.string().optional() },
    },
    ({ kind, query }) => guard(() => {
      const ids = VANILLA_IDS as unknown as Record<string, string[]>;
      if (!kind) return json(Object.fromEntries(Object.entries(ids).filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, v.length])));
      if (!Array.isArray(ids[kind])) throw new Error(`no list "${kind}"`);
      const q = query?.toLowerCase() ?? "";
      return json(ids[kind].filter((id) => id.includes(q)));
    }),
  );
  server.registerTool(
    "list_common_tags",
    {
      description: "Tags > Common tags (KUYRUK 135): common tags other mods and the game read, each with the elements of this mod it suggests "
        + "(by id suffix or prefix, or a field such as destroyTool). Add one with set_tag; forge: ids become each version's tag (c: on NeoForge and Fabric) when generated.",
    },
    () => guard(() => {
      const elements = loadProject(root).elements;
      return json(OFFERED_TAGS.map((tag) => ({ type: tag.type, id: tag.id, suggested: suggestedEntries(tag, elements) })));
    }),
  );
  server.registerTool(
    "clear_gradle_caches",
    { description: "Build & run > Clear Gradle caches (KUYRUK 135): remove out/<engine>/build and out/<engine>/.gradle of every engine; the next build makes them again. Stop runs first." },
    () => guard(() => json({ removed: clearGradleCaches(root) })),
  );
  server.registerTool(
    "create_pack",
    {
      description: "Tools > Create pack: make a set of elements with textures and recipes from one name and colour. ore: the material item (ingot or gem), "
        + "an ore block that generates underground and drops it, a storage block, smelting and block recipes; tool: the item plus pickaxe, axe, sword, shovel, hoe "
        + "with recipes; armor: the item plus an armor element (4 pieces, layer textures) with recipes; wood: log, planks, stairs, slab, fence, fence gate, button, "
        + "pressure plate with recipes; material: ore + tool + armor. Existing elements and textures are kept. preview: true only lists what it would make.",
      inputSchema: {
        kind: z.enum(PACK_KINDS), name: z.string().min(1), id: z.string().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        look: z.enum(["ingot", "gem"]).optional(), preview: z.boolean().default(false),
      },
    },
    ({ kind, name, id, color, look, preview }) => guard(() => {
      const options = { kind, name, id, color, look };
      if (preview) {
        const p = previewPack(root, options);
        return json({ elements: p.elements, textures: p.textures.map((x) => ({ path: x.path, exists: x.exists })) });
      }
      return json(createPack(root, options));
    }),
  );
  server.registerTool(
    "list_sound_events",
    {
      description: "The project's sound events (Resources > Sounds): what sound fields and procedure blocks play as \"<modid>:<name>\". Every sounds/<name>.ogg "
        + "is an event of its name until set_sound_event lists it; a listed event has a category, an optional subtitle (lang key subtitles.<modid>.<name>, "
        + "text in localization) and one or more files the game picks from at random.",
    },
    () => guard(() => {
      const project = loadProject(root);
      const files = projectSoundFiles(root);
      return json(soundEvents(root, project.mod.id, files).map((e) => ({
        id: `${project.mod.id}:${e.name}`, ...e, subtitle: e.subtitleKey ? project.localization.en_us?.[e.subtitleKey] ?? "" : "",
      })));
    }),
  );
  server.registerTool(
    "set_sound_event",
    {
      description: "Create or change a sound event like Resources > Sounds: name, category (" + SOUND_CATEGORIES.join(", ") + "), subtitle text in the base language "
        + "(\"\" for none; the key subtitles.<modid>.<name> can be translated with set_translations) and files (names in sounds/ without .ogg; import them first). "
        + "previous renames an event (its subtitle translations move with it).",
      inputSchema: {
        name: z.string(), category: z.enum(SOUND_CATEGORIES).default("neutral"), subtitle: z.string().default(""),
        files: z.array(z.string()).min(1), previous: z.string().optional(),
      },
    },
    ({ name, category, subtitle, files, previous }) => guard(() => (saveSoundEvent(root, { name, category, subtitle, files }, previous), json({ saved: name }))),
  );
  server.registerTool(
    "delete_sound_event",
    { description: "Remove a listed sound event and its subtitle; its files stay and become events of their own names again.", inputSchema: { name: z.string() } },
    ({ name }) => guard(() => (deleteSoundEvent(root, name), json({ deleted: name }))),
  );
  server.registerTool(
    "list_animations",
    { description: "Model animations in models/ (Resources > Animations): Blockbench Java animation exports and .bbmodel animations, with length and loop mode. Animation rows take the name (its last part). Import files with import_resources kind model." },
    () => guard(() => json(projectAnimations(root))),
  );
  server.registerTool(
    "model_textures",
    {
      description: "Texture slots of a block's custom model (renderType 2 JSON, 3 OBJ) and the project texture the block maps each one to (its customModelTextures field): "
        + "JSON slots are the model's texture variables (without particle), OBJ slots its materials. `set` maps slots ({\"0\": \"textures/blocks/x.png\"}; \"\" removes a mapping) "
        + "and saves the block; an unmapped slot keeps the model's own texture. A Java model (renderType 4) draws with the block's main texture (field texture).",
      inputSchema: {
        block: z.string().describe("Block element id"),
        set: z.record(z.string(), z.string()).optional().describe("Slot -> project texture path; \"\" removes the mapping"),
      },
    },
    ({ block, set }) => guard(async () => {
      const project = loadProject(root);
      const element = (project.elements.block ?? []).find((e) => e.id === block);
      if (!element) throw new Error(`no block "${block}"`);
      const renderType = Number(element.renderType);
      const model = String(element.customModelName ?? "");
      if (renderType === 4) return json({ block, model, kind: "java", texture: element.texture ?? "", note: "a Java model draws with the main texture; change the field texture" });
      if (renderType !== 2 && renderType !== 3) throw new Error(`block "${block}" has no custom JSON or OBJ model (renderType ${renderType})`);
      const kind = renderType === 2 ? "json" : "obj";
      const files = projectPngs(root);
      const slots = await modelTextureSlots(kind, model, project.mod.id, (path) => {
        const file = join(root, path);
        return existsSync(file) ? readFileSync(file, "utf8") : undefined;
      }, files);
      const mapping = Object.fromEntries(mappedSlots(element.customModelTextures));
      if (set) {
        for (const [slot, path] of Object.entries(set)) {
          if (path && !slots.some((s) => s.slot === slot)) throw new Error(`"${slot}" is not a texture slot of ${model} (${slots.map((s) => s.slot).join(", ") || "none"})`);
          if (path && !files.includes(path)) throw new Error(`no project texture ${path}`);
          if (path) mapping[slot] = path;
          else delete mapping[slot];
        }
        saveElement(root, "block", { ...element, customModelTextures: mapping });
      }
      return json({
        block, model, kind,
        slots: slots.map((s) => ({ slot: s.slot, modelTexture: s.texture, modelFile: s.file ?? null, mappedTo: mapping[s.slot] ?? null })),
        ...(Object.keys(mapping).some((k) => !slots.some((s) => s.slot === k)) ? { notInModel: Object.keys(mapping).filter((k) => !slots.some((s) => s.slot === k)) } : {}),
      });
    }),
  );
  // Models opened in Blockbench by this server, with the watcher that copies Blockbench's saves back.
  const blockbench = new Map<string, { session: BlockbenchSession; close: () => void }>();
  server.registerTool(
    "edit_in_blockbench",
    {
      description: "Edit in Blockbench (the app's button on model fields and Resources > Models): `open` copies models/<model>.json with the project textures it "
        + "names (and, with `block`, that block's customModelTextures mapping) into a work folder laid out as assets/<ns>/models and assets/<ns>/textures, "
        + "starts Blockbench on it (unless launch is false) and watches it: saves come back to the project (the model with the block's own slots put back, "
        + "changed textures to their files, new ones to textures/<path>.png). `sync` copies back now; `stop` ends the watch. Blockbench is looked for at "
        + "`program`, then its usual install places.",
      inputSchema: {
        model: z.string().describe("Project JSON model name (models/<model>.json)"),
        action: z.enum(["open", "sync", "stop"]).optional(),
        block: z.string().optional().describe("Block id whose customModelTextures the work copy shows"),
        launch: z.boolean().optional().describe("Start Blockbench (default true); false only prepares and watches"),
        program: z.string().optional().describe("Blockbench executable"),
      },
    },
    ({ model, action = "open", block, launch = true, program }) => guard(() => {
      const open = blockbench.get(model);
      if (action === "sync") {
        if (!open) throw new Error(`${model} is not open in Blockbench; use action open first`);
        return json({ model, written: syncBlockbench(open.session) });
      }
      if (action === "stop") {
        open?.close();
        blockbench.delete(model);
        return json({ model, stopped: !!open });
      }
      const project = loadProject(root);
      let overrides: Record<string, string> = {};
      if (block) {
        const element = (project.elements.block ?? []).find((e) => e.id === block);
        if (!element) throw new Error(`no block "${block}"`);
        overrides = Object.fromEntries(mappedSlots(element.customModelTextures));
      }
      const exe = launch ? findBlockbench(program) : undefined;
      if (launch && !exe) throw new Error(`Blockbench not found; looked at ${blockbenchCandidates(program).join(", ")}. Pass program, or launch false to only prepare.`);
      open?.close();
      const session = prepareBlockbench(root, project.mod.id, model, overrides);
      const watcher = watchBlockbench(session, () => {});
      blockbench.set(model, { session, close: () => watcher.close() });
      if (exe) launchBlockbench(exe, session.file);
      return json({ model, file: session.file, work: session.work, textures: session.textures, blockSlots: session.slots, launched: exe ?? null });
    }),
  );
  server.registerTool(
    "texture_folders",
    {
      description: "Folders of the Resources lists (texture-folders.json), `kind` textures (default), sounds, models or structures: they only organise that list; files, element fields and the mod do not change, so every path stays valid. "
        + "Items are texture paths (textures/block/ruby.png), sound event names (as in list_sound_events), or model and structure paths (models/x.json, structures/x.nbt). Folders nest (\"Gems/Ruby\"). "
        + "`list` (default) gives each folder with its item count, colour and icon and how many items are in none (`full` adds the placement item -> folder); "
        + "`create` makes `path` and its missing parents; `rename` gives `path` the new `name`; `move_folder` puts `path` and everything in it into the folder `folder` (\"\" = the top); "
        + "`color` sets the colour of `path` (\"#rrggbb\", \"\" clears it) and `icon` its icon (" + FOLDER_ICONS.join(", ") + "; \"\" is the folder icon); "
        + "`remove` deletes `path`: its items and subfolders go up to the parent, or, with `deleteContents`, its subfolders go and so do the items in it and below it "
        + "(items an element uses, and the mod logo for textures, are kept, moved up, and reported as `kept`; a listed sound event is removed but its sound files stay; `dryRun` only lists what would go); "
        + "`move` puts `items` (`textures` is the same list) into `folder` (\"\" takes them out of every folder), any number at once.",
      inputSchema: {
        kind: z.enum(["textures", "sounds", "models", "structures"]).optional(),
        action: z.enum(["list", "create", "rename", "remove", "move", "move_folder", "color", "icon"]).optional(),
        path: z.string().optional(), name: z.string().optional(),
        items: z.array(z.string()).min(1).optional(), textures: z.array(z.string()).min(1).optional(), folder: z.string().optional(),
        color: z.string().optional(), icon: z.string().optional(),
        deleteContents: z.boolean().optional(), dryRun: z.boolean().optional(),
        full: z.boolean().optional(),
      },
    },
    ({ kind = "textures", action = "list", path, name, items, textures, folder, color, icon, deleteContents, dryRun, full }) => guard(() => {
      const whole = loadProject(root).textureFolders;
      const state = kindFolders(whole, kind);
      const list = folderItems(root, kind);
      if (action === "list") {
        const summary = summarizeFolders(state, new Set(list.keys));
        return json({ kind, folders: summary.folders.map((f) => ({ path: f.path, [kind]: f.elements, total: f.total, ...(f.color ? { color: f.color } : {}), ...(f.icon ? { icon: f.icon } : {}) })), unfiled: summary.unfiled,
          ...(full ? { placement: Object.fromEntries(Object.entries(state.placement).filter(([p]) => list.keys.includes(p))) } : {}) });
      }
      if (action !== "move" && !path) throw new Error(`${action} needs a path`);
      if (action !== "move" && action !== "create" && !state.folders.includes(path!)) throw new Error(`no folder "${path}"`);
      let next = state;
      const result: Record<string, unknown> = { action, kind, path };
      if (action === "create") next = ensureFolder(state, path!).state;
      else if (action === "rename") {
        if (!name) throw new Error("rename needs a name");
        next = renameFolder(state, path!, name);
      } else if (action === "move_folder") {
        if (folder === undefined) throw new Error("move_folder needs a folder (\"\" = the top)");
        next = moveFolder(state, path!, folder);
        result.folder = folder;
      } else if (action === "color") {
        if (color === undefined) throw new Error("color needs a colour: \"#rrggbb\", or \"\" to clear");
        next = setFolderColor(state, path!, color);
        result.color = color.toLowerCase();
      } else if (action === "icon") {
        if (icon === undefined) throw new Error(`icon needs an icon: ${FOLDER_ICONS.join(", ")}, or "" for the folder icon`);
        next = setFolderIcon(state, path!, icon);
        result.icon = icon;
      } else if (action === "remove") {
        if (!deleteContents) next = removeFolder(state, path!);
        else {
          const files = folderMembers(state, path!).filter((p) => list.keys.includes(p));
          const kept = files.filter((p) => list.blocker(p));
          const doomed = files.filter((p) => !list.blocker(p));
          if (dryRun) return json({ action, kind, path, wouldDelete: doomed, kept });
          for (const p of doomed) list.remove(p);
          next = removeFolderTree(state, path!, new Set(kept));
          Object.assign(result, { deleted: doomed, kept });
        }
      } else {
        const moving = items ?? textures;
        if (!moving || folder === undefined) throw new Error("move needs items and folder");
        const missing = moving.filter((p) => !list.keys.includes(p));
        if (missing.length) throw new Error(`no project ${kind} item ${missing.join(", ")}`);
        next = moveElements(state, moving, folder);
        Object.assign(result, { path: undefined, moved: moving.length, folder });
      }
      saveTextureFolders(root, withKindFolders(whole, kind, next));
      return json({ ...result, folders: next.folders.length });
    }),
  );
  server.registerTool(
    "delete_resource",
    { description: "Delete an imported sound, model or structure (refused while an element names it).", inputSchema: { path: z.string().describe("e.g. sounds/ding.ogg") } },
    ({ path }) => guard(() => (deleteResource(root, path), json({ deleted: path }))),
  );
  server.registerTool(
    "export_workspace",
    {
      description: "Zip the whole project (without out/, build/, run/, .gradle, .git) to a file, like File > Export workspace.",
      inputSchema: { file: z.string().describe("Absolute path of the .zip to write") },
    },
    ({ file }) => guard(() => {
      if (!isAbsolute(file) || !file.toLowerCase().endsWith(".zip")) throw new Error("file must be an absolute path ending in .zip");
      return json({ file, files: exportWorkspace(root, file) });
    }),
  );
  server.registerTool(
    "quick_search",
    {
      description: "Search the whole project at once, like the app's Ctrl+K (KUYRUK 136): elements (by display name or id), textures, sounds, models, "
        + "structures, lang keys (and their English text), variables and tags, best match first. Each hit has its kind, the target to use with "
        + "the other tools (\"item/ruby\" for read_element, a project path, a lang key, a variable name, \"item:mymod:gems\" for a tag) and a detail line.",
      inputSchema: {
        query: z.string().min(1),
        kinds: z.array(z.enum(QUICK_KINDS)).optional().describe("Only these kinds"),
        limit: z.number().int().min(1).max(200).default(30),
      },
    },
    ({ query, kinds, limit }) => guard(() => {
      const project = loadProject(root);
      const types = typeRegistry().byId;
      const loc = project.localization;
      const keys = [...new Set(Object.values(loc).flatMap((entries) => Object.keys(entries)))];
      const items = quickItems({
        elements: Object.entries(project.elements).flatMap(([typeId, list]) => list.map((e: Element) => ({ typeId, id: e.id, name: displayName(types.get(typeId), e), typeName: types.get(typeId)?.name ?? typeId }))),
        textures: projectPngs(root),
        sounds: listResources(root, "sound"),
        models: listResources(root, "model"),
        structures: listResources(root, "structure"),
        langKeys: keys.map((key) => ({ key, text: loc.en_us?.[key] ?? Object.values(loc).map((l) => l[key]).find(Boolean) ?? "" })),
        variables: project.variables.map((v) => ({ name: v.name, type: v.type, scope: v.scope })),
        tags: loadTags(root).map((t) => ({ type: t.type, id: t.id })),
      }).filter((item) => !kinds?.length || kinds.includes(item.kind));
      return json(quickSearch(items, query, limit));
    }),
  );
  server.registerTool(
    "list_registry_entries",
    {
      description: "What the app's item, block and entity picker offers (KUYRUK 127), for writing item/block/entity fields and recipe slots: this mod's elements "
        + "(stored by bare id: \"ruby\"), vanilla ids with their in-game names (\"minecraft:stick\"; the full list of the Minecraft version, read from a client jar "
        + "an engine's Gradle downloaded, else a short bundled list) and tags (\"#minecraft:planks\"; this mod's tags and common vanilla ones; only where a field "
        + "allowTags, recipe slots always). Any other namespaced id is accepted too.",
      inputSchema: {
        kind: z.enum(["item", "block", "entity"]),
        query: z.string().optional().describe("Part of an id or name"),
        minecraft: z.string().optional().describe("Minecraft version (1.21.5, 26.3, 1.16.5); default the newest found"),
        language: z.string().default("en_us").describe("Game language of the names (tr_tr needs downloaded game assets)"),
        limit: z.number().int().min(1).max(5000).default(200),
      },
    },
    ({ kind, query, minecraft, language, limit }) => guard(() => {
      const project = loadProject(root);
      const q = query?.toLowerCase().trim() ?? "";
      const hit = (id: string, name = "") => !q || id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      const catalog = vanillaCatalog(kind, minecraft, language);
      const types = typeRegistry().byId;
      const mod = REGISTRY_PROVIDERS[kind].flatMap((type) => (project.elements[type] ?? []).map((e: Element) => ({
        id: e.id, type, name: displayName(types.get(type), e),
      }))).filter((e) => hit(e.id, e.name));
      const vanilla = catalog.ids.filter((id) => hit(id, catalog.names[id])).map((id) => ({ id, name: catalog.names[id] }));
      const tagType = kind === "entity" ? "entity_type" : kind;
      const tags = [...new Set([
        ...loadTags(root).filter((t) => t.type === tagType).map((t) => `#${t.id.includes(":") ? t.id : `${project.mod.id}:${t.id}`}`),
        ...catalog.tags,
      ])].filter((tag) => hit(tag));
      return json({
        source: catalog.jar ? { minecraft: catalog.minecraft, jar: catalog.jar } : "bundled list (no client jar yet: build or run an engine once)",
        mod, vanilla: vanilla.slice(0, limit), vanillaTotal: vanilla.length, tags: tags.slice(0, limit),
      });
    }),
  );
}

/** Project-relative PNGs under textures/ and models/, where model textures are looked up. */
function projectPngs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.toLowerCase().endsWith(".png")) out.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  walk(join(root, "textures"));
  walk(join(root, "models"));
  return out;
}

/** Element fields of kind "model" (also inside list rows) that name a model: "block/ruby_lamp.customModelName". */
function modelUsers(elements: Record<string, Element[]>, name: string): string[] {
  const users: string[] = [];
  const registry = typeRegistry();
  for (const [typeId, list] of Object.entries(elements)) {
    const type = registry.byId.get(typeId);
    if (!type) continue;
    for (const element of list) {
      for (const field of typeFields(type)) {
        if (field.type === "model" && element[field.key] === name) users.push(`${typeId}/${element.id}.${field.key}`);
        if (field.type !== "list" || !Array.isArray(element[field.key])) continue;
        (element[field.key] as Record<string, unknown>[]).forEach((row, i) => {
          for (const sub of field.fields ?? []) if (sub.type === "model" && row[sub.key] === name) users.push(`${typeId}/${element.id}.${field.key}[${i}].${sub.key}`);
        });
      }
    }
  }
  return users;
}

/** Textures an element field or the mod logo uses (what delete_texture refuses to delete). */
function usedTextures(root: string): Set<string> {
  const project = loadProject(root);
  const { byId } = typeRegistry();
  const used = new Set<string>();
  for (const [typeId, list] of Object.entries(project.elements)) {
    const type = byId.get(typeId);
    if (type) for (const e of list) valuesOfType(typeFields(type), e, "texture").forEach((p) => used.add(p));
  }
  if (project.mod.logo) used.add(project.mod.logo);
  return used;
}

/**
 * The items of one Resources list for folder management: their keys (texture paths, sound event names, model and structure
 * paths), why one cannot be deleted (an element uses it), and deleting one.
 */
function folderItems(root: string, kind: FolderKind): { keys: string[]; blocker: (key: string) => string | undefined; remove: (key: string) => void } {
  if (kind === "textures") {
    const used = usedTextures(root);
    return {
      keys: projectPngs(root).filter((p) => p.startsWith("textures/")),
      blocker: (p) => (used.has(p) ? "texture in use" : undefined),
      // Its animation goes with it, as in delete_texture.
      remove: (p) => (rmSync(join(root, p)), existsSync(join(root, `${p}.mcmeta`)) && rmSync(join(root, `${p}.mcmeta`))),
    };
  }
  if (kind === "sounds") {
    const project = loadProject(root);
    const events = soundEvents(root, project.mod.id, projectSoundFiles(root));
    const named = elementsNaming(project.elements);
    const defined = (name: string) => events.find((e) => e.name === name)?.defined;
    return {
      keys: events.map((e) => e.name),
      blocker: (name) => (defined(name) ? (named(name) ? "sound in use" : undefined) : resourceBlocker(root, `sounds/${name}.ogg`)),
      remove: (name) => (defined(name) ? deleteSoundEvent(root, name) : deleteResource(root, `sounds/${name}.ogg`)),
    };
  }
  return { keys: listResources(root, kind === "models" ? "model" : "structure"), blocker: (p) => resourceBlocker(root, p), remove: (p) => deleteResource(root, p) };
}
