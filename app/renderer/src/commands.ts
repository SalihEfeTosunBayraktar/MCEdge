import type { PanelId } from "./components/BottomPanel.tsx";
import type { ResourceKind } from "../../shared/api.ts";
import type { Section } from "./components/Rail.tsx";

/** App-wide commands shared by the menu bar, the toolbar and the status bar. */
export interface Commands {
  /** An MCEdge project is open. */
  hasProject: boolean;
  /** A Gradle mod is open in code project mode. */
  codeMode: boolean;
  building: boolean;
  running: boolean;
  canBuild: boolean;
  canRun: boolean;
  theme: "dark" | "light";
  /** Opens File > New project (KUYRUK 126). */
  newProject: () => void;
  openProject: () => void;
  openExample: () => void;
  openRecent: (dir: string) => void;
  closeProject: () => void;
  /** File > Open project folder: the open project in the OS file manager (Q210). */
  openProjectFolder: () => void;
  build: (all: boolean) => void;
  /** Build > Regenerate code: generates the selected engine's project again without building (KUYRUK 131). */
  regenerate: () => void;
  /** Opens File > Export mod jar. */
  exportJar: () => void;
  run: () => void;
  stop: () => void;
  toggleTheme: () => void;
  go: (section: Section) => void;
  showPanel: (panel: PanelId) => void;
  /** Asks for name, folder and size of a new texture, then opens it in the texture editor. */
  createTexture: () => void;
  /** Tools > Create pack: a set of elements with textures and recipes from one name and colour (KUYRUK 134). */
  createPack: () => void;
  /** KUYRUK 135: File > Import project from ZIP, Tools > Minecraft data lists, Build & run > Cancel task, Clear Gradle caches, Run Gradle task. */
  importProjectZip: () => void;
  showDataLists: () => void;
  cancelTask: () => void;
  clearGradleCaches: () => void;
  runGradleTask: () => void;
  /** Opens a project texture in the texture editor. */
  editTexture: (path: string) => void;
  serverRunning: boolean;
  /** Build & run > Run another client: a client as another player, beside the running ones (KUYRUK 190). */
  runAnotherClient: () => void;
  /** Build & run > Join test server: a client as the next free player that connects to the engine's test server. */
  joinServer: () => void;
  /** Client with a JDWP agent on port 5005. */
  debugClient: () => void;
  runServer: () => void;
  stopServer: () => void;
  gradleConsole: () => void;
  /** Regenerates the engine's project and lets Gradle configure it again. */
  reloadGradle: () => void;
  importResources: (kind: ResourceKind) => void;
  /** Zips the project to a file. */
  exportWorkspace: () => void;
  /** Opens the Preferences dialog (app-wide, also without a project). */
  showPreferences: () => void;
  showDocs: () => void;
  showAbout: () => void;
  /** Help > Keyboard shortcuts, Check for updates and the developer documentation online (KUYRUK 128). */
  showShortcuts: () => void;
  /** Ctrl+K: search the whole project and open the result (KUYRUK 136). */
  quickOpen: () => void;
  checkUpdates: () => void;
  openDeveloperDocs: () => void;
  /** Help > Connect an AI agent: the MCP command and client setup for the open project (Q201). */
  connectAgent: () => void;
  /** Help > Report a bug: prepares a GitHub issue with the version, engine and build output (Q208). */
  reportBug: () => void;
  /** Ctrl+N: the element list with the New popup open. */
  newElement: () => void;
  /** Ctrl+W: closes the open element or texture editor; undefined while none is open. */
  closeEditor?: () => void;
  /** Alt+Left / Alt+Right: the editor shown before or after (KUYRUK 130). */
  back: () => void;
  forward: () => void;
}
