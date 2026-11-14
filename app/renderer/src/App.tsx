import { useEffect, useRef, useState } from "react";
import {
  clientRunKey, clientRunPlayer, codeRunKey, isRunKey, runKey, type AgentTask, type ClientRunOptions, type CodeProjectInfo, type EngineInfo, type LiveState, type TaskSource, type Opened, type Preferences, type ProjectSnapshot, type ResourceKind,
} from "../../shared/api.ts";
import { CodeWorkspace } from "./code/CodeWorkspace.tsx";
import { api } from "./api.ts";
import type { Commands } from "./commands.ts";
import { BottomPanel, type PanelId } from "./components/BottomPanel.tsx";
import { ElementEditor } from "./components/ElementEditor.tsx";
import { ExportDialog } from "./components/ExportDialog.tsx";
import { NewTaskDialog } from "./components/AgentTasks.tsx";
import { LocalizationView } from "./components/LocalizationView.tsx";
import { MenuBar } from "./components/MenuBar.tsx";
import { CODE_SECTIONS, Rail, type Section } from "./components/Rail.tsx";
import { GitView } from "./git/GitView.tsx";
import { ResourcesView } from "./components/ResourcesView.tsx";
import { SettingsView } from "./components/SettingsView.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TagsView } from "./components/TagsView.tsx";
import { VariablesView } from "./components/VariablesView.tsx";
import { Welcome } from "./components/Welcome.tsx";
import { Workspace } from "./components/Workspace.tsx";
import { allElements, elementName, findElement, type ElementRef, type EngineBuild } from "./model.ts";
import { applyPreferences, DEFAULT_PREFERENCES } from "./preferences.ts";
import { agentFocus } from "./live/timeline.ts";
import { parseScreen, SHOW_FRESH_MS } from "../../../src/live/screen.ts";
import { PreferencesDialog } from "./components/PreferencesView.tsx";
import { NewProjectDialog } from "./components/NewProjectDialog.tsx";
import { SectionName } from "./components/ui.tsx";
import { setTypeCatalog } from "./types.ts";
import { restoreDrafts } from "./textures/drafts.ts";
import { t } from "./strings.ts";
import { NewTextureDialog } from "./textures/NewTextureDialog.tsx";
import { CreatePackDialog } from "./components/CreatePackDialog.tsx";
import { DataListsDialog, GradleTaskDialog, ImportZipDialog, RunClientDialog } from "./components/ToolDialogs.tsx";
import { nextPlayer } from "../../../src/build/players.ts";
import { TextureEditor } from "./textures/TextureEditor.tsx";
import { invalidateTexture } from "./hooks/useTexture.ts";
import { AboutDialog, ConnectAgentDialog, DocsDialog, KeyboardShortcutsDialog, NoticeDialog, UpdateDialog, type Notice } from "./components/HelpDialogs.tsx";
import type { ResourceTab } from "./components/ResourcesView.tsx";
import { QuickOpen } from "./components/QuickOpen.tsx";
import { reveal } from "./hooks/reveal.ts";
import type { QuickItem } from "../../../src/ir/quickSearch.ts";
import { EditorTabs, elementTab, parseTab, tabExists, textureTab, type TabKey } from "./components/EditorTabs.tsx";

/** Where the theme lived before preferences moved to the user data folder; read once as the starting theme. */
const LEGACY_THEME_KEY = "mcedge.theme";

export function App() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [openError, setOpenError] = useState(false);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [engineId, setEngineId] = useState("");
  const [open, setOpen] = useState<ElementRef>();
  /** Elements an editor opened another one from (a procedure from its field): Back returns to them in turn. */
  const [backTo, setBackTo] = useState<ElementRef[]>([]);
  useEffect(() => void (!open && setBackTo([])), [open]);
  const [selected, setSelected] = useState<ElementRef>();
  const [usage, setUsage] = useState<string>();
  const [section, setSection] = useState<Section>("elements");
  const [panel, setPanel] = useState<PanelId>();
  const [builds, setBuilds] = useState<Record<string, EngineBuild>>({});
  const [preferences, setPreferencesState] = useState<Preferences>();
  const [typesLoaded, setTypesLoaded] = useState<string>();
  const [exporting, setExporting] = useState(false);
  /** Texture open in the texture editor, which then replaces the section view. */
  const [painting, setPainting] = useState<string>();
  const [newTexture, setNewTexture] = useState(false);
  const [packDialog, setPackDialog] = useState(false);
  const [resourceTab, setResourceTab] = useState<ResourceTab>("textures");
  const [dialog, setDialog] = useState<"about" | "docs" | "preferences" | "shortcuts" | "updates" | "connectAgent" | "newProject" | "dataLists" | "gradleTask" | "importZip" | "quickOpen" | "runClient">();
  /** Ctrl+N asked for the New popup; the element list opens it once and clears this. */
  const [newRequest, setNewRequest] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  /** A plain Gradle mod open in code project mode (then there is no snapshot). */
  const [code, setCode] = useState<CodeProjectInfo>();
  const [codeSection, setCodeSection] = useState<"code" | "git">("code");
  /** Live co-editing: what an AI agent did over MCP, and a counter of outside reloads (views with drafts remount). */
  const [live, setLive] = useState<LiveState>({ entries: [] });
  const [externalRev, setExternalRev] = useState(0);
  /** Tasks for the agent (.mcedge/tasks), the source of a task being created, and a timeline step to show (KUYRUK 146). */
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [newTask, setNewTask] = useState<TaskSource>();
  const [timelineShow, setTimelineShow] = useState<{ session: string; step: number }>();
  const [now, setNow] = useState(() => Date.now());
  /** Editor tabs (KUYRUK 130): open elements and textures in order, and the history Alt+Left / Alt+Right walk. */
  const [tabs, setTabs] = useState<TabKey[]>([]);
  const history = useRef<{ keys: TabKey[]; at: number; walking: boolean }>({ keys: [], at: -1, walking: false });
  /** "typeId:id" of the element whose editor is mounted. */
  const openedElement = useRef<string>(undefined);

  const setPreferences = (next: Preferences) => {
    applyPreferences(next);
    setPreferencesState(next);
    void api.setPreferences(next);
    void api.setTitleBarTheme(next.theme);
  };
  const theme = preferences?.theme ?? "dark";
  const languageCode = preferences?.language;

  // Element type labels can be translated, so the catalog follows the language.
  useEffect(() => {
    if (!languageCode) return;
    api.elementTypes(languageCode).then((catalog) => {
      setTypeCatalog(catalog);
      catalog.problems.forEach((problem) => console.warn(`element type: ${problem}`));
      setTypesLoaded(languageCode);
    });
  }, [languageCode]);

  useEffect(() => {
    api.getPreferences().then((saved) => {
      const legacy = readStorage(LEGACY_THEME_KEY);
      setPreferences(saved ?? { ...DEFAULT_PREFERENCES, theme: legacy === "light" ? "light" : "dark" });
    });
    api.listEngines().then((list) => {
      setEngines(list);
      setEngineId((current) => current || list[0]?.id || "");
    });
    return api.onBuildEvent((event) =>
      setBuilds((all) => {
        const prev = all[event.engineId] ?? { status: "waiting", lines: [] };
        if (event.type === "start") return { ...all, [event.engineId]: { status: "running", lines: [] } };
        if (event.type === "line") return { ...all, [event.engineId]: { ...prev, lines: [...prev.lines, event.line] } };
        return { ...all, [event.engineId]: { ...prev, status: event.ok ? "ok" : "failed", jar: event.jar, stopped: event.stopped } };
      }),
    );
  }, []);

  const busy = (key: string) => ["running", "waiting"].includes(builds[key]?.status ?? "");
  const building = Object.keys(builds).some((key) => !isRunKey(key) && busy(key));
  const running = code ? busy(codeRunKey("client")) : busy(clientRunKey(engineId));
  const serverRunning = busy(runKey(engineId, "server"));
  /** Players with a client of the selected engine starting or running (KUYRUK 190). */
  const players = Object.keys(builds).filter((key) => busy(key) && clientRunPlayer(key) && clientRunKey(engineId, clientRunPlayer(key)) === key)
    .map((key) => clientRunPlayer(key)!);
  const startClient = (options: ClientRunOptions = {}) => {
    if (!snapshot) return;
    setBuilds((all) => ({ ...all, [clientRunKey(engineId, options.player)]: { status: "waiting", lines: [] } }));
    setPanel("build");
    void api.runClient(snapshot.dir, engineId, options);
  };
  /** Builds start a fresh set of entries but keep the logs of runs still going (client, server, console). */
  const startBuilds = (ids: string[]) =>
    setBuilds((all) => ({
      ...Object.fromEntries(Object.entries(all).filter(([key]) => isRunKey(key) && busy(key))),
      ...Object.fromEntries(ids.map((id) => [id, { status: "waiting" as const, lines: [] }])),
    }));
  /** Stops a client (or the debug client, which has the Dev client's key) or a server run by its build-event key. */
  const stopRun = (key: string) => {
    if (clientRunPlayer(key)) void api.stopClient(key);
    void api.stopGradle(key);
  };
  const gradle = (mode: "console" | "reload" | "debug" | "server", args: string[] = []) => {
    if (!snapshot) return;
    const key = runKey(engineId, mode === "debug" ? "client" : mode === "server" ? "server" : "gradle");
    setBuilds((all) => ({ ...all, [key]: { status: "waiting", lines: [] } }));
    setPanel(mode === "console" || mode === "reload" ? "gradle" : "build");
    void api.runGradle(snapshot.dir, engineId, mode, args);
  };
  const importResources = async (kind: ResourceKind) => {
    if (!snapshot) return;
    setOpen(undefined);
    setPainting(undefined);
    setSection("resources");
    setResourceTab(kind === "sound" ? "sounds" : kind === "model" ? "models" : "structures");
    const result = await api.importResources(snapshot.dir, kind);
    if (!result) return;
    setSnapshot(result.snapshot);
    if (result.warnings.length) setNotice({ title: t("notice.importTitle"), lines: [t("notice.imported", { count: result.imported.length }), ...result.warnings] });
  };
  // The engines the open project targets (mod.engines, KUYRUK 126); all when it names none.
  const targets = snapshot?.project.mod.engines;
  const projectEngines = targets?.length ? engines.filter((e) => targets.includes(e.id)) : engines;
  useEffect(() => {
    if (projectEngines.length && !projectEngines.some((e) => e.id === engineId)) setEngineId(projectEngines[0].id);
  }, [projectEngines, engineId]);
  const load = (opened: Opened) => {
    if (opened.kind === "mcedge") void restoreDrafts(opened.snapshot.dir);
    setCode(opened.kind === "code" ? opened.project : undefined);
    setSnapshot(opened.kind === "mcedge" ? opened.snapshot : undefined);
    setOpen(undefined);
    setSelected(undefined);
    setUsage(undefined);
    setPainting(undefined);
    setSection("elements");
    setTabs([]);
    history.current = { keys: [], at: -1, walking: false };
    // The tabs open when the project was last closed come back, the active one shown.
    if (opened.kind === "mcedge") {
      const dir = opened.snapshot.dir;
      void api.uiState(`tabs:${dir}`).then((saved) => {
        const state = saved as { tabs?: TabKey[]; active?: TabKey } | undefined;
        const kept = (state?.tabs ?? []).filter((key) => tabExists(opened.snapshot, key));
        setTabs(kept);
        if (state?.active && kept.includes(state.active)) showTab(state.active);
      });
    }
  };

  /** Code project mode: build, run and export go to the Gradle mod's own wrapper. */
  const codeBuild = (then?: (jar?: string) => void) => {
    if (!code) return;
    setBuilds((all) => ({ ...all, [codeRunKey("build")]: { status: "waiting", lines: [] } }));
    setPanel("build");
    void api.codeBuild(code.dir).then(then);
  };
  /** Shows a tab's editor (the element or texture it names). */
  const showTab = (key: TabKey) => {
    const tab = parseTab(key);
    if (!tab) return;
    setBackTo([]);
    if (tab.kind === "texture") return (setOpen(undefined), setPainting(tab.path));
    setPainting(undefined);
    setSelected({ typeId: tab.typeId, id: tab.id });
    setOpen({ typeId: tab.typeId, id: tab.id });
  };
  const activeTab = painting ? textureTab(painting) : open ? elementTab(open.typeId, open.id) : undefined;
  /** Closes tabs; closing the shown one shows its right neighbour, else its left one, else the section. */
  const closeTabs = (keys: TabKey[]) => {
    const left = tabs.filter((k) => !keys.includes(k));
    if (activeTab && keys.includes(activeTab)) {
      const index = tabs.indexOf(activeTab);
      const next = tabs.slice(index + 1).find((k) => left.includes(k)) ?? tabs.slice(0, index).reverse().find((k) => left.includes(k));
      if (next) showTab(next);
      else (setOpen(undefined), setPainting(undefined), setBackTo([]));
    }
    setTabs(left);
  };
  /** Alt+Left / Alt+Right: the previous or next editor shown, skipping ones deleted since. */
  const walk = (step: number) => {
    const h = history.current;
    for (let at = h.at + step; at >= 0 && at < h.keys.length; at += step) {
      if (!snapshot || !tabExists(snapshot, h.keys[at])) continue;
      h.at = at;
      h.walking = true;
      showTab(h.keys[at]);
      return;
    }
  };
  // Every editor shown gets a tab and a history entry.
  useEffect(() => {
    if (!activeTab) return;
    setTabs((all) => (all.includes(activeTab) ? all : [...all, activeTab]));
    const h = history.current;
    if (h.walking) h.walking = false;
    else if (h.keys[h.at] !== activeTab) (h.keys = [...h.keys.slice(0, h.at + 1), activeTab], h.at = h.keys.length - 1);
  }, [activeTab]);
  // Tabs of deleted or renamed elements and textures go (the shown one keeps its editor, which reports the deletion).
  useEffect(() => {
    if (snapshot) setTabs((all) => all.filter((k) => k === activeTab || tabExists(snapshot, k)));
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  // Remembered per project for the next time it opens.
  useEffect(() => {
    if (projectDirRef.current) void api.setUiState(`tabs:${projectDirRef.current}`, tabs.length ? { tabs, active: activeTab } : undefined);
  }, [tabs, activeTab]);
  const projectDirRef = useRef<string>(undefined);
  projectDirRef.current = snapshot?.dir;

  const cmd: Commands = {
    hasProject: !!snapshot,
    codeMode: !!code,
    building,
    running,
    canBuild: (!!snapshot || !!code?.wrapper) && !building,
    canRun: (!!snapshot || !!code?.wrapper) && !building && !running,
    theme,
    openProject: async () => {
      const next = await api.openProjectDialog();
      setOpenError(!next);
      if (next) load(next);
    },
    openExample: async () => load(await api.openProject(await api.exampleProjectDir())),
    openRecent: async (dir) => load(await api.openProject(dir)),
    closeProject: () => (setSnapshot(undefined), setCode(undefined)),
    build: (all) => {
      if (code) return codeBuild();
      if (!snapshot) return;
      const ids = all ? projectEngines.map((e) => e.id) : [engineId];
      startBuilds(ids);
      setPanel("build");
      api.build(snapshot.dir, ids);
    },
    regenerate: () => {
      if (!snapshot) return;
      startBuilds([engineId]);
      setPanel("build");
      void api.regenerate(snapshot.dir, [engineId]);
    },
    exportJar: () => {
      if (snapshot) return setExporting(true);
      if (!code) return;
      setBuilds((all) => ({ ...all, [codeRunKey("build")]: { status: "waiting", lines: [] } }));
      setPanel("build");
      void api.codeExport(code.dir).then((file) => file && setNotice({ title: t("code.exportTitle"), lines: [t("code.exported", { path: file })], path: file }));
    },
    run: () => {
      if (code) {
        setBuilds((all) => ({ ...all, [codeRunKey("client")]: { status: "waiting", lines: [] } }));
        setPanel("build");
        return void api.codeRun(code.dir);
      }
      startClient();
    },
    stop: () => (code ? void api.codeStop() : stopRun(clientRunKey(engineId))),
    serverRunning,
    runAnotherClient: () => snapshot && setDialog("runClient"),
    joinServer: () => startClient({ player: nextPlayer(players), join: true }),
    debugClient: () => gradle("debug"),
    runServer: () => gradle("server"),
    stopServer: () => void api.stopGradle(runKey(engineId, "server")),
    gradleConsole: () => setPanel("gradle"),
    reloadGradle: () => gradle("reload"),
    importResources: (kind) => void importResources(kind),
    exportWorkspace: async () => {
      if (!snapshot) return;
      const result = await api.exportWorkspace(snapshot.dir);
      if (result) setNotice({ title: t("notice.exportTitle"), lines: [t("notice.exported", { count: result.count })], path: result.file });
    },
    newProject: () => setDialog("newProject"),
    showPreferences: () => setDialog("preferences"),
    showDocs: () => setDialog("docs"),
    showAbout: () => setDialog("about"),
    showShortcuts: () => setDialog("shortcuts"),
    quickOpen: () => snapshot && setDialog("quickOpen"),
    checkUpdates: () => setDialog("updates"),
    openDeveloperDocs: () => void api.openExternal("https://github.com/SalihEfeTosunBayraktar/MCEdge/tree/main/docs"),
    connectAgent: () => setDialog("connectAgent"),
    newElement: () => snapshot && (setOpen(undefined), setPainting(undefined), setSection("elements"), setNewRequest(true)),
    closeEditor: activeTab ? () => closeTabs([activeTab]) : undefined,
    back: () => walk(-1),
    forward: () => walk(1),
    toggleTheme: () => preferences && setPreferences({ ...preferences, theme: theme === "dark" ? "light" : "dark" }),
    go: (next) => (setOpen(undefined), setPainting(undefined), setSection(next)),
    showPanel: setPanel,
    createTexture: () => snapshot && setNewTexture(true),
    createPack: () => snapshot && setPackDialog(true),
    importProjectZip: () => setDialog("importZip"),
    showDataLists: () => setDialog("dataLists"),
    cancelTask: () => void api.cancelGradle(),
    clearGradleCaches: async () => {
      if (!snapshot) return;
      try {
        const removed = await api.clearGradleCaches(snapshot.dir);
        setNotice({ title: t("notice.cachesTitle"), lines: removed.length ? [t("notice.cachesCleared", { count: removed.length }), ...removed] : [t("notice.cachesNone")] });
      } catch (e) {
        setNotice({ title: t("notice.cachesTitle"), lines: [String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")] });
      }
    },
    runGradleTask: () => snapshot && setDialog("gradleTask"),
    editTexture: (path) => (setOpen(undefined), setPainting(path)),
  };

  // App-wide shortcuts (Help > Keyboard shortcuts): F5 run, Shift+F5 stop, Ctrl+B build, Ctrl+Shift+B build all, Ctrl+E export,
  // Ctrl+N new element, Ctrl+F the section's search, Ctrl+W close the editor (KUYRUK 128). Enter, F2 and Delete belong to the element list.
  const cmdRef = useRef(cmd);
  cmdRef.current = cmd;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = cmdRef.current;
      const plain = e.ctrlKey && !e.shiftKey && !e.altKey;
      // Ctrl+N, Ctrl+F and Ctrl+W wait while a dialog is open.
      const free = !document.querySelector(".backdrop");
      const action =
        e.key === "F5" ? (e.shiftKey ? c.running && c.stop : c.canRun && c.run)
        : e.ctrlKey && e.code === "KeyB" ? c.canBuild && (() => c.build(e.shiftKey))
        : plain && e.code === "KeyE" ? c.canBuild && c.exportJar
        : plain && e.code === "KeyN" ? free && c.hasProject && c.newElement
        : plain && e.code === "KeyW" ? free && c.closeEditor
        : plain && e.code === "KeyK" ? free && c.hasProject && c.quickOpen
        : e.altKey && !e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)
          ? free && c.hasProject && (e.key === "ArrowLeft" ? c.back : c.forward)
        : plain && e.code === "KeyF" ? free && (() => {
          const input = document.querySelector<HTMLInputElement>(".content .findbar input:not(:disabled)");
          input?.focus();
          input?.select();
        })
        : undefined;
      if (action === undefined) return;
      e.preventDefault();
      if (action) action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Live co-editing: files an AI agent (or any program) changes reload the project; the open editor merges them.
  const projectDir = snapshot?.dir;
  useEffect(() => {
    if (!projectDir) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void api.liveState(projectDir).then(setLive);
    void api.agentTasks(projectDir).then(setTasks);
    const off = api.onFsChange((change) => {
      if (change.dir !== projectDir) return;
      if (change.paths.some((p) => p.startsWith(".mcedge/live/"))) void api.liveState(projectDir).then(setLive);
      if (change.paths.some((p) => p.startsWith(".mcedge/tasks/"))) void api.agentTasks(projectDir).then(setTasks);
      // Every preview of a PNG changed on disk reloads (tiles, Resources, pickers).
      change.paths.filter((p) => p.endsWith(".png")).forEach((p) => invalidateTexture(projectDir, p));
      if (!change.paths.some((p) => !p.startsWith(".mcedge/"))) return;
      clearTimeout(timer);
      timer = setTimeout(() => void api.reloadProject(projectDir).then((next) => (setSnapshot(next), setExternalRev((n) => n + 1))), 120);
    });
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => (off(), clearTimeout(timer), clearInterval(tick));
  }, [projectDir]);
  // An agent asks to see a screen (editor_screenshot, KUYRUK 153): switch there, then confirm once it is drawn.
  const handledShow = useRef<string>(undefined);
  const [shown, setShown] = useState<{ id: string; error?: string }>();
  useEffect(() => {
    const request = live.show;
    if (!snapshot || !request || handledShow.current === request.id) return;
    handledShow.current = request.id;
    if (Date.now() - Date.parse(request.at) > SHOW_FRESH_MS) return;
    const screen = parseScreen(request.screen);
    let error: string | undefined;
    if (!screen) error = `unknown screen "${request.screen}"`;
    else if (screen.kind === "section") cmd.go(screen.section);
    else if (screen.kind === "resources") (cmd.go("resources"), setResourceTab(screen.tab));
    else if (screen.kind === "dialog") setDialog(screen.dialog);
    else if (screen.kind === "panel") setPanel(screen.panel);
    else if (!openTarget(`${screen.typeId}/${screen.id}`)) error = `no element ${screen.typeId}/${screen.id}`;
    setShown({ id: request.id, ...(error ? { error } : {}) });
    // Runs when a new request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.show, snapshot?.dir]);
  // Tell the agent (MCP collaborators tool) what the user has open, and which show request is on screen.
  const openKey = open ? `${open.typeId}/${open.id}` : painting ?? section;
  useEffect(() => {
    if (!projectDir) return;
    const send = () => void api.livePresence(projectDir, openKey, shown);
    // Effects run after the paint; a short delay lets a dialog or editor that just mounted settle (images, fonts).
    const first = setTimeout(send, 150);
    const timer = setInterval(send, 20000);
    return () => (clearTimeout(first), clearInterval(timer));
  }, [projectDir, openKey, shown]);
  const agentAt = live.agent ? Date.parse(live.agent.at) : 0;
  const recentlyChanged = new Set(live.entries.filter((e) => now - Date.parse(e.at) < 20000 && e.target).map((e) => e.target!));
  const agent = snapshot && live.agent ? {
    client: live.agent.client, active: now - agentAt < 60000, recent: live.entries.filter((e) => now - Date.parse(e.at) < 60000 && e.changes?.length).length,
  } : undefined;
  /** The element and fields the agent works on right now, highlighted in the list and the open editor (KUYRUK 144). */
  const focus = snapshot ? agentFocus(live.entries, now) : undefined;
  /** Opens what a timeline row names: an element ("item/ruby") or a texture. */
  const openTarget = (target: string): boolean => {
    if (!snapshot) return false;
    if (snapshot.textures.includes(target)) return (cmd.editTexture(target), true);
    const slash = target.indexOf("/");
    const ref = { typeId: target.slice(0, slash), id: target.slice(slash + 1) };
    if (slash < 0 || !findElement(snapshot, ref)) return false;
    setPainting(undefined);
    setSelected(ref);
    setOpen(ref);
    return true;
  };

  /** Opens a quick open result where it lives: elements and textures in their editors, the rest in its section, searched for. */
  const openQuick = (item: QuickItem) => {
    const name = item.target.slice(item.target.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
    if (item.kind === "element") return void openTarget(item.target);
    if (item.kind === "texture") return cmd.editTexture(item.target);
    if (item.kind === "sound" || item.kind === "model" || item.kind === "structure") {
      cmd.go("resources");
      setResourceTab(item.kind === "sound" ? "sounds" : item.kind === "model" ? "models" : "structures");
      return reveal(item.kind === "sound" ? "sounds" : `files:${item.kind}`, name);
    }
    if (item.kind === "langKey") return (cmd.go("localization"), reveal("localization", item.target));
    if (item.kind === "variable") return (cmd.go("variables"), reveal("variables", item.target));
    cmd.go("tags");
    reveal("tags", item.label);
  };

  const engine = engines.find((e) => e.id === engineId);
  const element = snapshot && open && findElement(snapshot, open);
  // An open element deleted on disk keeps its editor, which asks what to do with unsaved edits.
  if (element && open) openedElement.current = `${open.typeId}:${open.id}`;
  return (
    // Remounted per language so memoized views pick up the new strings.
    <div className="app" key={languageCode}>
      <MenuBar cmd={cmd} projectName={snapshot?.project.mod.name ?? code?.name} engines={code ? [] : projectEngines} engineId={engineId} onEngineChange={setEngineId} />
      {!preferences || typesLoaded !== languageCode ? null : code ? (
        <div className="body">
          <Rail active={codeSection} sections={CODE_SECTIONS} onSelect={(s) => setCodeSection(s === "git" ? "git" : "code")} />
          <main className="content">
            <SectionName.Provider value={t(`section.${codeSection}`)}>
            {/* The editor stays mounted while the Git view is shown, so open tabs and unsaved edits survive. */}
            <div className={`codehost ${codeSection === "code" ? "" : "hidden"}`}>
              <CodeWorkspace key={code.dir} project={code} theme={theme} building={building} running={running}
                onBuild={() => cmd.build(false)} onRun={cmd.run} onStop={cmd.stop} onExport={cmd.exportJar} />
            </div>
            {codeSection === "git" && <GitView dir={code.dir} onFilesChanged={() => undefined} />}
            </SectionName.Provider>
          </main>
        </div>
      ) : !snapshot ? (
        <Welcome error={openError} onPreferences={cmd.showPreferences} onOpen={cmd.openProject} onNew={cmd.newProject}
          onOpenExample={cmd.openExample} onOpenRecent={cmd.openRecent} />
      ) : (
        <div className="body">
          <Rail active={section} onSelect={cmd.go} />
          <main className={`content ${tabs.length ? "withtabs" : ""}`}>
            {tabs.length > 0 && (
              <EditorTabs snapshot={snapshot} sectionName={t(`section.${section}`)} tabs={tabs} active={activeTab} onShow={showTab}
                onShowSection={() => cmd.go(section)} onClose={closeTabs} />
            )}
            {painting ? (
              <TextureEditor key={painting} snapshot={snapshot} path={painting} onSaved={setSnapshot}
                onClose={() => (setPainting(undefined), setSection("resources"))} />
            ) : open && (element || openedElement.current === `${open.typeId}:${open.id}`) ? (
              <ElementEditor key={`${open.typeId}:${open.id}`} snapshot={snapshot} target={open} onSaved={setSnapshot}
                coverage={engine?.coverage} engineName={engine?.name ?? ""} engine={engine}
                backName={backTo.length ? backName(snapshot, backTo.at(-1)!) : undefined}
                onClose={() => {
                  const previous = backTo.at(-1);
                  setBackTo(backTo.slice(0, -1));
                  if (previous) setSelected(previous);
                  setOpen(previous);
                }}
                onOpen={(ref) => (setBackTo([...backTo, open!]), setSelected(ref), setOpen(ref))}
                onDeleted={(name) => (setOpen(undefined), setNotice({ title: t("editor.deletedTitle"), lines: [t("editor.deletedClosed", { name })] }))}
                agentFields={focus?.target === `${open.typeId}/${open.id}` ? focus.fields : undefined} onNewTask={setNewTask} />
            ) : (
              // Every section names itself at the left of its find bar (KUYRUK 122).
              <SectionName.Provider value={t(`section.${section}`)}>
                {section === "elements" && (
                  <Workspace newRequest={newRequest} onNewHandled={() => setNewRequest(false)} snapshot={snapshot} coverage={engine?.coverage} engineName={engine?.name ?? ""} selected={selected} usage={usage} onSelect={setSelected} onOpen={setOpen}
                    onChanged={setSnapshot} onClearUsage={() => setUsage(undefined)} live={recentlyChanged} agentOn={focus?.target}
                    onNewTask={setNewTask} />
                )}
                {section === "resources" && (
                  <ResourcesView snapshot={snapshot} onChanged={setSnapshot} onCreate={cmd.createTexture} onEdit={cmd.editTexture}
                    tab={resourceTab} onTab={setResourceTab} onImport={cmd.importResources}
                    onSearchUsages={(path) => (setUsage(path), setSection("elements"))} />
                )}
                {section === "tags" && <TagsView key={externalRev} snapshot={snapshot} onSaved={setSnapshot} />}
                {section === "variables" && <VariablesView key={externalRev} snapshot={snapshot} onSaved={setSnapshot} />}
                {section === "localization" && <LocalizationView key={externalRev} snapshot={snapshot} engineId={engineId} onSaved={setSnapshot}
                  onOpenElement={(ref) => (setSelected(ref), setOpen(ref))} />}
                {section === "git" && <GitView dir={snapshot.dir} onFilesChanged={() => void api.reloadProject(snapshot.dir).then(setSnapshot)} />}
                {section === "settings" && <SettingsView key={externalRev} snapshot={snapshot} onSaved={setSnapshot} />}
              </SectionName.Provider>
            )}
          </main>
        </div>
      )}
      {snapshot && newTask && (
        <NewTaskDialog dir={snapshot.dir} source={newTask} onCancel={() => setNewTask(undefined)}
          onCreated={() => (setNewTask(undefined), setPanel("tasks"), void api.agentTasks(snapshot.dir).then(setTasks))} />
      )}
      {snapshot && packDialog && (
        <CreatePackDialog snapshot={snapshot} onClose={() => setPackDialog(false)}
          onCreated={(next) => (setPackDialog(false), setSnapshot(next), cmd.go("elements"))} />
      )}
      {snapshot && newTexture && (
        <NewTextureDialog snapshot={snapshot} onCancel={() => setNewTexture(false)}
          onCreated={(next, path) => (setNewTexture(false), setSnapshot(next), cmd.editTexture(path))} />
      )}
      {snapshot && exporting && (
        <ExportDialog snapshot={snapshot} engines={projectEngines} engineId={engineId} builds={builds} onClose={() => setExporting(false)}
          onStart={startBuilds} />
      )}
      {(snapshot || code) && panel && (
        <BottomPanel panel={panel} issues={snapshot?.issues ?? []} ignoredIssues={snapshot?.ignoredIssues}
          onProblemAction={snapshot && ((action) => void api.updateProblems(snapshot.dir, action).then(setSnapshot))} console={!!snapshot}
          agent={snapshot && { dir: snapshot.dir, live, now, onOpenTarget: openTarget, show: timelineShow, onConnect: () => setDialog("connectAgent") }}
          tasks={snapshot && { dir: snapshot.dir, tasks, entries: live.entries, onNewTask: setNewTask, onOpenTarget: openTarget,
            onShowStep: (session, step) => (setTimelineShow({ session, step }), setPanel("activity")) }}
          onNewTask={snapshot ? setNewTask : undefined} builds={builds} engineId={engineId} onGradle={(args) => gradle("console", args)}
          onStopGradle={() => void api.stopGradle(runKey(engineId, "gradle"))} onStopRun={code ? undefined : stopRun} onSelect={setPanel} onClose={() => setPanel(undefined)} />
      )}
      {dialog === "newProject" && <NewProjectDialog engines={engines} onCreated={(opened) => (setDialog(undefined), load(opened))} onClose={() => setDialog(undefined)} />}
      {dialog === "preferences" && preferences && <PreferencesDialog preferences={preferences} onChange={setPreferences} onClose={() => setDialog(undefined)} />}
      {dialog === "about" && <AboutDialog onClose={() => setDialog(undefined)} />}
      {dialog === "docs" && <DocsDialog onClose={() => setDialog(undefined)} />}
      {dialog === "quickOpen" && snapshot && <QuickOpen snapshot={snapshot} onOpen={openQuick} onClose={() => setDialog(undefined)} />}
      {dialog === "shortcuts" && <KeyboardShortcutsDialog onClose={() => setDialog(undefined)} />}
      {dialog === "updates" && <UpdateDialog onClose={() => setDialog(undefined)} />}
      {dialog === "connectAgent" && <ConnectAgentDialog dir={snapshot?.dir ?? code?.dir} onClose={() => setDialog(undefined)} />}
      {dialog === "dataLists" && <DataListsDialog onClose={() => setDialog(undefined)} />}
      {dialog === "importZip" && <ImportZipDialog onImported={(opened) => (setDialog(undefined), load(opened))} onClose={() => setDialog(undefined)} />}
      {dialog === "gradleTask" && (
        <GradleTaskDialog engineName={engines.find((e) => e.id === engineId)?.name ?? engineId} onClose={() => setDialog(undefined)}
          onRun={(args) => (setDialog(undefined), gradle("console", args))} />
      )}
      {dialog === "runClient" && (
        <RunClientDialog engineName={engines.find((e) => e.id === engineId)?.name ?? engineId} players={players} serverRunning={serverRunning}
          onClose={() => setDialog(undefined)} onRun={(options) => (setDialog(undefined), startClient(options))} />
      )}
      {notice && <NoticeDialog notice={notice} onClose={() => setNotice(undefined)} />}
      <StatusBar agent={agent} problems={snapshot?.issues.length ?? 0} elements={snapshot && allElements(snapshot).length} builds={builds}
        engineName={code ? `JDK ${code.jdk}` : engine ? `${engine.name}` : ""} onOpenPanel={(p) => (snapshot || code) && setPanel(p)} open={!!snapshot || !!code} />
    </div>
  );
}

// Only read for the theme saved by older versions; storage may be unavailable, so failures are ignored.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Name of the element Back returns to. */
function backName(snapshot: ProjectSnapshot, ref: ElementRef): string {
  const element = findElement(snapshot, ref);
  return element ? elementName(ref.typeId, element) : ref.id;
}
