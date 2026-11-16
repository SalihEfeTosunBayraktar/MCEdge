/**
 * Minimal Chrome DevTools Protocol driver for UI tests of the real Electron app. It launches the built app
 * (npm run build:app first) with its own user data folder and a free debugging port, so a window the user has
 * open is never touched, and stops only the process it started.
 *
 *   const app = await launchApp({ project });   // project: folder to open from the recent list
 *   await app.click("button.abtn", "Import");    // CSS selector, optional text filter
 *   await app.shot("design/texture-editor/x-dark.png");
 *   await app.close();
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "..", "..");
const ELECTRON = join(REPO, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

export interface LaunchOptions {
  /** Project folder put at the top of the recent list and opened. */
  project?: string;
  /** "code" when `project` is a plain Gradle mod (code project mode). */
  kind?: "code";
  language?: string;
  theme?: "dark" | "light";
  width?: number;
  height?: number;
  /** Reuse this user data folder (keeps it on close), to restart the app on the same state. */
  userData?: string;
}

export interface App {
  eval<T = unknown>(expression: string): Promise<T>;
  /** Sends a raw DevTools Protocol command to the page (Profiler, Performance, ...). */
  cdp(method: string, params?: object): Promise<any>;
  /** Listens to a DevTools Protocol event of the page (Tracing.dataCollected, ...); returns the unsubscribe. */
  onCdp(method: string, listener: (params: any) => void): () => void;
  /** Evaluates in the Electron main process (Node inspector). */
  mainEval<T = unknown>(expression: string): Promise<T>;
  /** Makes the next native open/save dialogs return these paths instead of showing. */
  mockDialogs(dialogs: { open?: string[]; save?: string }): Promise<void>;
  /** Waits until the expression is truthy (polls). */
  waitFor(expression: string, timeoutMs?: number): Promise<void>;
  /** Clicks the centre of the first element matching the selector whose text contains `text`. */
  click(selector: string, text?: string, options?: { double?: boolean; button?: "left" | "right" }): Promise<void>;
  /** Mouse down at `from`, moves in steps, mouse up at `to` (page coordinates). */
  drag(from: [number, number], to: [number, number], steps?: number): Promise<void>;
  mouse(type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number, buttons?: number): Promise<void>;
  /** A mouse wheel turn at x, y (page coordinates); deltaY < 0 is away from the user; modifiers as for key (2 = Ctrl). */
  wheel(x: number, y: number, deltaY: number, modifiers?: number): Promise<void>;
  /** Centre of the first matching element. */
  center(selector: string, text?: string): Promise<[number, number]>;
  rect(selector: string, text?: string): Promise<{ x: number; y: number; width: number; height: number }>;
  type(text: string): Promise<void>;
  /** Sets an input's or select's value the way React sees a user change (native setter + input/change events). */
  setValue(selector: string, value: string, text?: string): Promise<void>;
  /** Sets the control of the form row labelled `label` (inside `scope`, a CSS selector). */
  setField(label: string, value: string, scope?: string): Promise<void>;
  key(key: string, modifiers?: number): Promise<void>;
  shot(file: string): Promise<void>;
  setTheme(theme: "dark" | "light"): Promise<void>;
  sleep(ms: number): Promise<void>;
  close(): Promise<void>;
  userData: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("no port"))));
    });
  });
}

/** Copies a project into a fresh temp folder so tests never change the original. */
export function copyProject(source: string, name = "project"): string {
  const dir = join(mkdtempSync(join(tmpdir(), "mcedge-ui-")), name);
  // A source reached through a junction or symlink (a worktree's ../ETREconomy-MCEdge) is resolved and copied, not
  // linked, so a test never writes into the real project.
  cpSync(realpathSync(source), dir, { recursive: true, dereference: true, filter: (path) => !/[\\/](out|build|run|\.gradle|\.git)$/.test(path) });
  return dir;
}

/** The committed state of examples/hello (the working copy may hold the user's own edits). */
export function exampleProject(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "mcedge-ui-")), "hello");
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: REPO, maxBuffer: 1 << 28 });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout as Buffer;
  };
  for (const file of git("ls-tree", "-r", "--name-only", "HEAD", "examples/hello/").toString().split("\n").filter(Boolean)) {
    const target = join(dir, file.slice("examples/hello/".length));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git("show", `HEAD:${file}`));
  }
  return dir;
}

interface Session {
  send(method: string, params?: object): Promise<any>;
  on(method: string, listener: (params: any) => void): () => void;
  close(): void;
}

async function session(wsUrl: string): Promise<Session> {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(params: any) => void>>();
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.method) for (const listener of listeners.get(msg.method) ?? []) listener(msg.params);
    const waiter = msg.id && pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  };
  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    on: (method, listener) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method)!.add(listener);
      return () => listeners.get(method)?.delete(listener);
    },
    close: () => ws.close(),
  };
}

export async function launchApp(options: LaunchOptions = {}): Promise<App> {
  if (!existsSync(join(REPO, "out", "main", "index.js"))) throw new Error("run npm run build:app first");
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
  const preferences = { language: options.language ?? "en", theme: options.theme ?? "dark", fontScale: 1, uiFont: "", codeFont: "" };
  const recent = options.project ? [{ dir: options.project, name: "UI test", openedAt: new Date().toISOString(), ...(options.kind ? { kind: options.kind } : {}) }] : [];
  if (!options.userData || !existsSync(join(userData, "app-state.json"))) writeFileSync(join(userData, "app-state.json"), JSON.stringify({ exportFolders: {}, recent, preferences }, null, 2));

  const port = await freePort();
  const inspectPort = await freePort();
  // MCEDGE_APP_EXE runs a packaged build (release/win-unpacked/MCEdge.exe) instead of this checkout.
  const packaged = process.env.MCEDGE_APP_EXE;
  const child: ChildProcess = spawn(packaged ?? ELECTRON, [`--inspect=${inspectPort}`, ...(packaged ? [] : ["."]), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`,
    // The test window is often behind other windows; keep it painting (Monaco renders on animation frames).
    "--disable-features=CalculateNativeWinOcclusion", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"], {
    cwd: REPO,
    // The window stays hidden (never shown or focused) unless UI_TEST_VISIBLE=1; CDP screenshots still work.
    env: { ...process.env, ELECTRON_RENDERER_URL: "", MCEDGE_USER_DATA: userData, MCEDGE_TEST_HIDDEN: process.env.UI_TEST_VISIBLE === "1" ? "" : "1",
      // Game clients the tested app starts are silent (MCEDGE_TEST_SOUND=1 keeps the sound).
      MCEDGE_MUTE_CLIENTS: process.env.MCEDGE_TEST_SOUND === "1" ? "" : "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (d: Buffer) => process.env.UI_TEST_VERBOSE && process.stderr.write(d));

  const target = async (p: number, type: string) => {
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${p}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        const url = targets.find((t) => t.type === type)?.webSocketDebuggerUrl;
        if (url) return url;
      } catch {
        // not listening yet
      }
    }
    throw new Error("app did not start");
  };
  const page = await session(await target(port, "page"));
  const main = await session(await target(inspectPort, "node"));
  const send = page.send;

  await send("Emulation.setDeviceMetricsOverride", { width: options.width ?? 1440, height: options.height ?? 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${expression}\n${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value as T;
  };
  const find = (selector: string, text?: string) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text === undefined ? "true" : `e.textContent.includes(${JSON.stringify(text)})`})`;
  const rect = async (selector: string, text?: string) => {
    const r = await evaluate<{ x: number; y: number; width: number; height: number } | null>(
      `(() => { const e = ${find(selector, text)}; if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    if (!r) throw new Error(`not found: ${selector} ${text ?? ""}`);
    return r;
  };
  const center = async (selector: string, text?: string): Promise<[number, number]> => {
    const r = await rect(selector, text);
    return [r.x + r.width / 2, r.y + r.height / 2];
  };
  const mouse = (type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number, buttons = 1, button = "left", clickCount = 1) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && buttons === 0 ? "none" : button, buttons, clickCount });

  const mainEval = async <T>(expression: string): Promise<T> => {
    const result = await main.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
    if (result.exceptionDetails) throw new Error(`main: ${expression}\n${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value as T;
  };

  const app: App = {
    userData,
    eval: evaluate,
    cdp: send,
    onCdp: page.on,
    mainEval,
    async mockDialogs(dialogs) {
      await mainEval(`(() => {
        const { dialog } = (process.mainModule ? process.mainModule.require : require)("electron");
        const d = ${JSON.stringify(dialogs)};
        if (d.open) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: d.open });
        if (d.save) dialog.showSaveDialog = async () => ({ canceled: false, filePath: d.save });
        return true;
      })()`);
    },
    async waitFor(expression, timeoutMs = 10000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        if (await evaluate(`!!(${expression})`).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`timeout waiting for ${expression}`);
    },
    async click(selector, text, opts = {}) {
      const [x, y] = await center(selector, text);
      const button = opts.button ?? "left";
      const buttons = button === "left" ? 1 : 2;
      await mouse("mouseMoved", x, y, 0);
      await mouse("mousePressed", x, y, buttons, button, 1);
      await mouse("mouseReleased", x, y, 0, button, 1);
      if (opts.double) {
        await mouse("mousePressed", x, y, buttons, button, 2);
        await mouse("mouseReleased", x, y, 0, button, 2);
      }
      await sleep(80);
    },
    async drag(from, to, steps = 8) {
      await mouse("mouseMoved", from[0], from[1], 0);
      await mouse("mousePressed", from[0], from[1]);
      for (let i = 1; i <= steps; i++) {
        await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, 1);
      }
      await mouse("mouseReleased", to[0], to[1], 0);
      await sleep(80);
    },
    mouse: (type, x, y, buttons = type === "mouseReleased" ? 0 : 1) => mouse(type, x, y, buttons),
    async wheel(x, y, deltaY, modifiers = 0) {
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY, modifiers });
      await sleep(120);
    },
    center,
    rect,
    async type(text) {
      await send("Input.insertText", { text });
      await sleep(50);
    },
    async setField(label, value, scope = "") {
      const selector = `${scope} .frow`;
      const rowOf = `[...document.querySelectorAll(${JSON.stringify(selector)})].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label)})`;
      // A procedure field is a searchable list: open it, search the id, click the row.
      if (await evaluate<boolean>(`!!${rowOf}?.querySelector(".procpicker")`)) {
        await evaluate(`${rowOf}.querySelector(".procpicked").click()`);
        await sleep(150);
        await evaluate(`(() => { const e = document.querySelector(".proclistpop input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await sleep(150);
        const picked = await evaluate<boolean>(`(() => { const r = [...document.querySelectorAll(".proclistpop .procrow")].find((r) => r.title === ${JSON.stringify(value)}); r?.click(); return !!r; })()`);
        if (!picked) throw new Error(`procedure not in the list: ${value}`);
        await sleep(80);
        return;
      }
      const ok = await evaluate<boolean>(`(() => {
        const row = ${rowOf};
        const e = row?.querySelector("input:not([type=checkbox]), select, textarea");
        if (!e) return false;
        const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(e, ${JSON.stringify(value)});
        e.dispatchEvent(new Event("input", { bubbles: true }));
        e.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      if (!ok) throw new Error(`field not found: ${label}`);
      await sleep(80);
    },
    async setValue(selector, value, text) {
      const ok = await evaluate<boolean>(`(() => {
        const e = ${find(selector, text)};
        if (!e) return false;
        const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(e, ${JSON.stringify(value)});
        e.dispatchEvent(new Event("input", { bubbles: true }));
        e.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      if (!ok) throw new Error(`not found: ${selector}`);
      await sleep(80);
    },
    async key(key, modifiers = 0) {
      const named: Record<string, { code: string; keyCode: number }> = {
        Enter: { code: "Enter", keyCode: 13 }, Escape: { code: "Escape", keyCode: 27 }, Delete: { code: "Delete", keyCode: 46 },
        Backspace: { code: "Backspace", keyCode: 8 }, ArrowLeft: { code: "ArrowLeft", keyCode: 37 }, ArrowUp: { code: "ArrowUp", keyCode: 38 },
        ArrowRight: { code: "ArrowRight", keyCode: 39 }, ArrowDown: { code: "ArrowDown", keyCode: 40 }, Tab: { code: "Tab", keyCode: 9 },
        F2: { code: "F2", keyCode: 113 }, F5: { code: "F5", keyCode: 116 }, Home: { code: "Home", keyCode: 36 }, End: { code: "End", keyCode: 35 },
        " ": { code: "Space", keyCode: 32 },
      };
      const info = named[key] ?? { code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0) };
      const base = { key, code: info.code, windowsVirtualKeyCode: info.keyCode, modifiers };
      // Enter needs a keyDown with text, or forms are not submitted.
      if (key === "Enter") await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: "\r", unmodifiedText: "\r" });
      else await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(50);
    },
    async shot(file) {
      const path = resolve(REPO, file);
      mkdirSync(dirname(path), { recursive: true });
      await sleep(150);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(data, "base64"));
      console.log(`screenshot ${file}`);
    },
    async setTheme(theme) {
      const current = await evaluate<string>("document.documentElement.dataset.theme");
      if (current !== theme) await app.click(".themebtn");
      await app.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
    },
    sleep,
    async close() {
      page.close();
      main.close();
      if (child.pid && child.exitCode === null) {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
        else child.kill();
      }
      await sleep(300);
      try {
        if (!options.userData) rmSync(userData, { recursive: true, force: true });
      } catch {
        // Chromium may still hold a lock for a moment; the temp folder is left behind then.
      }
    },
  };

  if (options.project) {
    await app.waitFor(`document.querySelector(".grid tbody tr")`);
    await app.click(".grid tbody tr", undefined, { double: true });
    await app.waitFor(`document.querySelector(".rail, .codeview")`);
  }
  return app;
}

/** Runs a test body and always closes the app, exiting non-zero on failure. */
export async function run(body: (app: App) => Promise<void>, options: LaunchOptions = {}): Promise<void> {
  const app = await launchApp(options);
  try {
    await body(app);
    console.log("PASS");
  } catch (error) {
    console.error("FAIL", error);
    await app.shot("tools/ui-test/last-failure.png").catch(() => {});
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}
