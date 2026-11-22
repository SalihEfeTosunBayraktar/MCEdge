import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from "electron";
import { explainBuild } from "../../src/mcp/buildErrors.ts";
import { explainGradleFailures, explainJavac } from "../../src/build/explain.ts";
import { parseJavacDiagnostics } from "../../src/build/javacErrors.ts";
import { buildTarget, engineSetup, logPath, runGradle, type GradleRun } from "../../src/build/gradle.ts";
import { listEngines, toolchainNeeds } from "../../src/engines/registry.ts";
import { ensureToolchains } from "../../src/engines/toolchains.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { LOCK_DIR, lockedElements, lockElementCode, unlockElementCode } from "../../src/generator/lockedCode.ts";
import { cachedModDependencies, resolveModDependencies, type DependencyResolution } from "../../src/build/modDependencies.ts";
import { clientTasks, muteClient, testServerPort } from "../../src/build/runs.ts";
import { clientLogName, DEFAULT_PLAYER, isPlayerName } from "../../src/build/players.ts";
import { typeFields, valuesOfType } from "../../src/elements/model.ts";
import { integrationInfo, loadIntegrations } from "../../src/elements/integrations.ts";
import { localizeTypes, typeRegistry, type TypeLabels } from "../../src/elements/registry.ts";
import { engineCoverage } from "../../src/engines/coverage.ts";
import type { ProjectFolders } from "../../src/ir/folders.ts";
import { exportTexture } from "../../src/resources/exportTexture.ts";
import { vanillaCatalog, vanillaIcons, type PickerKind } from "../../src/resources/vanillaAssets.ts";
import { findAllReferences, referencesOf, unusedElements } from "../../src/ir/references.ts";
import { loadReferenceInput } from "../../src/ir/referenceInput.ts";
import { changeModIdentity, type IdentityChange } from "../../src/ir/modIdentity.ts";
import { renameElement, renameSummary } from "../../src/ir/rename.ts";
import { createProject, type NewProject } from "../../src/ir/createProject.ts";
import { applyStarter, listStarters } from "../../src/ir/starters.ts";
import { generatedLangKeys } from "../../src/generator/langKeys.ts";
import { applyDelete, planDelete, type DeletePlan, type DeleteSelection } from "../../src/ir/deleteCascade.ts";
import { projectUnusedTranslations, removeUnusedTranslations } from "../../src/ir/unusedTranslations.ts";
import { unusedIssues } from "../../src/ir/translationUse.ts";
import { isProjectDir, loadElement, loadProject, needsMigration, refreshSchemas, saveElement, saveFolders, saveLocalization, saveModInfo, saveTextureFolders, saveVariables, TEXTURE_FOLDERS_FILE, loadProblemSettings, saveProblemSettings, PROBLEMS_FILE } from "../../src/ir/storage.ts";
import { applyProblemAction, classify, type ProblemAction } from "../../src/ir/problems.ts";
import type { ModProject } from "../../src/ir/types.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { ROOT } from "../../src/paths.ts";
import { merge3, same } from "../renderer/src/live/merge.ts";
import { importWorkspace, listResources } from "../../src/resources/files.ts";
import { projectSoundFiles, soundEvents } from "../../src/resources/soundEvents.ts";
import { projectAnimations } from "../../src/generator/mob/models.ts";
import { loadTags, saveTags, validateTags, type ElementTag } from "../../src/tags/tags.ts";
import { exportFileName } from "../shared/exportName.ts";
import { changelogSinceExport, LAST_EXPORT, recordExport } from "../../src/vcs/changelog.ts";
import { gateAndUpload, publishProblems, type Platform, type PublishOptions } from "../../src/build/publish.ts";
import { isGradleModProject } from "../../src/projects/gradleMod.ts";
import { listDrafts, readAppState, rememberProject, saveDraft, updateAppState } from "./appState.ts";
import { codeProjectInfo } from "./codeProject.ts";
import { markOwn, ownWrite, watchedDir, watchProject } from "./watch.ts";
import { machineInfo, suggestLight } from "../../src/performance.ts";
import {
  clientRunKey,
  type ClientRunOptions,
  type BuildEvent,
  type BuildExplained,
  type Element,
  type EngineInfo,
  type ExportResult,
  type PublishRun,
  type Localization,
  type ModInfo,
  type Opened,
  type Preferences,
  type ProjectSnapshot,
  type RecentProject,
  type TypeCatalog,
  type Variable,
} from "../shared/api.ts";

/**
 * Client runs by build-event key, one per engine and player (KUYRUK 190); undefined while the run is being prepared
 * (generation, dependencies), so a second start of the same key is refused.
 */
const clientRuns = new Map<string, GradleRun | undefined>();
/** Clients the user stopped: they end "stopped", not crashed (KUYRUK 154). */
const clientStopping = new Set<string>();
/** Element files of each project as the app last read them, to tell "deleted outside" from "new". */
const seenElements = new Map<string, Set<string>>();
export const DELETED_ON_DISK = "element deleted on disk";

export function registerIpc(): void {
  ipcMain.handle("project:openDialog", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, { properties: ["openDirectory"] });
    const dir = result.filePaths[0];
    return dir && (isProjectDir(dir) || isGradleModProject(dir)) ? opened(event.sender, dir) : null;
  });
  ipcMain.handle("project:open", (event, dir: string) => opened(event.sender, dir));
  ipcMain.handle("project:reload", (_e, dir: string) => snapshot(dir));
  // File > Open project folder (Q210): the window's own project folder only, never a path the renderer picks.
  ipcMain.handle("project:reveal", async (event, dir: string) => {
    const current = watchedDir(event.sender.id);
    if (!current || resolve(current) !== resolve(dir)) throw new Error("only the open project's folder");
    const failure = await shell.openPath(current);
    if (failure) throw new Error(failure);
  });
  ipcMain.handle("project:example", () => exampleProject());
  // File > New project (KUYRUK 126): the suggested parent folder, and the project made and opened.
  ipcMain.handle("project:newFolder", () => join(app.getPath("documents"), "MCEdge"));
  ipcMain.handle("project:create", (event, options: NewProject) => opened(event.sender, createProject(options)));
  // Template gallery (Q252): the verified starters, and one added to the open project.
  ipcMain.handle("starter:list", () => listStarters().map(({ id, type, params, elements }) => ({ id, type, params, elements })));
  ipcMain.handle("starter:add", (_e, dir: string, id: string, params: Record<string, string>) => {
    const result = applyStarter(dir, id, params);
    if (!result.applied) throw new Error([...result.errors.map((e) => e.message), ...result.newProblems.map((p) => `${p.path}: ${p.message}`)].join("; ") || "the starter was not added");
    markOwn([...result.changes.map((c) => { const [type, ...rest] = c.element.split("/"); return elementFile(dir, type, rest.join("/")); }), ...result.textures.map((t) => join(dir, t))]);
    // The element the card stands for opens first (the ore block, not its gem).
    const type = listStarters().find((s) => s.id === id)?.type;
    const [typeId, ...rest] = (result.changes.find((c) => c.element.startsWith(`${type}/`)) ?? result.changes[0]).element.split("/");
    return { snapshot: snapshot(dir), first: { typeId, id: rest.join("/") } };
  });
  // File > Import project from ZIP (KUYRUK 135): the zip extracted into a new folder under `parent`, then opened.
  ipcMain.handle("project:importZip", (event, zip: string, parent: string) => opened(event.sender, importWorkspace(zip, parent)));
  ipcMain.handle("dialog:zip", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, { properties: ["openFile"], filters: [{ name: "Zip", extensions: ["zip"] }] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("types:list", (_e, language: string): TypeCatalog => {
    const { types, problems } = typeRegistry();
    const integrations = loadIntegrations().integrations.map((def) => integrationInfo(def, language));
    return { types: localizeTypes(types, typeLabels(language)), problems, integrations };
  });
  ipcMain.handle("prefs:get", () => readAppState().preferences ?? null);
  ipcMain.handle("prefs:set", (event, preferences: Preferences) => {
    updateAppState((state) => (state.preferences = preferences));
    event.sender.setZoomFactor(preferences.fontScale);
  });
  ipcMain.handle("system:info", () => ({ ...machineInfo(), suggestLight: suggestLight(machineInfo()) }));
  ipcMain.handle("recent:list", () => recentProjects());
  ipcMain.handle("recent:remove", (_e, dir: string) => {
    updateAppState((state) => (state.recent = state.recent.filter((r) => r.dir !== dir)));
    return recentProjects();
  });
  ipcMain.handle("element:save", (_e, dir: string, typeId: string, element: Element, restore = false, base?: Element) => {
    const file = elementFile(dir, typeId, element.id);
    // A save that was already on its way when the element was deleted outside must not bring it back; the editor
    // asks the user, and a restore they chose passes `restore`.
    if (!restore && !existsSync(file) && seenElements.get(dir)?.has(file.toLowerCase())) throw new Error(DELETED_ON_DISK);
    // An outside write (an agent over MCP) the editor has not merged yet, because the file watcher had not reported it
    // when this save left, is merged here instead of being overwritten with the editor's older copy (KUYRUK 159).
    let merged: ProjectSnapshot["merged"];
    if (base && existsSync(file)) {
      const { $schema: _, ...disk } = JSON.parse(readFileSync(file, "utf8")) as Element & { $schema?: string };
      if (!same(disk, base)) {
        const result = merge3(base, element, disk as Element);
        element = result.value;
        merged = { taken: result.taken, conflicts: result.conflicts };
      }
    }
    saveElement(dir, typeId, element);
    markOwn([file]);
    return { ...snapshotWithElement(dir, typeId, element.id), ...(merged ? { merged } : {}) };
  });
  // What only the element used (Q220); the engine decides which translation keys the generator writes for it.
  ipcMain.handle("element:deletePlan", (_e, dir: string, typeId: string, id: string, engineId?: string) =>
    planDelete(dir, { type: typeId, id }, listEngines().find((e) => e.id === engineId)));
  ipcMain.handle("element:delete", (_e, dir: string, typeId: string, id: string, selection?: DeleteSelection, engineId?: string) => {
    const target = { type: typeId, id };
    const plan: DeletePlan = selection ? planDelete(dir, target, listEngines().find((e) => e.id === engineId)) : { element: target, elements: [], textures: [], models: [], langKeys: [] };
    markOwn(applyDelete(dir, plan, selection ?? {}).files);
    return snapshot(dir);
  });
  ipcMain.handle("references:find", (_e, dir: string, typeId: string, id: string) => referencesOf(findAllReferences(loadReferenceInput(dir)), { type: typeId, id }));
  ipcMain.handle("element:rename", (_e, dir: string, typeId: string, id: string, newId: string, dryRun = false) => {
    const outcome = renameElement(dir, typeId, id, newId, { dryRun });
    markOwn(outcome.written);
    return { result: renameSummary(outcome), snapshot: dryRun ? undefined : snapshot(dir) };
  });
  ipcMain.handle("references:unused", (_e, dir: string) => {
    const input = loadReferenceInput(dir);
    return unusedElements(input, findAllReferences(input));
  });
  ipcMain.handle("texture:read", (_e, dir: string, path: string) =>
    `data:image/png;base64,${readFileSync(insideProject(dir, path)).toString("base64")}`,
  );
  ipcMain.handle("vanilla:catalog", (_e, kind: PickerKind, minecraft?: string, language?: string) => vanillaCatalog(kind, minecraft, language));
  ipcMain.handle("vanilla:icons", (_e, kind: PickerKind, ids: string[], minecraft?: string) => vanillaIcons(kind, ids, minecraft));
  ipcMain.handle("mod:identity", (_e, dir: string, change: IdentityChange, dryRun = false) => {
    const { written, ...result } = changeModIdentity(dir, change, { dryRun });
    markOwn(written);
    return { result, snapshot: dryRun ? undefined : snapshot(dir) };
  });
  ipcMain.handle("mod:save", (_e, dir: string, mod: ModInfo) => (saveModInfo(dir, mod), markOwn([join(dir, "mcedge.json")]), snapshot(dir)));
  ipcMain.handle("tags:save", (_e, dir: string, tags: ElementTag[]) => (saveTags(dir, tags), markOwn([join(dir, "tags.json")]), snapshot(dir)));
  ipcMain.handle("folders:save", (_e, dir: string, folders: ProjectFolders) => (saveFolders(dir, folders), markOwn([join(dir, "folders.json")]), snapshot(dir)));
  ipcMain.handle("texture-folders:save", (_e, dir: string, folders: ProjectFolders) =>
    (saveTextureFolders(dir, folders), markOwn([join(dir, TEXTURE_FOLDERS_FILE)]), snapshot(dir)));
  ipcMain.handle("problems:update", (_e, dir: string, action: ProblemAction) =>
    (saveProblemSettings(dir, applyProblemAction(loadProblemSettings(dir), action)), markOwn([join(dir, PROBLEMS_FILE)]), snapshot(dir)));
  ipcMain.handle("variables:save", (_e, dir: string, variables: Variable[]) => (saveVariables(dir, variables), markOwn([join(dir, "variables.json")]), snapshot(dir)));
  ipcMain.handle("localization:save", (_e, dir: string, localization: Localization, removed: string[] = []) =>
    (saveLocalization(dir, localization, removed), markOwn([...Object.keys(localization), ...removed].map((lang) => join(dir, "localization", `${lang}.json`))), snapshot(dir)));
  ipcMain.handle("texture:import", async (event, dir: string, folder: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    const target = insideProject(dir, join("textures", folder));
    mkdirSync(target, { recursive: true });
    for (const file of result.filePaths) copyFileSync(file, join(target, basename(file).toLowerCase()));
    return snapshot(dir);
  });
  ipcMain.handle("texture:export", async (event, dir: string, path: string) => {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
      defaultPath: basename(path),
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    return result.canceled || !result.filePath ? undefined : exportTexture(dir, path, result.filePath)[0];
  });
  ipcMain.handle("texture:write", (_e, dir: string, path: string, base64: string) => {
    if (!/^textures\/[a-z0-9_./-]+\.png$/.test(path) || path.includes("..")) throw new Error(`invalid texture path: ${path}`);
    const file = insideProject(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    ownWrite(file, () => writeFileSync(file, Buffer.from(base64, "base64")));
    return snapshot(dir);
  });
  ipcMain.handle("texture:delete", (_e, dir: string, path: string) => {
    const project = loadProject(dir);
    const { byId } = typeRegistry();
    const used = Object.entries(project.elements).some(([typeId, list]) => {
      const type = byId.get(typeId);
      return !!type && list.some((e) => valuesOfType(typeFields(type), e, "texture").includes(path));
    });
    if (used || project.mod.logo === path) throw new Error(`texture in use: ${path}`);
    const file = insideProject(dir, path);
    rmSync(file);
    // The animation file beside a texture goes with it, or a new texture of that name would start animated.
    if (existsSync(`${file}.mcmeta`)) rmSync(`${file}.mcmeta`);
    return snapshot(dir);
  });
  ipcMain.handle("drafts:list", (_e, dir: string) => listDrafts(dir));
  ipcMain.handle("drafts:save", (_e, dir: string, path: string, text: string) => saveDraft(dir, path, text));
  ipcMain.handle("drafts:drop", (_e, dir: string, path: string) => saveDraft(dir, path, undefined));
  ipcMain.handle("engines:list", (): EngineInfo[] =>
    listEngines().map((engine) => ({ id: engine.id, name: engine.name, minecraft: engine.minecraft, loader: engine.loader, coverage: engineCoverage(engine) })),
  );
  ipcMain.handle("build:run", (event, dir: string, engineIds: string[]) => build(event.sender, dir, engineIds));
  // Q246: the errors of a failed build in plain words; an engine maps them back to elements (a code project has none).
  ipcMain.handle("build:explain", (_e, dir: string, engineId: string | undefined, lines: string[]): BuildExplained => {
    if (engineId) return explainBuild(dir, engineId, lines);
    const diagnostics = parseJavacDiagnostics(lines).filter((d) => d.severity === "error").map((d) => ({ ...d, explain: explainJavac(d.message, d.detail) }));
    return { diagnostics, failures: explainGradleFailures(lines) };
  });
  // Locked generated code per element and Build > Regenerate code (KUYRUK 131).
  ipcMain.handle("code:lock", (_e, dir: string, typeId: string, id: string) => (lockElementCode(loadProject(dir), dir, typeId, id), snapshot(dir)));
  ipcMain.handle("code:unlock", (_e, dir: string, typeId: string, id: string, force = false) => {
    const result = unlockElementCode(loadProject(dir), dir, typeId, id, force);
    return { unlocked: result.unlocked, changes: result.changes.filter((c) => c.status !== "same"), ...(result.unlocked ? { snapshot: snapshot(dir) } : {}) };
  });
  ipcMain.handle("code:regenerate", (event, dir: string, engineIds: string[]) => regenerate(event.sender, dir, engineIds));
  ipcMain.handle("deps:jars", async (_e, dir: string, options?: { resolve?: boolean; refresh?: boolean }) => {
    const deps = loadProject(dir).mod.dependencies;
    const out: Record<string, DependencyResolution[]> = {};
    for (const engine of listEngines()) out[engine.id] = options?.resolve ? await resolveModDependencies(deps, engine, { refresh: options.refresh }) : cachedModDependencies(deps, engine);
    return out;
  });
  ipcMain.handle("client:run", (event, dir: string, engineId: string, options?: ClientRunOptions) => run(event.sender, dir, engineId, options));
  ipcMain.handle("client:stop", (_e, key?: string) => {
    for (const [k, gradle] of clientRuns) if (!key || k === key) (clientStopping.add(k), gradle?.stop());
  });
  ipcMain.handle("localization:exportFile", async (event, name: string, text: string) => {
    const csv = name.endsWith(".csv");
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
      defaultPath: name, filters: [csv ? { name: "CSV", extensions: ["csv"] } : { name: "Lang JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return undefined;
    writeFileSync(result.filePath, text);
    return result.filePath;
  });
  ipcMain.handle("localization:importFile", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      properties: ["openFile"], filters: [{ name: "CSV / Lang JSON", extensions: ["csv", "json"] }],
    });
    const path = result.filePaths[0];
    return result.canceled || !path ? undefined : { path, text: readFileSync(path, "utf8") };
  });
  ipcMain.handle("localization:generatedKeys", (_e, dir: string, engineId: string) => {
    const engine = listEngines().find((e) => e.id === engineId);
    return engine ? generatedLangKeys(loadProject(dir), dir, engine) : {};
  });
  // The Problems tab's unused translation keys (Q222), rated by problems.json; computed on request, not with the snapshot.
  ipcMain.handle("translations:unused", (_e, dir: string, engineId?: string) =>
    classify(unusedIssues(projectUnusedTranslations(dir, listEngines().find((e) => e.id === engineId))), loadProblemSettings(dir)));
  ipcMain.handle("translations:removeUnused", (_e, dir: string, language: string, engineId?: string) => {
    removeUnusedTranslations(dir, listEngines().find((e) => e.id === engineId), [language]);
    markOwn([join(dir, "localization", `${language}.json`)]);
    return snapshot(dir);
  });
  ipcMain.handle("localization:hidden", (_e, dir: string) => readAppState().hiddenLanguages?.[dir] ?? []);
  ipcMain.handle("localization:setHidden", (_e, dir: string, codes: string[]) =>
    void updateAppState((state) => {
      state.hiddenLanguages = { ...state.hiddenLanguages, [dir]: codes };
      if (!codes.length) delete state.hiddenLanguages[dir];
    }));
  ipcMain.handle("ui:get", (_e, key: string) => readAppState().ui?.[key]);
  ipcMain.handle("ui:set", (_e, key: string, value: unknown) =>
    void updateAppState((state) => {
      state.ui = { ...state.ui, [key]: value };
      if (value === undefined) delete state.ui[key];
    }));
  ipcMain.handle("export:folder", (_e, dir: string) => readAppState().exportFolders[dir] ?? join(dir, "dist"));
  ipcMain.handle("dialog:folder", async (event, current: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, { defaultPath: current, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("export:changelog", (_e, dir: string) => changelogSinceExport(dir, loadProject(dir).mod.version));
  ipcMain.handle("export:run", (event, dir: string, engineIds: string[], folder: string, pattern: string) =>
    exportJars(event.sender, dir, engineIds, folder, pattern),
  );
  ipcMain.handle("export:publishCheck", (_e, dir: string, platforms: Platform[]) => publishProblems(dir, loadProject(dir).mod, platforms));
  ipcMain.handle("export:publish", (event, dir: string, engineIds: string[], folder: string, pattern: string, options: PublishOptions) =>
    publishJars(event.sender, dir, engineIds, folder, pattern, options),
  );
  ipcMain.handle("shell:open", async (_e, path: string) => {
    if (!existsSync(path)) throw new Error(`not found: ${path}`);
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  app.on("before-quit", () => clientRuns.forEach((gradle) => gradle?.stop()));
}

/**
 * The bundled example is copied to the user's data folder on first use: building writes out/ next to the
 * project, and an installed app's resources folder is read-only.
 */
function exampleProject(): string {
  const bundled = join(ROOT, "examples", "hello");
  if (!app.isPackaged) return bundled;
  const copy = join(app.getPath("userData"), "examples", "hello");
  if (!existsSync(copy)) cpSync(bundled, copy, { recursive: true });
  return copy;
}

/** Resolves a project-relative path and refuses anything that escapes the project folder. */
export function insideProject(dir: string, path: string): string {
  const file = resolve(dir, path);
  if (relative(dir, file).startsWith("..")) throw new Error("path outside project");
  return file;
}

/** A project opened from the welcome screen or File menu goes to the top of the recent list. */
function opened(sender: WebContents, dir: string): Opened {
  watchProject(sender, dir);
  if (!isProjectDir(dir) && isGradleModProject(dir)) {
    const project = codeProjectInfo(dir);
    rememberProject(dir, project.name, "code");
    return { kind: "code", project };
  }
  // A newer MCEdge brings the project's schemas up to date once here, not inside the first unrelated element edit.
  markOwn(refreshSchemas(dir).map((path) => join(dir, path)));
  const result = snapshot(dir);
  rememberProject(dir, result.project.mod.name);
  return { kind: "mcedge", snapshot: result };
}

function recentProjects(): RecentProject[] {
  return readAppState().recent.map((r) => ({
    ...r, missing: !existsSync(r.dir) || !(r.kind === "code" ? isGradleModProject(r.dir) : isProjectDir(r.dir)),
  }));
}

/** Optional per-language label overrides of element types (config/element-types/<language>.json). */
function typeLabels(language: string): TypeLabels {
  const file = join(ROOT, "config", "element-types", `${language}.json`);
  if (!/^[a-z]{2,3}$/.test(language) || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function snapshot(dir: string): ProjectSnapshot {
  const project = loadProject(dir);
  const tags = loadTags(dir);
  seenElements.set(dir, new Set(Object.entries(project.elements).flatMap(([typeId, list]) => list.map((e) => elementFile(dir, typeId, e.id).toLowerCase()))));
  const next: ProjectSnapshot = {
    dir, project, ...problems(project, tags, dir), textures: listPngs(dir), needsMigration: needsMigration(dir), tags,
    sounds: listResources(dir, "sound"), models: listResources(dir, "model"), structures: listResources(dir, "structure"),
    soundEvents: soundEvents(dir, project.mod.id, projectSoundFiles(dir)), animations: projectAnimations(dir),
    locked: lockedElements(dir).map((l) => `${l.type}/${l.id}`),
  };
  lastSnapshots.set(dir, next);
  return next;
}

/** The project's problems, shown and ignored as its problems.json says (KUYRUK 196). */
function problems(project: ModProject, tags: ElementTag[], dir: string): Pick<ProjectSnapshot, "issues" | "ignoredIssues"> {
  const { shown, ignored } = classify([...validateProject(project, dir), ...validateTags(tags, project)], loadProblemSettings(dir));
  return { issues: shown, ignoredIssues: ignored };
}

/** The last full snapshot of each project, kept up to date by the saves of single elements. */
const lastSnapshots = new Map<string, ProjectSnapshot>();

/**
 * The snapshot after one element was saved: the last snapshot with that element re-read from its file and the issues
 * validated again, instead of loading the whole project from disk. On ETREconomy (677 procedures) the full reload took
 * ~0.6 s of this (main) process after every autosave, which also held back input to the window (KUYRUK 185). Changes
 * from outside still come through the watcher, which reloads the whole project. A new element, a game rule (its rename
 * rewrites other elements) or a project that was just migrated take the full reload.
 */
function snapshotWithElement(dir: string, typeId: string, id: string): ProjectSnapshot {
  const last = lastSnapshots.get(dir);
  const list = last?.project.elements[typeId];
  const index = list?.findIndex((e) => e.id === id) ?? -1;
  const element = last && list && index >= 0 && typeId !== "game_rule" && !last.needsMigration ? loadElement(dir, typeId, id) : undefined;
  if (!last || !list || !element) return snapshot(dir);
  const project = { ...last.project, elements: { ...last.project.elements, [typeId]: list.with(index, element) } };
  const next: ProjectSnapshot = { ...last, project, ...problems(project, last.tags, dir) };
  lastSnapshots.set(dir, next);
  return next;
}

function listPngs(dir: string): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    // withFileTypes: the listing already says what is a folder, so only links are stat'ed, not 680 PNGs (Q280).
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const name = entry.name;
      if (name === "out" || name === "schemas" || name === LOCK_DIR || name.startsWith(".")) continue;
      const path = join(folder, name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(path).isDirectory())) walk(path);
      else if (name.endsWith(".png")) found.push(relative(dir, path).replaceAll("\\", "/"));
    }
  };
  walk(dir);
  return found.sort();
}

/** Build > Regenerate code: the engines' projects are generated again without a build; locked files stay as they are. */
async function regenerate(sender: WebContents, dir: string, engineIds: string[]): Promise<void> {
  const send = (event: BuildEvent) => sender.send("build:event", event);
  const project = loadProject(dir);
  const locked = lockedElements(dir);
  for (const engine of listEngines().filter((e) => engineIds.includes(e.id))) {
    send({ type: "start", engineId: engine.id });
    try {
      const { skipped, warnings } = generateTarget(project, dir, engine, join(dir, "out", engine.id));
      skipped.forEach((s) => send({ type: "line", engineId: engine.id, line: `[mcedge] skipped ${s.typeId}/${s.id}: ${s.reason}` }));
      warnings.forEach((w) => send({ type: "line", engineId: engine.id, line: `[mcedge] not generated: ${w}` }));
      for (const l of locked) {
        const files = l.engines.find((e) => e.engine === engine.id)?.files.length ?? 0;
        if (files) send({ type: "line", engineId: engine.id, line: `[mcedge] locked: ${l.type}/${l.id} keeps ${files} file(s)` });
      }
      send({ type: "line", engineId: engine.id, line: `[mcedge] regenerated out/${engine.id}` });
      send({ type: "done", engineId: engine.id, ok: true });
    } catch (error) {
      send({ type: "line", engineId: engine.id, line: `[mcedge] ${error instanceof Error ? error.message : String(error)}` });
      send({ type: "done", engineId: engine.id, ok: false });
    }
  }
}

/**
 * The build or export running now, so Build & run > Cancel task (KUYRUK 135) can stop its Gradle process and skip the
 * engines still waiting.
 */
const activeBuild: { run?: GradleRun; cancelled: boolean } = { cancelled: false };
export const buildRunning = () => !!activeBuild.run || clientRuns.size > 0;
export function cancelBuild(): boolean {
  if (!activeBuild.run) return false;
  activeBuild.cancelled = true;
  activeBuild.run.stop();
  return true;
}

async function build(sender: WebContents, dir: string, engineIds: string[]): Promise<void> {
  const send = (event: BuildEvent) => sender.send("build:event", event);
  const project = loadProject(dir);
  const engines = listEngines().filter((engine) => engineIds.includes(engine.id));
  activeBuild.cancelled = false;
  for (const engine of engines) {
    if (activeBuild.cancelled) {
      send({ type: "start", engineId: engine.id });
      send({ type: "line", engineId: engine.id, line: "[mcedge] cancelled" });
      send({ type: "done", engineId: engine.id, ok: false, stopped: true });
      continue;
    }
    send({ type: "start", engineId: engine.id });
    await ensureToolchains(toolchainNeeds(engine), (p) =>
      send({ type: "line", engineId: engine.id, line: `[mcedge] downloading ${p.kind} ${p.version}: ${Math.round(p.received / 1e6)} MB` }),
    );
    await resolveModDependencies(project.mod.dependencies, engine, { onLine: (l) => send({ type: "line", engineId: engine.id, line: l }) });
    const outDir = join(dir, "out", engine.id);
    const { skipped, warnings } = generateTarget(project, dir, engine, outDir);
    skipped.forEach((s) => send({ type: "line", engineId: engine.id, line: `[mcedge] skipped ${s.typeId}/${s.id}: ${s.reason}` }));
    warnings.forEach((w) => send({ type: "line", engineId: engine.id, line: `[mcedge] not generated: ${w}` }));
    const result = await buildTarget(engine, outDir, (line) => send({ type: "line", engineId: engine.id, line }), (r) => (activeBuild.run = r));
    activeBuild.run = undefined;
    send({ type: "done", engineId: engine.id, ok: result.ok && !!result.jar, jar: result.jar, ...(activeBuild.cancelled ? { stopped: true } : {}) });
  }
}

/**
 * Export: the same build as Build, one engine after another, then the jar is copied to the chosen folder
 * under the file name pattern. Progress goes out as build events, so the status bar and build panel follow it.
 */
async function exportJars(sender: WebContents, dir: string, engineIds: string[], folder: string, pattern: string): Promise<ExportResult[]> {
  updateAppState((state) => (state.exportFolders[dir] = folder));
  mkdirSync(folder, { recursive: true });
  const send = (event: BuildEvent) => sender.send("build:event", event);
  const project = loadProject(dir);
  const results: ExportResult[] = [];
  activeBuild.cancelled = false;
  for (const engine of listEngines().filter((e) => engineIds.includes(e.id))) {
    send({ type: "start", engineId: engine.id });
    if (activeBuild.cancelled) {
      send({ type: "line", engineId: engine.id, line: "[mcedge] cancelled" });
      results.push({ engineId: engine.id, ok: false, skipped: [], warnings: [] });
      send({ type: "done", engineId: engine.id, ok: false, stopped: true });
      continue;
    }
    try {
      await ensureToolchains(toolchainNeeds(engine), (p) =>
        send({ type: "line", engineId: engine.id, line: `[mcedge] downloading ${p.kind} ${p.version}: ${Math.round(p.received / 1e6)} MB` }),
      );
      await resolveModDependencies(project.mod.dependencies, engine, { onLine: (l) => send({ type: "line", engineId: engine.id, line: l }) });
      const outDir = join(dir, "out", engine.id);
      const { skipped, warnings } = generateTarget(project, dir, engine, outDir);
      skipped.forEach((s) => send({ type: "line", engineId: engine.id, line: `[mcedge] skipped ${s.typeId}/${s.id}: ${s.reason}` }));
      warnings.forEach((w) => send({ type: "line", engineId: engine.id, line: `[mcedge] not generated: ${w}` }));
      const result = await buildTarget(engine, outDir, (line) => send({ type: "line", engineId: engine.id, line }), (r) => (activeBuild.run = r));
      activeBuild.run = undefined;
      let jar: string | undefined;
      if (result.ok && result.jar) {
        jar = join(folder, exportFileName(pattern, {
          modid: project.mod.id, modversion: project.mod.version, loader: engine.loader, mc: engine.minecraft, engine: engine.id,
        }));
        copyFileSync(result.jar, jar);
      }
      results.push({ engineId: engine.id, ok: !!jar, jar, logFile: result.logFile, skipped, warnings });
      send({ type: "done", engineId: engine.id, ok: !!jar, jar });
    } catch (error) {
      send({ type: "line", engineId: engine.id, line: `[mcedge] ${error instanceof Error ? error.message : String(error)}` });
      results.push({ engineId: engine.id, ok: false, skipped: [], warnings: [] });
      send({ type: "done", engineId: engine.id, ok: false });
    }
  }
  // The next changelog starts here, but only when the whole batch built (KUYRUK 168).
  if (results.length && results.every((r) => r.ok)) {
    await recordExport(dir, project.mod.version);
    markOwn([join(dir, LAST_EXPORT)]);
  }
  return results;
}

/**
 * Export with publishing (Q238): the checks first (projects, tokens, an untagged version), then the export builds, then
 * the gate and uploads. Each step runs only when the one before passed for every engine, so a failure uploads nothing.
 */
async function publishJars(sender: WebContents, dir: string, engineIds: string[], folder: string, pattern: string, options: PublishOptions): Promise<PublishRun> {
  const mod = loadProject(dir).mod;
  const problems = await publishProblems(dir, mod, options.platforms);
  if (problems.length) return { problems, results: [] };
  const results = await exportJars(sender, dir, engineIds, folder, pattern);
  if (!results.length || results.some((r) => !r.ok)) return { problems, results };
  const engines = listEngines();
  const built = results.map((r) => ({ engine: engines.find((e) => e.id === r.engineId)!, jar: r.jar!, projectDir: join(dir, "out", r.engineId) }));
  const line = (engineId: string, text: string) => sender.send("build:event", { type: "line", engineId, line: text } satisfies BuildEvent);
  return { problems, results, outcome: await gateAndUpload(dir, mod, built, options, line) };
}

/**
 * A client of an engine as a player (default Dev), optionally joining the engine's test server. Clients with other
 * player names may run at the same time (KUYRUK 190): each has its own key, init script and log, and they share the
 * Gradle project and run/ folder. Only the first client of an engine generates the project; later ones start from it
 * as it is, so a running game's build is never changed under it.
 */
async function run(sender: WebContents, dir: string, engineId: string, options: ClientRunOptions = {}): Promise<void> {
  const engine = listEngines().find((e) => e.id === engineId);
  const player = options.player ?? DEFAULT_PLAYER;
  const key = clientRunKey(engineId, player);
  if (!engine || !isPlayerName(player) || clientRuns.has(key)) return;
  const first = ![...clientRuns.keys()].some((k) => k.startsWith(clientRunKey(engineId)));
  clientRuns.set(key, undefined);
  clientStopping.delete(key);
  const send = (event: BuildEvent) => sender.send("build:event", event);
  const line = (text: string) => send({ type: "line", engineId: key, line: text });
  send({ type: "start", engineId: key });
  try {
    await ensureToolchains(toolchainNeeds(engine));
    const outDir = join(dir, "out", engine.id);
    if (first) {
      await resolveModDependencies(loadProject(dir).mod.dependencies, engine, { onLine: line });
      generateTarget(loadProject(dir), dir, engine, outDir);
    }
    // UI tests start the app with MCEDGE_MUTE_CLIENTS=1; the user's own runs keep their sound.
    if (process.env.MCEDGE_MUTE_CLIENTS === "1") muteClient(outDir);
    const setup = engineSetup(engine, outDir);
    const tasks = clientTasks(setup, engine.minecraft, { player, join: options.join });
    line(`[mcedge] player ${player}${options.join ? `, joining the test server on port ${testServerPort(outDir)}` : ""}`);
    const gradle = runGradle(setup, tasks, logPath(setup, clientLogName(player)), line);
    clientRuns.set(key, gradle);
    if (clientStopping.has(key)) gradle.stop();
    const exitCode = await gradle.done;
    send({ type: "done", engineId: key, ok: exitCode === 0, stopped: clientStopping.delete(key) });
  } catch (error) {
    line(`[mcedge] ${error instanceof Error ? error.message : String(error)}`);
    send({ type: "done", engineId: key, ok: false, stopped: clientStopping.delete(key) });
  } finally {
    clientRuns.delete(key);
  }
}

/** File of an element: elements/<type folder>/<id>.json. */
function elementFile(dir: string, typeId: string, id: string): string {
  return join(dir, "elements", typeRegistry().byId.get(typeId)?.folder ?? typeId, `${id}.json`);
}