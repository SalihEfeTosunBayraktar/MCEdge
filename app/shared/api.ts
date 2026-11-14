import type { ProjectFolders } from "../../src/ir/folders.ts";
import type { Element, ElementType } from "../../src/elements/model.ts";
import type { IntegrationInfo } from "../../src/elements/integrations.ts";
import type { Coverage } from "../../src/engines/coverage.ts";
import type { DependencyResolution } from "../../src/build/modDependencies.ts";
import type { PickerKind, VanillaCatalog } from "../../src/resources/vanillaAssets.ts";
import type { LockedFileChange } from "../../src/generator/lockedCode.ts";
import type { NewProject } from "../../src/ir/createProject.ts";
import type { ModInfo, ModProject, Variable } from "../../src/ir/types.ts";
import type { ValidationIssue } from "../../src/ir/validate.ts";
import type { ProblemAction } from "../../src/ir/problems.ts";
import type { Reference, ReferenceReport, UnusedReport } from "../../src/ir/references.ts";
import type { IdentityChange, IdentityResult } from "../../src/ir/modIdentity.ts";
import type { RenameResult } from "../../src/ir/rename.ts";
import { DEFAULT_PLAYER } from "../../src/build/players.ts";

export type { Coverage, Element, PickerKind, VanillaCatalog, ElementType, IdentityChange, IdentityResult, ModInfo, Reference, ReferenceReport, RenameResult, UnusedReport, ValidationIssue, Variable };
export type Localization = ModProject["localization"];

/** Element types of this MCEdge (element-types/), plus type.json files that failed to load. */
export interface TypeCatalog {
  types: ElementType[];
  problems: string[];
  /** Optional mod integrations a project can turn on in its mod settings (config/integrations). */
  integrations: IntegrationInfo[];
}

export interface ProjectSnapshot {
  dir: string;
  project: ModProject;
  /** Problems with their severity, without the ignored ones (problems.json, KUYRUK 196). */
  issues: ValidationIssue[];
  ignoredIssues: ValidationIssue[];
  /** Project-relative PNG paths available as textures. */
  textures: string[];
  /** Imported sounds (sounds/*.ogg), models (models/*) and structure templates (structures/*.nbt). */
  sounds: string[];
  models: string[];
  structures: string[];
  /** Sound events: one per sound file, or as sound_events.json lists them (KUYRUK 132). */
  soundEvents: SoundEvent[];
  /** Model animations in models/ (Blockbench Java animation exports, .bbmodel animations). */
  animations: AnimationSource[];
  /** Element tags (tags.json). */
  tags: ElementTag[];
  /** "typeId/id" of elements whose generated code is locked (KUYRUK 131). */
  locked: string[];
  /** The project uses an older layout; the next save rewrites it in the current one. */
  needsMigration: boolean;
  /** Only from saveElement with a base: the save met an outside change not merged yet and merged it (KUYRUK 159). */
  merged?: { taken: string[]; conflicts: string[] };
}

export interface EngineInfo {
  id: string;
  name: string;
  minecraft: string;
  loader: string;
  /** Element types and fields the engine generates (layer.json "generates"). */
  coverage: Coverage;
}

/** Build-event key of a Gradle run that is not a build: the game client, a server, or a console command. */
export const runKey = (engineId: string, kind: "client" | "server" | "gradle") => `${engineId} ${kind}`;
/**
 * Build-event key of a client run of an engine: "<engine> client" for Dev, "<engine> client <player>" for the other
 * players, so several clients of one engine run side by side (KUYRUK 190).
 */
export const clientRunKey = (engineId: string, player = DEFAULT_PLAYER) =>
  player === DEFAULT_PLAYER ? runKey(engineId, "client") : `${runKey(engineId, "client")} ${player}`;
/** Player of a client run key, undefined for any other key. */
export const clientRunPlayer = (key: string) => {
  const match = / client(?: (\w+))?$/.exec(key);
  return match ? (match[1] ?? DEFAULT_PLAYER) : undefined;
};
/** Keys of client, server and console runs, which are not builds (they end non-zero when stopped). */
export const isRunKey = (key: string) => / (server|gradle)$/.test(key) || clientRunPlayer(key) !== undefined;

/** A client run (KUYRUK 190): its player name (default Dev) and whether it joins the engine's test server. */
export interface ClientRunOptions {
  player?: string;
  join?: boolean;
}

/** Gradle work besides build and run: Tools > Gradle console, Reload Gradle project, Debug client, Run server. */
export type GradleMode = "console" | "reload" | "debug" | "server";
export type { ResourceKind } from "../../src/resources/files.ts";
import type { SoundEventChange } from "../../src/resources/soundEvents.ts";
import type { SoundEvent } from "../../src/resources/soundEventTypes.ts";
import type { AnimationSource } from "../../src/generator/mob/models.ts";
export type { SoundEvent, SoundEventChange, AnimationSource };
import type { PackKind, PackOptions, PackPreview } from "../../src/ir/packs.ts";
export type { PackKind, PackOptions, PackPreview };
export type { GitBranch, GitCommit, GitFile, GitLogCommit, GitStatus } from "../../src/vcs/git.ts";
import type { ElementTag } from "../../src/tags/tags.ts";
export type { ElementTag };
import type { ActivityEntry, FileChange, Presence } from "../../src/live/activity.ts";
import type { AgentNote } from "../../src/live/notes.ts";
import type { AgentTask, TaskSource } from "../../src/live/tasks.ts";
import type { UndoConflict, UndoResult } from "../../src/live/timeline.ts";
import type { ShowRequest } from "../../src/live/show.ts";
export type { ActivityEntry, AgentNote, AgentTask, FileChange, Presence, TaskSource, UndoConflict, UndoResult };

/** What the app shows of an AI agent working on the project (.mcedge/live). */
export interface LiveState {
  entries: ActivityEntry[];
  agent?: Presence;
  notes?: AgentNote[];
  /** A screen an agent asked the app to show (editor_screenshot, KUYRUK 153). */
  show?: ShowRequest;
}
import type { GitBranch, GitLogCommit, GitStatus } from "../../src/vcs/git.ts";
import type { ResourceKind } from "../../src/resources/files.ts";

export interface ResourceImport {
  snapshot: ProjectSnapshot;
  /** Project-relative paths written. */
  imported: string[];
  /** Parts of a model that could not be converted. */
  warnings: string[];
}

/** A plain Gradle mod opened in code project mode. */
export interface CodeProjectInfo {
  dir: string;
  name: string;
  /** JDK feature version its Gradle runs on. */
  jdk: number;
  /** The project has its own gradlew; without it MCEdge cannot build it. */
  wrapper: boolean;
}

export interface CodeFile {
  /** Project-relative, forward slashes. */
  path: string;
  folder: boolean;
  depth: number;
}

/** What File > Open project or a recent entry opened: an MCEdge project or a Gradle mod in code mode. */
export type Opened = { kind: "mcedge"; snapshot: ProjectSnapshot } | { kind: "code"; project: CodeProjectInfo };

/** Build-event keys of the open code project. */
export const codeRunKey = (kind: "build" | "client") => (kind === "build" ? "gradle mod" : "gradle mod client");

/** Files changed on disk by someone else (an AI agent over MCP, an editor, git), project-relative. */
export interface FsChange {
  dir: string;
  paths: string[];
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

/**
 * How an AI agent starts this app's MCP server (Q201): `command` with `args` and then `mcp <project folder>`, with
 * `env` set. The exe runs as plain Node on the bundled CLI, so the agent's machine needs no Node.js or sources.
 */
export interface McpCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** The portable exe: it unpacks to a temporary folder deleted when it closes, so agents need the installed app. */
  portable: boolean;
}

/** App preferences of this computer (userData), applied live. */
export interface Preferences {
  /** UI language code with a file in config/ui-strings/ ("en", "tr"). */
  language: string;
  theme: "dark" | "light";
  /** Zoom factor of the whole window: text size. */
  fontScale: number;
  uiFont: string;
  codeFont: string;
  /** Blockbench program for Edit in Blockbench (KUYRUK 171); empty: the usual install places. */
  blockbenchPath?: string;
  /** CurseForge API key for dependency jars (KUYRUK 173): this computer's, never stored in a project. */
  curseforgeKey?: string;
}

/** Result of Edit in Blockbench: started on the work copy, or not found where it was looked for. */
export type BlockbenchOpen =
  | { ok: true; exe: string; file: string; textures: string[] }
  | { ok: false; searched: string[] };

export interface UpdateCheck {
  /** "available": a newer release; "latest": this is the newest; "failed": the release list could not be read. */
  status: "available" | "latest" | "failed";
  current: string;
  latest?: string;
  url?: string;
  /** What happens with an available update: the installed build downloads it, the portable and dev builds link to it. */
  install?: "download" | "manual";
  message?: string;
}

export interface RecentProject {
  dir: string;
  name: string;
  /** ISO time. */
  openedAt: string;
  /** The folder is gone or no longer an MCEdge project. */
  missing?: boolean;
  /** A Gradle mod opened in code project mode. */
  kind?: "code";
}

/** Outcome of exporting one engine's jar. */
export interface ExportResult {
  engineId: string;
  ok: boolean;
  /** Path of the copied jar in the export folder. */
  jar?: string;
  /** Gradle log of the build, for "Open log". */
  logFile?: string;
  /** Elements left out of this engine's jar because their type or a field value is not generated yet. */
  skipped: { typeId: string; id: string; reason: string }[];
  /** Parts left out of generated elements: procedure blocks or triggers this engine does not generate. */
  warnings: string[];
}

export type BuildEvent =
  | { type: "start"; engineId: string }
  | { type: "line"; engineId: string; line: string }
  | { type: "done"; engineId: string; ok: boolean; jar?: string; stopped?: boolean };

/** API the preload script exposes to the renderer as window.mcedge. */
export interface McedgeApi {
  /** Folder picker; an MCEdge project or a Gradle mod (code mode), null for anything else or cancel. */
  openProjectDialog(): Promise<Opened | null>;
  /** Folder File > New project suggests for new projects (Documents/MCEdge). */
  newProjectFolder(): Promise<string>;
  /** File > Import project from ZIP (KUYRUK 135): extracts a workspace zip into a new folder under `parent` and opens it. */
  importProjectZip(zip: string, parent: string): Promise<Opened>;
  pickZip(): Promise<string | null>;
  /** Makes a new project (KUYRUK 126) and opens it; fails with the reason (bad id, folder not empty...). */
  createProject(options: NewProject): Promise<Opened>;
  /** Opens a folder and starts watching it for outside changes (fs:changed). */
  openProject(dir: string): Promise<Opened>;
  /** Re-reads the project after outside changes. */
  reloadProject(dir: string): Promise<ProjectSnapshot>;
  onFsChange(listener: (change: FsChange) => void): () => void;
  codeTree(dir: string): Promise<CodeFile[]>;
  codeRead(dir: string, path: string): Promise<{ text: string; binary: boolean; size: number }>;
  codeWrite(dir: string, path: string, text: string): Promise<void>;
  codeCreate(dir: string, path: string, folder: boolean): Promise<CodeFile[]>;
  codeDelete(dir: string, path: string): Promise<CodeFile[]>;
  /** Builds with the project's own wrapper; resolves with the jar path when it worked. */
  codeBuild(dir: string): Promise<string | undefined>;
  codeRun(dir: string): Promise<void>;
  codeStop(): Promise<void>;
  /** Builds, then copies the jar where the user picks; the copied path or null. */
  codeExport(dir: string): Promise<string | null>;
  gitStatus(dir: string): Promise<GitStatus>;
  gitInit(dir: string): Promise<GitStatus>;
  /** Diff of one file; staged=true for what is staged. */
  gitDiff(dir: string, path: string, staged: boolean): Promise<string>;
  gitStage(dir: string, paths: string[]): Promise<GitStatus>;
  gitUnstage(dir: string, paths: string[]): Promise<GitStatus>;
  /** Drops working-tree changes; untracked files are deleted. */
  gitDiscard(dir: string, paths: string[]): Promise<GitStatus>;
  /** Commits the staged changes, or all of them; with `branch`, on that new branch (created and switched to first). */
  gitCommit(dir: string, message: string, all: boolean, branch?: string): Promise<GitStatus>;
  /** Local branches, the checked-out one marked current. */
  gitBranches(dir: string): Promise<GitBranch[]>;
  /** Creates a branch from the current commit and switches to it; uncommitted changes go along. */
  gitCreateBranch(dir: string, name: string): Promise<GitStatus>;
  /** Switches branch; git refuses when uncommitted changes would be overwritten. */
  gitSwitchBranch(dir: string, name: string): Promise<GitStatus>;
  /** Newest first, parents and refs included; `all` lists every branch and tag (the History graph). */
  gitLog(dir: string, limit?: number, all?: boolean): Promise<GitLogCommit[]>;
  gitShow(dir: string, hash: string): Promise<string>;
  gitRevert(dir: string, hash: string): Promise<GitStatus>;
  gitPull(dir: string): Promise<{ output: string; status: GitStatus }>;
  gitPush(dir: string): Promise<{ output: string; status: GitStatus }>;
  /** Recent agent activity and presence. */
  liveState(dir: string): Promise<LiveState>;
  /** Tells an agent (collaborators tool) what the user has open. */
  livePresence(dir: string, open: string, shown?: { id: string; error?: string }): Promise<void>;
  /** Takes agent calls back (a step or a session); refused with conflicts when the user changed the same fields since. */
  liveUndo(dir: string, calls: string[]): Promise<UndoResult>;
  /** Leaves a note for the agent (read_notes over MCP); returns all notes. */
  addAgentNote(dir: string, text: string, target?: string): Promise<AgentNote[]>;
  deleteAgentNote(dir: string, id: string): Promise<AgentNote[]>;
  /** Tasks for the agent in .mcedge/tasks (KUYRUK 146), oldest first. */
  agentTasks(dir: string): Promise<AgentTask[]>;
  createAgentTask(dir: string, input: { title: string; detail?: string; source: TaskSource }): Promise<AgentTask>;
  /** Accepts a done task, or reopens it with what is still missing. */
  reviewAgentTask(dir: string, id: string, verdict: "accepted" | "reopened", comment?: string): Promise<AgentTask>;
  deleteAgentTask(dir: string, id: string): Promise<void>;
  exampleProjectDir(): Promise<string>;
  /** Element types; labels overridden for the language when config/element-types/<language>.json exists. */
  elementTypes(language: string): Promise<TypeCatalog>;
  /** Saved preferences, or null before the first change. */
  getPreferences(): Promise<Preferences | null>;
  /** Saves preferences and applies the text size to the window. */
  setPreferences(preferences: Preferences): Promise<void>;
  recentProjects(): Promise<RecentProject[]>;
  removeRecentProject(dir: string): Promise<RecentProject[]>;
  /** Writes elements/<type folder>/<id>.json. */
  /** Refused when the element file was deleted on disk since the app read it, unless `restore` (the user chose to bring it back). */
  /**
   * Writes an element. With `base` (what the editor last loaded or saved) a file changed on disk since then (an agent's
   * write the editor has not merged yet) is merged three ways instead of overwritten (KUYRUK 159).
   */
  saveElement(dir: string, typeId: string, element: Element, restore?: boolean, base?: Element): Promise<ProjectSnapshot>;
  /** Removes one element file. */
  deleteElement(dir: string, typeId: string, id: string): Promise<ProjectSnapshot>;
  /** Who uses an element and what it uses (src/ir/references.ts). */
  findReferences(dir: string, typeId: string, id: string): Promise<ReferenceReport>;
  /** Renames an element and everything that names it; `dryRun` only reports. The snapshot comes back when it was written. */
  renameElement(dir: string, typeId: string, id: string, newId: string, dryRun?: boolean): Promise<{ result: RenameResult; snapshot?: ProjectSnapshot }>;
  /** Procedures and GUIs nothing uses; nothing is deleted. */
  unusedElements(dir: string): Promise<UnusedReport>;
  readTexture(dir: string, path: string): Promise<string>;
  /** Vanilla ids, game names and tags for the item/block/entity picker, from a client jar Gradle downloaded (KUYRUK 127). */
  vanillaCatalog(kind: PickerKind, minecraft?: string, language?: string): Promise<VanillaCatalog>;
  /** PNG data URLs of vanilla ids; null where there is no picture (or no client jar yet). */
  vanillaIcons(kind: PickerKind, ids: string[], minecraft?: string): Promise<Record<string, string | null>>;
  saveModInfo(dir: string, mod: ModInfo): Promise<ProjectSnapshot>;
  /** Changes the mod id and/or package and rewrites what names them (src/ir/modIdentity.ts); `dryRun` only reports. */
  changeModIdentity(dir: string, change: IdentityChange, dryRun?: boolean): Promise<{ result: IdentityResult; snapshot?: ProjectSnapshot }>;
  /** Replaces the element tags (tags.json). */
  saveTags(dir: string, tags: ElementTag[]): Promise<ProjectSnapshot>;
  saveVariables(dir: string, variables: Variable[]): Promise<ProjectSnapshot>;
  /** Ignores or stops ignoring a problem or check, or sets a check's severity, in problems.json (KUYRUK 196). */
  updateProblems(dir: string, action: ProblemAction): Promise<ProjectSnapshot>;
  saveFolders(dir: string, folders: ProjectFolders): Promise<ProjectSnapshot>;
  /** Writes texture-folders.json, the folders of Resources > Textures (KUYRUK 177). */
  saveTextureFolders(dir: string, folders: ProjectFolders): Promise<ProjectSnapshot>;
  /** Writes the language files; `removed` codes (removed or renamed languages) lose their file. */
  saveLocalization(dir: string, localization: Localization, removed?: string[]): Promise<ProjectSnapshot>;
  /** Copies user-picked PNGs into textures/<folder>/ and returns the new snapshot. */
  importTextures(dir: string, folder: string): Promise<ProjectSnapshot>;
  /** Writes a PNG (base64) to a project path under textures/, creating folders; used by the texture editor. */
  writeTexture(dir: string, path: string, base64: string): Promise<ProjectSnapshot>;
  /** Deletes a project texture; refused while an element or the logo still uses it. */
  deleteTexture(dir: string, path: string): Promise<ProjectSnapshot>;
  /** Unsaved texture editor work, kept in the user data folder: one opaque text per texture path. */
  listDrafts(dir: string): Promise<Record<string, string>>;
  saveDraft(dir: string, path: string, text: string): Promise<void>;
  dropDraft(dir: string, path: string): Promise<void>;
  /** Asks where to save a texture and copies it there; the saved file, or undefined when cancelled. */
  exportTexture(dir: string, path: string): Promise<string | undefined>;
  listEngines(): Promise<EngineInfo[]>;
  build(dir: string, engineIds: string[]): Promise<void>;
  /** Locks an element's generated code (its own files are kept in locked-code/ and used by every generation). */
  lockCode(dir: string, typeId: string, id: string): Promise<ProjectSnapshot>;
  /** Unlocks; with edited locked files and no `force` it stays locked and returns what would be lost. */
  unlockCode(dir: string, typeId: string, id: string, force?: boolean): Promise<{ unlocked: boolean; changes: LockedFileChange[]; snapshot?: ProjectSnapshot }>;
  /** Build > Regenerate code: generates the engines without building; progress arrives as build events. */
  regenerate(dir: string, engineIds: string[]): Promise<void>;
  /**
   * Jars dev runs load for the project's dependencies (KUYRUK 152), by engine id: from the local cache, or resolved
   * and downloaded first with `resolve` (refresh also looks for newer versions). For the Dependencies tab.
   */
  dependencyJars(dir: string, options?: { resolve?: boolean; refresh?: boolean }): Promise<Record<string, DependencyResolution[]>>;
  /**
   * Generates the project and launches the engine's Minecraft client; log lines arrive as build events under
   * clientRunKey(engineId, player). Clients with other player names may run at the same time (KUYRUK 190).
   */
  runClient(dir: string, engineId: string, options?: ClientRunOptions): Promise<void>;
  /** Stops the client run of this key (clientRunKey), or every client run without one. */
  stopClient(key?: string): Promise<void>;
  onBuildEvent(listener: (event: BuildEvent) => void): () => void;
  /** Last export folder of the project, or <project>/dist. */
  exportFolder(dir: string): Promise<string>;
  /** Asks where to save an exported translation file (name: suggested file name, .csv or .json); undefined when cancelled. */
  exportTranslations(name: string, text: string): Promise<string | undefined>;
  /** Asks for a CSV or lang JSON file to import and reads it; undefined when cancelled. */
  importTranslations(): Promise<{ path: string; text: string } | undefined>;
  /** Lang keys the generator writes for the project's elements on an engine, by key, with the element (KUYRUK 117). */
  generatedLangKeys(dir: string, engineId: string): Promise<Record<string, import("../../src/ir/localization.ts").ElementKey>>;
  /** Language columns the Localization screen hides in this project (kept in the app state, not the project). */
  hiddenLanguages(dir: string): Promise<string[]>;
  setHiddenLanguages(dir: string, codes: string[]): Promise<void>;
  /** A remembered view setting (kept in the app state, not the project): element list view, open editor tabs. */
  uiState(key: string): Promise<unknown>;
  setUiState(key: string, value: unknown): Promise<void>;
  /** Folder picker; null when cancelled. */
  pickFolder(current: string): Promise<string | null>;
  /** Commits since the last export whose engines all built, as an editable changelog (KUYRUK 168). */
  exportChangelog(dir: string): Promise<import("../../src/vcs/changelog.ts").Changelog>;
  /** Opens a project JSON model with its textures in Blockbench; its saves come back into the project (KUYRUK 171). */
  editInBlockbench(dir: string, model: string, overrides?: Record<string, string>): Promise<BlockbenchOpen>;
  /** The Blockbench program Edit in Blockbench would start (the given path or the usual install places), or null. */
  findBlockbench(configured?: string): Promise<string | null>;
  /** Program picker; null when cancelled. */
  pickProgram(current: string): Promise<string | null>;
  /** Builds the engines one after another and copies each jar to the folder under the file name pattern; when all build, the changelog starts again from here. */
  exportJars(dir: string, engineIds: string[], folder: string, pattern: string): Promise<ExportResult[]>;
  /** Opens a file or folder with the system's default app (export folder, build log). */
  openPath(path: string): Promise<void>;
  /** Copies picked .ogg sounds, models (a .bbmodel is converted to a JSON model) or .nbt structures into the project; null when cancelled. */
  importResources(dir: string, kind: ResourceKind): Promise<ResourceImport | null>;
  /** Deletes an imported sound, model or structure; refused while an element names it. */
  deleteResource(dir: string, path: string): Promise<ProjectSnapshot>;
  /** Writes a sound event (renamed from `previous`) and its subtitle text (KUYRUK 132). */
  saveSoundEvent(dir: string, change: SoundEventChange, previous?: string): Promise<ProjectSnapshot>;
  /** Removes a listed sound event; its files become events of their own names again. */
  deleteSoundEvent(dir: string, name: string): Promise<ProjectSnapshot>;
  /** Tools > Create pack (KUYRUK 134): what a pack makes, then making it. */
  planPack(dir: string, options: PackOptions): Promise<PackPreview>;
  createPack(dir: string, options: PackOptions): Promise<ProjectSnapshot>;
  /** A project sound as a data URL for playback. */
  readSound(dir: string, path: string): Promise<string>;
  /** Gradle console command, project reload, debug client or server of an engine; output arrives as build events. */
  runGradle(dir: string, engineId: string, mode: GradleMode, args?: string[]): Promise<void>;
  /** Stops a run started by runGradle, by its build-event key. */
  stopGradle(key: string): Promise<void>;
  /** Build & run > Cancel task (KUYRUK 135): stops the running build or export and Gradle console runs; false when none ran. */
  cancelGradle(): Promise<boolean>;
  /** Build & run > Clear Gradle caches: removes out/<engine>/build and .gradle; returns what was removed. */
  clearGradleCaches(dir: string): Promise<string[]>;
  /** Zips the project (without generated folders) to a file the user picks; null when cancelled. */
  exportWorkspace(dir: string): Promise<{ file: string; count: number } | null>;
  appInfo(): Promise<AppInfo>;
  /** Help > Connect an AI agent: the command that starts this app's MCP server. */
  mcpCommand(): Promise<McpCommand>;
  /** Opens an https link in the default browser. */
  openExternal(url: string): Promise<void>;
  /** Markdown files of docs/ with their first heading. */
  /** Pages of the user guide (docs/guide/<language>), in order. */
  listDocs(language: string): Promise<{ file: string; title: string }[]>;
  readDoc(language: string, file: string): Promise<string>;
  /** Help > Check for updates: compares with the latest GitHub release; an installed build starts downloading it. */
  checkUpdates(): Promise<UpdateCheck>;
  /** Recolors the window-controls overlay drawn over the menu bar. */
  setTitleBarTheme(theme: "dark" | "light"): Promise<void>;
}
