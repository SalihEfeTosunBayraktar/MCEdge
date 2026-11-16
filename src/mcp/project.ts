import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exportFileName, DEFAULT_EXPORT_PATTERN } from "../../app/shared/exportName.ts";
import { buildTarget } from "../build/gradle.ts";
import { resolveModDependencies } from "../build/modDependencies.ts";
import { elementIdLookup, newElement, validateElement, type Element } from "../elements/model.ts";
import { elementJsonSchema, typeRegistry } from "../elements/registry.ts";
import { integrationInfo, loadIntegrations } from "../elements/integrations.ts";
import { listEngines, toolchainNeeds } from "../engines/registry.ts";
import { ensureToolchains } from "../engines/toolchains.ts";
import { generateTarget } from "../generator/generate.ts";
import { elementRows, filterRows, type ElementRow } from "../ir/elementQuery.ts";
import { engineCoverage } from "../engines/coverage.ts";
import { applyDelete, everything, planDelete } from "../ir/deleteCascade.ts";
import { keyProblem } from "../ir/localization.ts";
import { changeModIdentity } from "../ir/modIdentity.ts";
import { elementKey, ensureFolder, moveElements, NO_FOLDERS, parentFolder, removeFolder, renameFolder, setFolderColor, setFolderIcon, FOLDER_ICONS, summarizeFolders } from "../ir/folders.ts";
import { deleteElement, loadProblemSettings, loadProject, saveElement, saveFolders, saveLocalization, saveModInfo, saveProblemSettings, saveVariables } from "../ir/storage.ts";
import { applyProblemAction, classify, type ProblemAction } from "../ir/problems.ts";
import { VARIABLE_SCOPES, VARIABLE_TYPES, type ModInfo } from "../ir/types.ts";
import { validateProject } from "../ir/validate.ts";
import { loadTags, validateTags } from "../tags/tags.ts";
import { changelogSinceExport, recordExport } from "../vcs/changelog.ts";
import { gateAndUpload, problemText, publishProblems, smokeTestServer } from "../build/publish.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const ID = /^[a-z0-9_]+$/;

const dependency = z.object({
  modId: z.string(), version: z.string().default("*"), required: z.boolean().default(true), side: z.enum(["both", "client", "server"]).default("both"),
  source: z.object({ modrinth: z.string().optional(), curseforge: z.string().optional(), maven: z.string().regex(/^[^:\s]+:[^:\s]+:[^:\s]+$/).optional(), repository: z.string().optional() }).strict().optional()
    .describe("Where dev runs get the jar: Modrinth by default (slug = modId, or modrinth; a mod Modrinth lacks is tried on CurseForge by modId when the "
      + "computer has a CurseForge API key), curseforge (CurseForge project slug or numeric id; needs the key, set by the user in the app's Preferences, "
      + "never in the project), or a Maven artifact group:artifact:version ({loader}, {mc}) from repository"),
});

/**
 * Everything the app's Workspace settings, Mod elements, Variables and Localization screens do, for agents: mod
 * settings and dependencies, element types with their schema, element CRUD with validation, variables,
 * translations, project validation and jar export. Writes go to the same JSON files the app watches.
 */
export function registerProjectTools(server: McpServer, root: string, guard: Guard): void {
  const type = (id: string) => {
    const found = typeRegistry().byId.get(id);
    if (!found) throw new Error(`unknown element type "${id}"; see list_element_types`);
    return found;
  };
  // Problems with their severity; ignored ones (problems.json) are left out unless asked for, marked `ignored` (KUYRUK 196).
  const rated = <T extends { path: string; code?: string }>(issues: T[], includeIgnored = false, prefix = "") => {
    const { shown, ignored } = classify(issues, loadProblemSettings(root), prefix);
    return includeIgnored ? [...shown, ...ignored.map((i) => ({ ...i, ignored: true }))] : shown;
  };
  const issuesOf = (typeId: string, element: Element, includeIgnored = false) => {
    const project = loadProject(root);
    const issues = validateElement(type(typeId), element, { elementIds: elementIdLookup(project.elements), fileExists: (p) => existsSync(join(root, p)) });
    return rated(issues, includeIgnored, `${typeId}/${element.id}.`);
  };
  const modIssues = () => rated(validateProject(loadProject(root), root)).filter((i) => i.path.startsWith("mod"));
  const find = (typeId: string, id: string) => {
    const element = loadProject(root).elements[typeId]?.find((e) => e.id === id);
    if (!element) throw new Error(`no ${typeId} "${id}"`);
    return element;
  };

  // ---- mod settings ----
  server.registerTool("get_mod", { description: "Mod settings (Workspace settings): id, name, version, package, authors, description, license, website, credits, logo, dependencies." },
    () => guard(() => json(loadProject(root).mod)));
  server.registerTool(
    "update_mod",
    {
      description: "Change mod settings; only the given keys change. A new id or package is applied with change_mod_identity (ids, translation keys, "
        + "datapack folder and code follow). Returns the settings and any project problems about them.",
      inputSchema: {
        name: z.string().optional(), id: z.string().regex(ID).optional(), version: z.string().optional(), package: z.string().optional(),
        authors: z.array(z.string()).optional(), description: z.string().optional(), license: z.string().optional(), website: z.string().optional(),
        credits: z.string().optional(), logo: z.string().optional().describe("Project PNG path or empty"),
        dependencies: z.array(dependency).optional().describe("Replaces the whole dependency list"),
        engines: z.array(z.string()).min(1).optional().describe("Engines the project targets (the app's engine menu and Build all); all when never set"),
        publish: z.object({ modrinth: z.string().optional(), curseforge: z.string().optional() }).optional()
          .describe("Where publish_mod uploads: Modrinth project slug or id, CurseForge project id (Q238)"),
      },
    },
    ({ id, package: pkg, ...change }) => guard(() => {
      // A new id or package rewrites everything that names it (change_mod_identity), never just the settings.
      const current = loadProject(root).mod;
      if ((id !== undefined && id !== current.id) || (pkg !== undefined && pkg !== current.package)) changeModIdentity(root, { modId: id, package: pkg });
      const mod: ModInfo = { ...loadProject(root).mod, ...Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) } as ModInfo;
      saveModInfo(root, mod);
      return json({ mod, issues: modIssues() });
    }),
  );
  // ---- optional mod integrations (KUYRUK 101) ----
  server.registerTool("list_integrations", {
    description: "Optional mod integrations (config/integrations): id, name, description, the other mod per engine, whether this project uses it "
      + "(off / optional / required) and the element fields it adds by element type. Edit those fields with update_element.",
  }, () => guard(() => {
    const used = loadProject(root).mod.integrations ?? [];
    return json(loadIntegrations().integrations.map((def) => {
      const use = used.find((u) => u.id === def.id);
      return { ...integrationInfo(def), use: use ? (use.required ? "required" : "optional") : "off",
        fields: Object.fromEntries(Object.entries(def.groups).map(([type, group]) => [type, group.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, help: f.help }))])) };
    }));
  }));
  server.registerTool("set_integration", {
    description: "Turn an optional mod integration on (optional or required dependency) or off. On adds the other mod to Gradle and the mod "
      + "metadata of every engine it supports, generates its code, and shows its fields on the elements. Returns the mod settings and problems.",
    inputSchema: { id: z.string(), use: z.enum(["off", "optional", "required"]) },
  }, ({ id, use }) => guard(() => {
    if (!loadIntegrations().integrations.some((i) => i.id === id)) throw new Error(`no integration "${id}"; see list_integrations`);
    const current = loadProject(root).mod;
    const others = (current.integrations ?? []).filter((i) => i.id !== id);
    const mod: ModInfo = { ...current, integrations: use === "off" ? others : [...others, { id, required: use === "required" }] };
    saveModInfo(root, mod);
    return json({ mod, issues: modIssues() });
  }));
  const includeIgnored = z.boolean().default(false).describe("Also list problems the project ignores (problems.json), marked ignored: true");
  server.registerTool("validate_project", {
    description: "Every problem the Problems panel shows: path, message, check code and severity (error blocks builds; warning and info do not). "
      + "Problems the user ignored are left out unless include_ignored.",
    inputSchema: { include_ignored: includeIgnored },
  }, ({ include_ignored }) => guard(() => {
    const project = loadProject(root);
    return json(rated([...validateProject(project, root), ...validateTags(loadTags(root), project)], include_ignored));
  }));
  server.registerTool("ignore_problem", {
    description: "Ignore a warning or info problem (the Problems panel's Ignore): with `path` (as validate_project gives it) that one problem, without "
      + "it every problem of the check `code`. undo: true stops ignoring. Stored in the project's problems.json. Errors cannot be ignored: fix them.",
    inputSchema: { code: z.string(), path: z.string().optional(), undo: z.boolean().default(false) },
  }, ({ code, path, undo }) => guard(() => {
    const action: ProblemAction = path !== undefined ? { kind: undo ? "unignore" : "ignore", code, path } : { kind: undo ? "unignoreCheck" : "ignoreCheck", code };
    saveProblemSettings(root, applyProblemAction(loadProblemSettings(root), action));
    return json(loadProblemSettings(root));
  }));
  server.registerTool("set_problem_severity", {
    description: "Set the severity of a check that is not an error by nature (warning or info by default): error makes it block builds, "
      + "default restores it. Stored in problems.json.",
    inputSchema: { code: z.string(), severity: z.enum(["error", "warning", "info", "default"]) },
  }, ({ code, severity }) => guard(() => {
    saveProblemSettings(root, applyProblemAction(loadProblemSettings(root), { kind: "severity", code, severity }));
    return json(loadProblemSettings(root));
  }));

  // ---- element types ----
  server.registerTool("list_element_types", { description: "Element types (the New element popup): id, name, folder and description." },
    () => guard(() => json(typeRegistry().types.map((t) => ({ id: t.id, name: t.name, folder: t.folder, description: t.description })))));
  server.registerTool(
    "element_type_schema",
    {
      description: "A type's form: pages, groups and fields (key, type, label, help, default, options, min/max, showIf, ...) and the JSON schema of its elements. "
        + "Field formats are described in docs/ELEMENT-TYPES.md.",
      inputSchema: { type: z.string() },
    },
    ({ type: typeId }) => guard(() => {
      const t = type(typeId);
      return json({ id: t.id, name: t.name, description: t.description, pages: t.pages, jsonSchema: elementJsonSchema(t) });
    }),
  );

  // ---- elements ----
  server.registerTool(
    "list_elements",
    {
      description: "Mod elements: type, id, display name and folder, filtered and paged (a large project has hundreds: the default page is 100 elements, about 11 KB, and a page is at most 500). "
        + "`type` is one element type; `query` matches the id or display name; `folder` is a folder and everything below it (\"\" is the elements in no folder). "
        + "`withProblems` keeps elements with validation problems (each row then has its `problems` count) and `notGeneratedOn` (an engine id) keeps "
        + "elements of types that engine does not generate: the element list's With problems and Not generated filters (KUYRUK 129). "
        + "Returns { total, offset, limit, next, elements }; next is the offset of the following page, absent on the last.",
      inputSchema: {
        type: z.string().optional(), query: z.string().optional(), folder: z.string().optional(),
        withProblems: z.boolean().optional(), notGeneratedOn: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).default(0),
      },
    },
    ({ type: typeId, query, folder, withProblems, notGeneratedOn, limit, offset }) => guard(() => {
      const project = loadProject(root);
      if (typeId) type(typeId);
      if (folder && !(project.folders ?? NO_FOLDERS).folders.includes(folder)) throw new Error(`no folder "${folder}"; see list_folders`);
      let matching: (ElementRow & { problems?: number })[] = filterRows(elementRows(project, typeRegistry().byId), { type: typeId, query, folder });
      if (withProblems) {
        const issues = rated(validateProject(project, root));
        const count = (row: ElementRow) => issues.filter((i) => i.path === `${row.type}/${row.id}` || i.path.startsWith(`${row.type}/${row.id}.`)).length;
        matching = matching.map((row) => ({ ...row, problems: count(row) })).filter((row) => row.problems > 0);
      }
      if (notGeneratedOn) {
        const engine = listEngines().find((e) => e.id === notGeneratedOn);
        if (!engine) throw new Error(`unknown engine ${notGeneratedOn}; one of ${listEngines().map((e) => e.id).join(", ")}`);
        const coverage = engineCoverage(engine);
        matching = matching.filter((row) => !coverage[row.type]);
      }
      const end = offset + limit;
      return json({ total: matching.length, offset, limit, ...(end < matching.length ? { next: end } : {}), elements: matching.slice(offset, end) });
    }),
  );
  server.registerTool("read_element", { description: "One element's stored values.", inputSchema: { type: z.string(), id: z.string() } },
    ({ type: typeId, id }) => guard(() => json(find(typeId, id))));
  server.registerTool(
    "create_element",
    {
      description: "Create an element with the type's defaults plus `values`. Ids are lower_snake_case and unique (recipes have their own namespace). "
        + "Returns the element and its validation problems (it is saved either way, like the editor saves drafts).",
      inputSchema: { type: z.string(), id: z.string().regex(ID), values: z.record(z.string(), z.unknown()).optional() },
    },
    ({ type: typeId, id, values }) => guard(() => {
      const project = loadProject(root);
      const taken = Object.entries(project.elements).some(([t, list]) => (t === "recipe") === (typeId === "recipe") && list.some((e) => e.id === id));
      if (taken) throw new Error(`id "${id}" is already used`);
      const element = { ...newElement(type(typeId), id), ...(values ?? {}), id };
      saveElement(root, typeId, element);
      return json({ element, issues: issuesOf(typeId, element) });
    }),
  );
  server.registerTool(
    "update_element",
    {
      description: "Change an element: the given top-level keys replace their values (other keys stay). Returns the element and its validation problems.",
      inputSchema: { type: z.string(), id: z.string(), values: z.record(z.string(), z.unknown()) },
    },
    ({ type: typeId, id, values }) => guard(() => {
      const element = { ...find(typeId, id), ...values, id };
      saveElement(root, typeId, element);
      return json({ element, issues: issuesOf(typeId, element) });
    }),
  );
  server.registerTool("delete_element", {
    description: "Delete an element's file, and on request what only it used: procedures nobody else calls and GUIs nobody else opens "
      + "(reached from it), recipes that make it, textures and models no other element names, translation keys no other element uses, and the "
      + "folder entries (folders.json, texture-folders.json) of everything deleted. Listed in `exclusive` (elements, textures, models, langKeys, each with its folder) "
      + "after every delete and by dryRun, which deletes nothing; what another element, tag or datapack file still uses is never listed. "
      + "`cascade` deletes some of it too: \"all\" (everything listed) or {elements: [\"procedure/give_reward\"], textures: [\"textures/ruby.png\"], models, langKeys}. "
      + "Anything not in the list is refused. `engine` (default: the first) decides which keys the generator writes for the element.",
    inputSchema: {
      type: z.string(), id: z.string(), dryRun: z.boolean().default(false),
      cascade: z.union([z.literal("all"), z.object({
        elements: z.array(z.string()).optional(), textures: z.array(z.string()).optional(), models: z.array(z.string()).optional(), langKeys: z.array(z.string()).optional(),
      })]).optional(),
      engine: z.string().optional(),
    },
  }, ({ type: typeId, id, dryRun, cascade, engine }) => guard(() => {
    find(typeId, id);
    const chosen = engine ? listEngines().find((e) => e.id === engine) : undefined;
    if (engine && !chosen) throw new Error(`unknown engine ${engine}`);
    const plan = planDelete(root, { type: typeId, id }, chosen);
    const { element, ...exclusive } = plan;
    if (dryRun) return json({ wouldDelete: `${typeId}/${id}`, exclusive, deleted: [] });
    const done = applyDelete(root, plan, cascade === "all" ? everything(plan) : cascade ?? {});
    const left = {
      elements: plan.elements.filter((e) => !done.deleted.includes(elementKey(e.type, e.id))), textures: plan.textures.filter((t) => !done.textures.includes(t.path)),
      models: plan.models.filter((m) => !done.models.includes(m.path)), langKeys: plan.langKeys.filter((k) => !done.langKeys.includes(k.key)),
    };
    const anyLeft = Object.values(left).some((list) => list.length);
    return json({ deleted: done.deleted, textures: done.textures, models: done.models, langKeys: done.langKeys, folderEntries: done.folderEntries, ...(anyLeft ? { exclusiveLeft: left } : {}) });
  }));
  server.registerTool("validate_element", {
    description: "Validation problems of one element, with severity; ignored ones are left out unless include_ignored.",
    inputSchema: { type: z.string(), id: z.string(), include_ignored: includeIgnored },
  }, ({ type: typeId, id, include_ignored }) => guard(() => json(issuesOf(typeId, find(typeId, id), include_ignored))));

  // ---- variables ----
  server.registerTool("get_variables", { description: "Global variables (Variables screen): name, type, scope, initial value." },
    () => guard(() => json(loadProject(root).variables)));
  server.registerTool(
    "list_folders",
    {
      description: "Folders of the element list (they organise the project only; the mod does not change). By default a summary: each folder with its direct elements, "
        + "elements below it, subfolders, and how many elements sit in no folder (a large project's full placement is tens of KB). `path` limits it to one folder and what is below. "
        + "`full` returns the folder list and every placement (\"typeId/id\" -> folder) instead, for `path` or the whole project.",
      inputSchema: { path: z.string().optional(), full: z.boolean().default(false) },
    },
    ({ path, full }) => guard(() => {
      const project = loadProject(root);
      const state = project.folders ?? NO_FOLDERS;
      if (path && !state.folders.includes(path)) throw new Error(`no folder "${path}"`);
      const under = (f: string) => !path || f === path || f.startsWith(`${path}/`);
      if (full) {
        return json({ folders: state.folders.filter(under), placement: Object.fromEntries(Object.entries(state.placement).filter(([, f]) => under(f))) });
      }
      const existing = new Set(Object.entries(project.elements).flatMap(([typeId, list]) => list.map((e) => elementKey(typeId, e.id))));
      const summary = summarizeFolders(state, existing);
      return json({ folders: summary.folders.filter((f) => under(f.path)), ...(path ? {} : { unfiled: summary.unfiled }) });
    }),
  );
  server.registerTool(
    "edit_folder",
    {
      description: "Create, rename, colour, set the icon of or remove a folder of the element list. Paths use / (\"Economy/Shops\"). Creating makes the missing parents too (\"Economy/Shops/Old\" makes Economy and Economy/Shops first). "
        + "Removing a folder moves what it held up to its parent; elements are never deleted. `color` sets the folder's tile colour in the editor as \"#rrggbb\" (\"\" clears it; the menu offers the 16 dye colours) and `icon` its tile icon, drawn in that colour (" + FOLDER_ICONS.join(", ") + "; \"\" is the folder icon); neither changes anything in the mod. Answers with what changed, not the whole state (see list_folders).",
      inputSchema: { action: z.enum(["create", "rename", "remove", "color", "icon"]), path: z.string().describe("Folder path; for create, the new folder's full path"), name: z.string().optional().describe("rename: the new name"), color: z.string().optional().describe("color: \"#rrggbb\", or \"\" to clear"), icon: z.string().optional().describe("icon: an icon name, or \"\" for the folder icon") },
    },
    ({ action, path, name, color, icon }) => guard(() => {
      const state = loadProject(root).folders ?? NO_FOLDERS;
      if (!["create", "rename", "remove", "color", "icon"].includes(action) || (action === "rename" && !name)) throw new Error("rename needs a name");
      if (action === "icon") {
        if (icon === undefined) throw new Error(`icon needs an icon: ${FOLDER_ICONS.join(", ")}, or "" for the folder icon`);
        if (!state.folders.includes(path)) throw new Error(`no folder "${path}"`);
        saveFolders(root, setFolderIcon(state, path, icon));
        return json({ action, path, icon });
      }
      if (action === "color" && color === undefined) throw new Error("color needs a colour: \"#rrggbb\", or \"\" to clear");
      if (action !== "create" && !state.folders.includes(path)) throw new Error(`no folder "${path}"`);
      if (action === "color") {
        saveFolders(root, setFolderColor(state, path, color!));
        return json({ action, path, color: color!.toLowerCase() });
      }
      if (action === "create") {
        const { state: next, created } = ensureFolder(state, path);
        saveFolders(root, next);
        return json({ action, created, folders: next.folders.length });
      }
      const next = action === "rename" ? renameFolder(state, path, name!) : removeFolder(state, path);
      saveFolders(root, next);
      return json({ action, path, ...(action === "rename" ? { renamedTo: `${parentFolder(path) ? `${parentFolder(path)}/` : ""}${name!.trim()}` } : {}), folders: next.folders.length });
    }),
  );
  server.registerTool(
    "move_to_folder",
    {
      description: "Move elements into a folder of the element list; an empty folder moves them to the top. Name them in `elements`, or select by `pattern` (glob on the id: * and ?), "
        + "`type`, `query` (text in the id or display name) and `from` (elements now in that folder, subfolders included; \"\" = in no folder) together, not both ways. "
        + "A selector needs at least one of them (pattern \"*\" is everything). `dryRun` only lists what would move.",
      inputSchema: {
        folder: z.string(),
        elements: z.array(z.object({ type: z.string(), id: z.string() })).min(1).optional(),
        pattern: z.string().optional(), type: z.string().optional(), query: z.string().optional(), from: z.string().optional(),
        dryRun: z.boolean().default(false),
      },
    },
    ({ elements, folder, pattern, type: typeId, query, from, dryRun }) => guard(() => {
      const project = loadProject(root);
      const state = project.folders ?? NO_FOLDERS;
      if (folder && !state.folders.includes(folder)) throw new Error(`no folder "${folder}"; create it with edit_folder`);
      const selector = pattern !== undefined || typeId !== undefined || query !== undefined || from !== undefined;
      if (elements && selector) throw new Error("give elements or a selector (pattern, type, query, from), not both");
      if (!elements && !selector) throw new Error("give elements or a selector (pattern, type, query, from)");
      if (typeId) type(typeId);
      if (from && !state.folders.includes(from)) throw new Error(`no folder "${from}"`);
      let keys: string[];
      if (elements) {
        for (const { type: t, id } of elements) if (!project.elements[t]?.some((e) => e.id === id)) throw new Error(`no ${t} "${id}"`);
        keys = elements.map((e) => elementKey(e.type, e.id));
      } else {
        keys = filterRows(elementRows(project, typeRegistry().byId), { type: typeId, query, pattern, folder: from }).map((r) => elementKey(r.type, r.id));
      }
      const already = keys.filter((k) => (state.placement[k] ?? "") === folder).length;
      if (!dryRun) saveFolders(root, moveElements(state, keys, folder));
      return json({ ...(dryRun ? { dryRun } : {}), moved: keys.length - already, alreadyThere: already, folder, sample: keys.slice(0, 10), ...(keys.length > 10 ? { more: keys.length - 10 } : {}) });
    }),
  );
  server.registerTool(
    "set_variables",
    {
      description: "Replace the global variable list.",
      inputSchema: {
        variables: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), type: z.enum(VARIABLE_TYPES), scope: z.enum(VARIABLE_SCOPES), initial: z.string().default("") })),
      },
    },
    ({ variables }) => guard(() => {
      const names = variables.map((v) => v.name);
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) throw new Error(`variable "${dup}" twice`);
      saveVariables(root, variables);
      return json(variables);
    }),
  );

  // ---- localization ----
  server.registerTool(
    "get_localization",
    { description: "Translations per language code (en_us, tr_tr): lang key -> text. One language or all.", inputSchema: { language: z.string().optional() } },
    ({ language }) => guard(() => {
      const all = loadProject(root).localization;
      return json(language ? all[language] ?? {} : all);
    }),
  );
  server.registerTool(
    "set_translations",
    {
      description: "Set lang keys of one language; a null value removes the key. A new language code adds the language. "
        + "Keys new to the project that are not lower case dot-separated parts, or have no mod id part, are saved but listed under warnings.",
      inputSchema: { language: z.string().regex(/^[a-z]{2,3}_[a-z]{2,3}$/), entries: z.record(z.string(), z.string().nullable()) },
    },
    ({ language, entries }) => guard(() => {
      const { localization, mod } = loadProject(root);
      const lang = { ...(localization[language] ?? {}) };
      const known = new Set(Object.values(localization).flatMap(Object.keys));
      const warnings: string[] = [];
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) delete lang[key];
        else lang[key] = value;
        const problem = value !== null && !known.has(key) ? keyProblem(key, mod.id) : undefined;
        if (problem) warnings.push(problem === "format" ? `${key}: not lower case dot-separated parts` : `${key}: no "${mod.id}" part, may clash with other mods`);
      }
      saveLocalization(root, { ...localization, [language]: lang });
      return json({ language, keys: Object.keys(lang).length, ...(warnings.length ? { warnings } : {}) });
    }),
  );

  // ---- export ----
  /** File > Export for agents: each engine builds and its jar is copied; the export is remembered when all built. */
  async function exportEngines(engines: string[], folder: string, pattern?: string) {
    if (!isAbsolute(folder)) throw new Error("folder must be an absolute path");
    mkdirSync(folder, { recursive: true });
    const project = loadProject(root);
    const results = [];
    for (const engineId of engines) {
      const engine = listEngines().find((e) => e.id === engineId);
      if (!engine) throw new Error(`unknown engine ${engineId}; one of ${listEngines().map((e) => e.id).join(", ")}`);
      await ensureToolchains(toolchainNeeds(engine));
      await resolveModDependencies(project.mod.dependencies, engine);
      const outDir = join(root, "out", engine.id);
      const { skipped, warnings } = generateTarget(project, root, engine, outDir);
      const lines: string[] = [];
      const result = await buildTarget(engine, outDir, (line) => lines.push(line));
      let jar: string | undefined;
      if (result.ok && result.jar) {
        jar = join(folder, exportFileName(pattern ?? DEFAULT_EXPORT_PATTERN, {
          modid: project.mod.id, modversion: project.mod.version, loader: engine.loader, mc: engine.minecraft, engine: engine.id,
        }));
        copyFileSync(result.jar, jar);
      }
      results.push({ engine: engine.id, ok: !!jar, jar, log: result.logFile, skipped, warnings,
        errors: jar ? [] : lines.filter((l) => /error:|FAILED|What went wrong/.test(l)).slice(0, 40) });
    }
    if (results.every((r) => r.ok)) await recordExport(root, project.mod.version);
    return { project, results };
  }
  server.registerTool(
    "export_jar",
    {
      description: "File > Export mod jar: build each engine and copy its jar to `folder` under the file name pattern "
        + `(placeholders {modid} {modversion} {loader} {mc} {engine}; default ${DEFAULT_EXPORT_PATTERN}). Waits for the builds. `
        + "When every engine builds, the export is remembered and `changelog` starts again from here.",
      inputSchema: { engines: z.array(z.string()).min(1), folder: z.string(), pattern: z.string().optional() },
    },
    ({ engines, folder, pattern }) => guard(async () => json((await exportEngines(engines, folder, pattern)).results)),
  );
  server.registerTool(
    "publish_mod",
    {
      description: "File > Export with publishing (Q238): checks the mod's Modrinth/CurseForge projects (mod.publish), this computer's tokens "
        + "and that the version is not tagged yet; builds and exports every engine (as export_jar); then the gate: each engine's dedicated "
        + "server must start with the mod; then tags the version v<version> (own git repo only) and uploads each jar as its own version "
        + "(number <version>+<loader>-<mc>) with its game version and loader. A failed step uploads nothing. `changelog` defaults to the "
        + "changelog tool's draft. dry_run: everything but the tag and the uploads.",
      inputSchema: {
        engines: z.array(z.string()).min(1), folder: z.string(), pattern: z.string().optional(),
        platforms: z.array(z.enum(["modrinth", "curseforge"])).min(1),
        release_type: z.enum(["release", "beta", "alpha"]).default("release"),
        changelog: z.string().optional(), dry_run: z.boolean().default(false),
      },
    },
    ({ engines, folder, pattern, platforms, release_type, changelog, dry_run }) => guard(async () => {
      const mod = loadProject(root).mod;
      const problems = dry_run ? [] : await publishProblems(root, mod, platforms);
      if (problems.length) return json({ uploaded: false, problems: problems.map(problemText) });
      const { results } = await exportEngines(engines, folder, pattern);
      if (results.some((r) => !r.ok)) return json({ uploaded: false, stopped: "a build failed", results });
      const built = results.map((r) => ({ engine: listEngines().find((e) => e.id === r.engine)!, jar: r.jar!, projectDir: join(root, "out", r.engine) }));
      const notes = changelog ?? (await changelogSinceExport(root, mod.version)).text;
      if (dry_run) {
        const smoke = [];
        for (const b of built) smoke.push({ engine: b.engine.id, ...(await smokeTestServer(b.engine, b.projectDir)) });
        return json({ uploaded: false, dryRun: true, results, smoke, changelog: notes });
      }
      const outcome = await gateAndUpload(root, mod, built, { platforms, releaseType: release_type, changelog: notes }, () => {});
      return json({ uploaded: !outcome.stopped && outcome.uploads.every((u) => u.ok), results, ...outcome });
    }),
  );
  server.registerTool(
    "changelog",
    {
      description: "The Export dialog's changelog draft: the git commits (touching the project, no merges, newest first) since the last "
        + "export in which every engine built, kept in .mcedge/last-export.json. `text` is Markdown (## version, one line per commit); "
        + "`since` is that export (absent on a first export), `sinceMissing` means its commit left the history and commits after its date are listed.",
      inputSchema: {},
    },
    () => guard(async () => json(await changelogSinceExport(root, loadProject(root).mod.version))),
  );
}
