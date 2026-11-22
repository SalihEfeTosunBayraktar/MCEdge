/**
 * Q207: an installed MCEdge updates itself to the next version, end to end. Manual and slow (two installer builds,
 * about 10 minutes); it needs no GitHub release and no network.
 *   node tools/ui-test/auto-update.ts
 *
 * 1. Builds the Setup exe of this version and of the next patch version (electron-builder extraMetadata, so
 *    package.json is not changed) into a temp folder, and adds release notes to the new latest.yml.
 * 2. Installs this version silently (per user, the installer's default) into a temp folder.
 * 3. Serves the new latest.yml, Setup exe and blockmap from http://127.0.0.1 (throttled, so the download is seen) and
 *    starts the installed app with MCEDGE_UPDATE_FEED pointing there and its own LOCALAPPDATA (updater cache).
 * 4. Status bar: downloading with percent, then ready; the dialog shows the notes; Restart now asks first while a game
 *    run is active; screenshots in design/207/ (dark, light, tr).
 * 5. Restart now: the installer replaces the app and starts it; the exe becomes the new version, which reports it
 *    over CDP and finds no newer update. Then the app is uninstalled silently.
 * Refuses to run when MCEdge is already installed for this user; the desktop MCEdge.lnk must stay as it was.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, launchApp, REPO, type App, evidence } from "./cdp.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ps = (command: string) => spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" }).stdout.trim();
const uninstallKey = () => ps(`Get-ChildItem HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -eq 'MCEdge' } | ForEach-Object PSChildName`);
const fileVersion = (exe: string) => ps(`(Get-Item '${exe}').VersionInfo.FileVersion`);
/** MCEdge processes started from the test's install folder (the installer's relaunch); never the user's own. */
const installedPids = (dir: string) => ps(`Get-CimInstance Win32_Process -Filter "Name='MCEdge.exe'" | Where-Object { $_.ExecutablePath -like '${dir}\\*' } | ForEach-Object ProcessId`).split(/\s+/).filter(Boolean);
async function until(what: string, test: () => boolean, timeoutMs: number): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(500)) if (test()) return;
  throw new Error(`timeout: ${what}`);
}

const current = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version;
const next = current.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const work = mkdtempSync(join(tmpdir(), "mcedge-auto-update-"));
const installDir = join(work, "installed");
const exe = join(installDir, "MCEdge.exe");
const desktopLink = join(ps("[Environment]::GetFolderPath('Desktop')"), "MCEdge.lnk");
const readOrNull = (file: string) => (existsSync(file) ? readFileSync(file) : null);
const desktopBefore = readOrNull(desktopLink);
// The installer's relaunch runs with the user's environment, so it reads the real user data folder: kept as it was.
const userState = ["app-state.json", "texture-drafts.json"].map((name) => join(process.env.APPDATA!, "MCEdge", name)).map((file) => ({ file, data: readOrNull(file) }));
const shots = evidence("design/207");

// electron-builder cannot collect the app's dependencies through a node_modules junction (a worktree's): the packaged app would lack
// electron-updater and not start. Say so instead of failing with "app did not start"; the test needs a checkout with its own node_modules.
if (lstatSync(join(REPO, "node_modules")).isSymbolicLink()) {
  console.log("SKIP auto-update: node_modules is a link (worktree), so the installer would be built without its dependencies");
  process.exit(0);
}
if (uninstallKey()) throw new Error("MCEdge is installed for this user; the test would replace it");
console.log(`work folder ${work}; ${current} -> ${next}`);

// 1. Both installers.
const sh = (...args: string[]) => {
  const result = spawnSync(args[0], args.slice(1), { cwd: REPO, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed`);
};
sh("npm", "run", "build:app");
for (const version of [current, next]) {
  sh("npx", "electron-builder", "--win", "nsis", "--publish", "never", `-c.directories.output=${join(work, version)}`, `-c.extraMetadata.version=${version}`);
}
const feedDir = join(work, next);
appendFileSync(join(feedDir, "latest.yml"), "releaseNotes: |\n  Update test build.\n\n  - Update progress in the status bar\n  - Restart now installs the update\n");

// 3. Local feed, about 8 MB/s.
const server = createServer((request, response) => {
  const file = join(feedDir, decodeURIComponent((request.url ?? "/").split("?")[0]).replace(/^\/+/, ""));
  if (!file.startsWith(feedDir) || !existsSync(file) || statSync(file).isDirectory()) return void response.writeHead(404).end();
  response.writeHead(200, { "Content-Length": statSync(file).size });
  const stream = createReadStream(file, { highWaterMark: 1 << 20 });
  stream.on("data", (chunk) => {
    response.write(chunk);
    if (file.endsWith(".exe")) (stream.pause(), setTimeout(() => stream.resume(), 125));
  });
  stream.on("end", () => response.end());
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
const feed = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
process.env.MCEDGE_APP_EXE = exe;
process.env.MCEDGE_UPDATE_FEED = feed;
process.env.LOCALAPPDATA = join(work, "localappdata");
mkdirSync(process.env.LOCALAPPDATA, { recursive: true });

const item = `document.querySelector("[data-testid=update-item]")`;
const status = (app: App) => app.eval<string | null>(`${item}?.dataset.status ?? null`);
let failed = false;
let app: App | undefined;
try {
  // 2. Silent install of this version.
  spawnSync(join(work, current, `MCEdge-Setup-${current}.exe`), ["/S", `/D=${installDir}`], { stdio: "inherit" });
  await until(`installed ${current}`, () => existsSync(exe) && !!uninstallKey() && fileVersion(exe) === current, 120000);

  // 4. The update arrives in the status bar.
  app = await launchApp();
  await app.waitFor(`${item}?.dataset.status === "downloading"`, 60000);
  await app.waitFor(`/[1-9]\\d*%/.test(${item}.textContent)`, 30000);
  const progress = await app.eval<string>(`${item}.textContent`);
  console.log(`status bar: ${progress}`);
  assert(progress.includes(next), "names the new version");
  await app.shot(`${shots}/downloading-dark.png`);
  await app.setTheme("light");
  if ((await status(app)) === "downloading") await app.shot(`${shots}/downloading-light.png`);
  await app.waitFor(`${item}?.dataset.status === "ready"`, 180000);
  console.log(`status bar: ${await app.eval<string>(`${item}.textContent`)}`);
  for (const theme of ["light", "dark"] as const) {
    await app.setTheme(theme);
    await app.shot(`${shots}/ready-${theme}.png`);
    await app.click("[data-testid=update-item] button.sitem");
    await app.waitFor(`document.querySelector("[data-testid=update-notes]")`);
    const notes = await app.eval<string>(`document.querySelector("[data-testid=update-notes]").textContent`);
    assert(notes.includes("Update progress in the status bar"), "the dialog shows the release notes");
    await app.shot(`${shots}/notes-${theme}.png`);
    await app.click(".updatedlg .abtn", "Later");
  }

  // Restart now while a game client runs (a build event as the app's own client run sends it) asks first.
  const fakeRun = (type: string) => app!.mainEval(`(process.mainModule ? process.mainModule.require : require)("electron").BrowserWindow.getAllWindows()[0].webContents.send("build:event", { type: ${JSON.stringify(type)}, engineId: "forge-1.16.5 client", ok: false, stopped: true })`);
  await fakeRun("start");
  await app.click("[data-testid=update-item-restart]");
  await app.waitFor(`document.querySelector("[data-testid=update-game-running]")`);
  await app.shot(`${shots}/game-running-dark.png`);
  await app.click(".updatedlg .abtn", "Later");
  await fakeRun("done");
  assert(await app.eval<boolean>(`!document.querySelector(".updatedlg")`), "Later keeps the app running");

  // Turkish.
  await app.click("button", "Preferences");
  await app.setField("Interface language", "tr", ".prefsdialog");
  await app.key("Escape");
  await app.waitFor(`${item}.textContent.includes("hazır")`);
  await app.shot(`${shots}/ready-tr-dark.png`);
  await app.click("[data-testid=update-item] button.sitem");
  await app.waitFor(`document.querySelector("[data-testid=update-notes]")`);
  await app.shot(`${shots}/notes-tr-dark.png`);
  await app.click(".updatedlg .abtn", "Sonra");
  await app.click("[data-testid=update-item] .mbtn", "Sonra");
  await app.waitFor(`${item}.textContent.includes("Güncellemek için yeniden başlat")`);
  await app.shot(`${shots}/later-tr-dark.png`);

  // 5. Restart now: install, relaunch, new version.
  await app.click("[data-testid=update-item] button.sitem");
  await app.click("[data-testid=update-restart]");
  await until(`exe version ${next}`, () => fileVersion(exe) === next, 180000);
  console.log(`installed exe version: ${fileVersion(exe)}`);
  await until("relaunched app", () => installedPids(installDir).length > 0, 60000);
  console.log(`relaunched by the installer: pid ${installedPids(installDir).join(", ")}`);
  await sleep(3000);
  for (const pid of installedPids(installDir)) spawnSync("taskkill", ["/pid", pid, "/T", "/F"]);
  await app.close();
  app = await launchApp();
  const version = await app.mainEval<string>(`(process.mainModule ? process.mainModule.require : require)("electron").app.getVersion()`);
  console.log(`app.getVersion() after the update: ${version}`);
  assert(version === next, `the installed app is ${next}`);
  await app.click(".menubar .menu", "Help");
  await app.click(".menulist button", "Check for updates");
  await app.waitFor(`document.querySelector("[data-testid=update-status]")?.dataset.status === "latest"`, 30000);
  console.log(`Help > Check for updates: ${await app.eval<string>(`document.querySelector("[data-testid=update-status]").textContent`)}`);
  console.log("PASS");
} catch (error) {
  failed = true;
  console.error("FAIL", error);
  await app?.shot("tools/ui-test/last-failure.png").catch(() => {});
} finally {
  await app?.close().catch(() => {});
  server.close();
  for (const pid of installedPids(installDir)) spawnSync("taskkill", ["/pid", pid, "/T", "/F"]);
  if (existsSync(join(installDir, "Uninstall MCEdge.exe"))) {
    spawnSync(join(installDir, "Uninstall MCEdge.exe"), ["/S", "/currentuser"], { stdio: "inherit" });
    await until("uninstalled", () => !existsSync(exe) && !uninstallKey(), 120000).catch((e) => ((failed = true), console.error(e)));
  }
  for (const { file, data } of userState) {
    const now = readOrNull(file);
    if (data && !now?.equals(data)) writeFileSync(file, data);
  }
  const desktopAfter = readOrNull(desktopLink);
  const desktopKept = desktopBefore === null ? desktopAfter === null : !!desktopAfter?.equals(desktopBefore);
  console.log(`uninstalled: ${!existsSync(exe) && !uninstallKey()}; desktop MCEdge.lnk unchanged: ${desktopKept}`);
  if (!desktopKept) failed = true;
  if (failed) process.exitCode = 1;
  else rmSync(work, { recursive: true, force: true });
}
