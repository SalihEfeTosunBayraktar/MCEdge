import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureToolchain } from "../engines/toolchains.ts";

/**
 * Eclipse JDT Language Server for code project mode: one process per open Gradle mod, over stdio, with a small
 * hand-written LSP client (open/change/close, completion + resolve, hover, diagnostics). jdtls runs on a downloaded
 * JDK 25; it imports the mod with the mod's own Gradle wrapper on the mod's JDK, so completion sees the target's
 * Minecraft classpath. Its workspace data lives in `dataDir`, never inside the project.
 */

export const JDTLS_VERSION = "1.63.0";
/** jdtls 1.6x is built on an Eclipse platform that needs Java 25 to run. */
const JDTLS_JDK = 25;

export type JavaState = "downloading" | "starting" | "importing" | "ready" | "failed" | "stopped";

export interface JavaStatus {
  state: JavaState;
  /** Downloaded MB, import step, failure reason, or "idle" for an idle stop. */
  detail?: string;
}

/** LSP shapes used here (only the fields MCEdge reads). */
export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspTextEdit { range: LspRange; newText: string }
export interface LspDiagnostic { range: LspRange; severity?: number; message: string; code?: string | number; source?: string }
export interface LspCompletionItem {
  label: string;
  labelDetails?: { detail?: string; description?: string };
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: LspTextEdit | { newText: string; insert: LspRange; replace: LspRange };
  additionalTextEdits?: LspTextEdit[];
  data?: unknown;
}
export interface LspHover { contents: string | { kind?: string; language?: string; value: string } | (string | { language: string; value: string })[]; range?: LspRange }

export interface JavaServerOptions {
  projectDir: string;
  /** JDK feature version the mod builds with (its Gradle runs on it). */
  projectJdk: number;
  /** Folder for jdtls's workspace and configuration (created). */
  dataDir: string;
  onStatus(status: JavaStatus): void;
  /** Diagnostics of a project file (project-relative path, forward slashes). */
  onDiagnostics(path: string, diagnostics: LspDiagnostic[]): void;
  /** stderr and window/logMessage lines (debugging). */
  onLog?(line: string): void;
}

interface Pending { resolve(value: any): void; reject(error: Error): void; timer?: NodeJS.Timeout }

export class JavaServer {
  private child?: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private docs = new Map<string, { version: number; text: string }>();
  private initialized = false;
  private status: JavaStatus = { state: "starting" };
  private settings: Record<string, unknown> = {};
  private stopped = false;
  private lastLines: string[] = [];

  private readonly options: JavaServerOptions;

  constructor(options: JavaServerOptions) {
    this.options = options;
  }

  get state(): JavaStatus {
    return this.status;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Downloads what is missing, starts jdtls and initializes it; resolves once the Gradle import has begun. */
  async start(): Promise<void> {
    const { projectDir, projectJdk, dataDir } = this.options;
    const progress = (p: { kind: string; received: number }) => this.setStatus({ state: "downloading", detail: `${p.kind} ${Math.round(p.received / 1e6)}` });
    try {
      const jdtls = await ensureToolchain("jdtls", JDTLS_VERSION, progress);
      const jdk = await ensureToolchain("jdk", JDTLS_JDK, progress);
      const modJdk = await ensureToolchain("jdk", projectJdk, progress);
      if (this.stopped) return;
      this.setStatus({ state: "starting" });
      const launcher = readdirSync(join(jdtls, "plugins")).find((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f));
      if (!launcher) throw new Error(`no equinox launcher in ${jdtls}`);
      const config = join(jdtls, { win32: "config_win", darwin: process.arch === "arm64" ? "config_mac_arm" : "config_mac" }[process.platform as string] ?? "config_linux");
      mkdirSync(join(dataDir, "config"), { recursive: true });
      mkdirSync(join(dataDir, "workspace"), { recursive: true });
      const java = join(jdk, "bin", process.platform === "win32" ? "java.exe" : "java");
      const args = [
        "-Declipse.application=org.eclipse.jdt.ls.core.id1", "-Dosgi.bundles.defaultStartLevel=4", "-Declipse.product=org.eclipse.jdt.ls.core.product",
        // The extracted config folder is shared and read-only; each project's OSGi state goes to its own data folder.
        `-Dosgi.sharedConfiguration.area=${config}`, "-Dosgi.sharedConfiguration.area.readOnly=true", "-Dosgi.checkConfiguration=true", "-Dosgi.configuration.cascaded=true",
        "-Djdk.xml.maxGeneralEntitySizeLimit=0", "-Djdk.xml.totalEntitySizeLimit=0", "-Dlog.level=WARNING",
        // Read by jdtls's file system bundle at startup: .project, .classpath and .settings stay in the jdtls workspace.
        "-Djava.import.generatesMetadataFilesAtProjectRoot=false", "-Dfile.encoding=UTF-8", "-Duser.language=en", "-Duser.country=US",
        "-XX:+UseParallelGC", "-XX:GCTimeRatio=4", "-XX:AdaptiveSizePolicyWeight=90", "-Dsun.zip.disableMemoryMapping=true", "-Xms64m", "-Xmx1G",
        "--add-modules=ALL-SYSTEM", "--add-opens", "java.base/java.util=ALL-UNNAMED", "--add-opens", "java.base/java.lang=ALL-UNNAMED",
        "-jar", join(jdtls, "plugins", launcher), "-configuration", join(dataDir, "config"), "-data", join(dataDir, "workspace"),
      ];
      const child = spawn(java, args, { cwd: dataDir, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
      this.child = child;
      child.stderr!.on("data", (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((line) => this.log(line)));
      child.stdout!.on("data", (d: Buffer) => this.receive(d));
      child.on("error", (error) => this.fail(error.message));
      child.on("exit", (code) => {
        for (const p of this.pending.values()) p.reject(new Error("jdtls exited"));
        this.pending.clear();
        this.child = undefined;
        if (!this.stopped) this.fail(`jdtls exited (${code})${this.lastLines.length ? `: ${this.lastLines.at(-1)}` : ""}`);
      });

      const javaRuntime = (version: number) => (version <= 8 ? `JavaSE-1.${version}` : `JavaSE-${version}`);
      this.settings = {
        java: {
          jdt: { ls: { java: { home: jdk } } },
          configuration: { runtimes: [{ name: javaRuntime(projectJdk), path: modJdk, default: true }], updateBuildConfiguration: "automatic" },
          import: {
            gradle: { enabled: true, wrapper: { enabled: true }, java: { home: modJdk }, offline: { enabled: false }, annotationProcessing: { enabled: true } },
            maven: { enabled: false },
            generatesMetadataFilesAtProjectRoot: false,
            exclusions: ["**/node_modules/**", "**/.metadata/**", "**/archetype-resources/**", "**/META-INF/maven/**", "**/run/**"],
          },
          // Diagnostics of open files come from reconciling; a full workspace build would only cost CPU and RAM.
          autobuild: { enabled: false },
          maxConcurrentBuilds: 1,
          completion: { enabled: true, guessMethodArguments: "insertParameterNames", maxResults: 100 },
          format: { enabled: false },
          signatureHelp: { enabled: true },
          sources: { organizeImports: { starThreshold: 99, staticStarThreshold: 99 } },
          referencesCodeLens: { enabled: false }, implementationsCodeLens: { enabled: false },
        },
      };
      const rootUri = pathToFileURL(projectDir).href;
      await this.request("initialize", {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: "mod" }],
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: false } },
          textDocument: {
            synchronization: { didSave: false, willSave: false, dynamicRegistration: false },
            completion: {
              contextSupport: true,
              completionItem: {
                snippetSupport: true, documentationFormat: ["markdown", "plaintext"], labelDetailsSupport: true,
                resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
              },
            },
            hover: { contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: { relatedInformation: false },
          },
          window: { workDoneProgress: false },
        },
        initializationOptions: {
          bundles: [],
          workspaceFolders: [rootUri],
          settings: this.settings,
          extendedClientCapabilities: { progressReportProvider: true, classFileContentsSupport: false, advancedOrganizeImportsSupport: false },
        },
      }, 120_000);
      this.notify("initialized", {});
      this.initialized = true;
      if (this.status.state === "starting") this.setStatus({ state: "importing" });
      for (const [path, doc] of this.docs) this.notify("textDocument/didOpen", { textDocument: { uri: this.uri(path), languageId: "java", version: doc.version, text: doc.text } });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  open(path: string, text: string): void {
    const doc = { version: 1, text };
    this.docs.set(path, doc);
    if (this.initialized) this.notify("textDocument/didOpen", { textDocument: { uri: this.uri(path), languageId: "java", version: doc.version, text } });
  }

  change(path: string, text: string): void {
    const doc = this.docs.get(path);
    if (!doc) return this.open(path, text);
    doc.version++;
    doc.text = text;
    if (this.initialized) this.notify("textDocument/didChange", { textDocument: { uri: this.uri(path), version: doc.version }, contentChanges: [{ text }] });
  }

  close(path: string): void {
    if (!this.docs.delete(path)) return;
    if (this.initialized) this.notify("textDocument/didClose", { textDocument: { uri: this.uri(path) } });
  }

  /** Open documents and their text (kept to reopen them after a restart). */
  openDocuments(): [string, string][] {
    return [...this.docs].map(([path, doc]) => [path, doc.text]);
  }

  /** Completion at a position; empty until the Gradle import is done. */
  async completion(path: string, position: LspPosition): Promise<{ items: LspCompletionItem[]; incomplete: boolean }> {
    if (this.status.state !== "ready" || !this.docs.has(path)) return { items: [], incomplete: false };
    const result = await this.request("textDocument/completion", { textDocument: { uri: this.uri(path) }, position, context: { triggerKind: 1 } }, 15_000);
    if (Array.isArray(result)) return { items: result, incomplete: false };
    return { items: result?.items ?? [], incomplete: !!result?.isIncomplete };
  }

  async resolveCompletion(item: LspCompletionItem): Promise<LspCompletionItem> {
    if (this.status.state !== "ready") return item;
    return (await this.request("completionItem/resolve", item, 10_000)) ?? item;
  }

  async hover(path: string, position: LspPosition): Promise<LspHover | null> {
    if (this.status.state !== "ready" || !this.docs.has(path)) return null;
    return this.request("textDocument/hover", { textDocument: { uri: this.uri(path) }, position }, 10_000);
  }

  /**
   * Asks jdtls to shut down (it saves its workspace), then ends its process tree: the Gradle daemon the import
   * started is a child of jdtls and would otherwise stay alive for hours.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.child && this.initialized) {
      try {
        await this.request("shutdown", null, 5_000);
      } catch {
        // killed below either way
      }
    }
    this.kill();
  }

  /** Immediate stop without the shutdown handshake (app quitting). */
  kill(): void {
    this.stopped = true;
    const pid = this.child?.pid;
    if (pid) killTree(pid);
    this.child = undefined;
    for (const p of this.pending.values()) p.reject(new Error("jdtls stopped"));
    this.pending.clear();
  }

  // ---- JSON-RPC over stdio ----

  private buffer = Buffer.alloc(0);

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString("ascii"))?.[1]);
      if (!Number.isFinite(length)) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      if (this.buffer.length < headerEnd + 4 + length) return;
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      try {
        this.dispatch(JSON.parse(body));
      } catch (error) {
        this.log(`bad message: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  private dispatch(message: { id?: number | string; method?: string; params?: any; result?: any; error?: { message: string } }): void {
    if (message.method && message.id !== undefined) return this.answer(message.id, message.method, message.params);
    if (message.method) return this.notification(message.method, message.params);
    const pending = this.pending.get(message.id as number);
    if (!pending) return;
    this.pending.delete(message.id as number);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  /** Requests from jdtls: settings by section; everything else (capability registration, progress) is acknowledged. */
  private answer(id: number | string, method: string, params: any): void {
    let result: unknown = null;
    if (method === "workspace/configuration") {
      result = (params?.items ?? []).map((item: { section?: string }) => {
        let value: any = this.settings;
        for (const key of (item.section ?? "").split(".").filter(Boolean)) value = value?.[key];
        return value ?? null;
      });
    }
    this.write({ jsonrpc: "2.0", id, result });
  }

  private notification(method: string, params: any): void {
    if (method === "textDocument/publishDiagnostics") {
      const path = this.pathOf(params.uri);
      if (path !== undefined) this.options.onDiagnostics(path, params.diagnostics ?? []);
    } else if (method === "language/status") {
      // Started: import done, services ready. Error: the server could not start.
      if (params.type === "Started") this.setStatus({ state: "ready" });
      else if (params.type === "Error") this.fail(params.message);
      else if (params.type === "Starting" && this.initialized && this.status.state !== "ready") this.setStatus({ state: "importing", detail: params.message });
    } else if (method === "language/progressReport") {
      if (this.status.state === "importing" && !params.complete) {
        const detail = [params.task, params.subTask].filter(Boolean).join(": ").slice(0, 120);
        if (detail) this.setStatus({ state: "importing", detail });
      }
    } else if (method === "window/logMessage" || method === "window/showMessage") this.log(String(params?.message ?? ""));
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<any> {
    if (!this.child) return Promise.reject(new Error("jdtls is not running"));
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    if (this.child) this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    this.child?.stdin?.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
  }

  // ---- helpers ----

  private uri(path: string): string {
    return pathToFileURL(join(this.options.projectDir, path)).href;
  }

  /** Project-relative path of a jdtls URI, or undefined for files outside the project. */
  private pathOf(uri: string): string | undefined {
    let file: string;
    try {
      file = fileURLToPath(uri);
    } catch {
      return undefined;
    }
    const rel = relative(resolve(this.options.projectDir), resolve(file));
    const fold = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
    if (rel.startsWith("..") || fold(resolve(this.options.projectDir, rel)) !== fold(resolve(file))) return undefined;
    const path = rel.split("\\").join("/");
    // jdtls may change the drive letter's case; report the path the editor opened.
    return [...this.docs.keys()].find((p) => fold(p) === fold(path)) ?? path;
  }

  private setStatus(status: JavaStatus): void {
    if (this.stopped && status.state !== "stopped") return;
    if (this.status.state === status.state && this.status.detail === status.detail) return;
    this.status = status;
    this.options.onStatus(status);
  }

  private fail(reason: string): void {
    if (this.stopped) return;
    this.setStatus({ state: "failed", detail: reason.slice(0, 300) });
  }

  private log(line: string): void {
    this.lastLines.push(line);
    if (this.lastLines.length > 50) this.lastLines.shift();
    this.options.onLog?.(line);
  }
}

/** Ends a process and its children (Windows: taskkill /T; elsewhere the process group started detached). */
export function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}
