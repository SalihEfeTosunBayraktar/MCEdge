/**
 * Q240: Java editing in code project mode on a copy of ETREconomy-Legacy (Forge 1.16.5). Opens EtrecoMod.java,
 * waits for jdtls to import the Gradle project, then with real key presses: Ctrl+Space after
 * `net.minecraft.item.ItemStack.EMPTY.` lists Minecraft classpath members, Ctrl+Space inside a string lists the mod's
 * own registry ids, and a client-only call in this common class gets a side warning marker; the file's side badge
 * reads Common. Runs in en, then tr on the same user data (jdtls workspace reused). Screenshots to design/240/.
 * Heavy: needs the jdtls download and a Gradle import (first run several minutes).
 *   node tools/ui-test/java-completion.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, copyProject, launchApp, type App, evidence } from "./cdp.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame); not starting the app");

const project = copyProject("C:\\MyProjects\\AI-Assisted\\ETREconomy-Legacy", "ETREconomy-Legacy");
const userData = mkdtempSync(join(tmpdir(), "mcedge-ui-data-"));
const OUT = evidence("design/240");
const TEXTS = {
  en: { common: "Common", ready: "Java: ready", side: "Client-only API (net.minecraft.client.Minecraft.getInstance) in common code" },
  tr: { common: "Ortak", ready: "Java: hazır", side: "Yalnız istemcide olan API (net.minecraft.client.Minecraft.getInstance) ortak kodda" },
};

const rows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".suggest-widget.visible .monaco-list-row")].map((r) => r.innerText.replace(/\\s+/g, " "))`);
const waitRow = async (app: App, text: string, what: string) => {
  // jdtls may answer the first request with an incomplete list; Ctrl+Space again until the row is there.
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    await app.key(" ", 2);
    for (let i = 0; i < 20; i++) {
      if ((await rows(app)).some((r) => r.includes(text))) return;
      await app.sleep(250);
    }
    await app.key("Escape");
  }
  throw new Error(`${what}: no "${text}" row; rows were ${JSON.stringify(await rows(app))}`);
};

async function session(language: "en" | "tr") {
  const text = TEXTS[language];
  if (language === "tr") {
    const state = JSON.parse(readFileSync(join(userData, "app-state.json"), "utf8"));
    state.preferences.language = "tr";
    writeFileSync(join(userData, "app-state.json"), JSON.stringify(state, null, 2));
  }
  const app = await launchApp({ project, kind: "code", language, userData });
  let ids: number[] = [];
  try {
    await app.waitFor(`document.querySelectorAll(".codetree .trow").length > 5`, 20000);
    await app.click(".codetree .trow", "etreco");
    await app.click(".codetree .trow", "EtrecoMod.java");
    await app.waitFor(`document.querySelector(".monaco-editor .view-lines")?.innerText.replace(/\u00a0/g, " ").includes("package etreco")`, 15000);
    await app.waitFor(`document.querySelector(".codestatus .sidebadge")?.textContent === ${JSON.stringify(text.common)}`, 10000);
    // Editing works while jdtls starts; the status line says what it is doing.
    const early = await app.eval<string>(`document.querySelector(".codestatus .javastatus")?.textContent ?? ""`);
    console.log(`status while starting: ${early}`);
    await app.waitFor(`document.querySelector(".codestatus .javastatus.ready")`, 20 * 60_000);
    assert((await app.eval<string>(`document.querySelector(".codestatus .javastatus").textContent`)) === text.ready, "status reads ready");
    assert(![".project", ".classpath", ".settings"].some((name) => existsSync(join(project, name))), "jdtls wrote no Eclipse files into the mod");

    // Classpath members: a new line in the constructor.
    await app.click(".view-line", "EtrecoMod()");
    await app.key("End");
    await app.key("Enter");
    await app.type("net.minecraft.item.ItemStack.EMPTY.getC");
    await waitRow(app, "getCount", "classpath completion");
    console.log(`classpath rows: ${(await rows(app)).slice(0, 4).join(" | ")}`);
    await app.shot(`${OUT}/completion-${language}-dark.png`);
    await app.key("Escape");
    await app.type("ount();");
    await app.key("Enter");

    // The mod's own ids inside a string.
    await app.type(`LOGGER.info("etreco:admin_b`);
    await waitRow(app, "etreco:admin_book", "registry id completion");
    await app.shot(`${OUT}/registry-${language}-dark.png`);
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".monaco-editor .view-lines").innerText.replace(/\u00a0/g, " ").includes('"etreco:admin_book"')`, 5000);
    await app.key("End");
    await app.type(";");
    await app.key("Enter");

    // Client-only API in this common class: a warning marker with the side message.
    await app.type("net.minecraft.client.Minecraft.getInstance();");
    // The squiggle on the line just typed (the file may have other warnings).
    const squiggle = `(() => {
      const line = [...document.querySelectorAll(".monaco-editor .view-line")].find((l) => l.textContent.includes("net.minecraft.client.Minecraft"));
      const top = line && line.getBoundingClientRect().top;
      const s = [...document.querySelectorAll(".monaco-editor .squiggly-warning")].find((e) => Math.abs(e.getBoundingClientRect().top - top) < 4);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`;
    await app.waitFor(squiggle, 10000);
    const [x, y] = await app.eval<[number, number]>(squiggle);
    await app.mouse("mouseMoved", x, y);
    await app.waitFor(`[...document.querySelectorAll(".monaco-hover")].some((h) => h.innerText.replace(/\u00a0/g, " ").includes(${JSON.stringify(text.side)}))`, 10000);
    assert(!(await app.eval<boolean>(`!!document.querySelector(".monaco-editor .squiggly-error")`)), "the typed lines compile (no error marker)");
    await app.shot(`${OUT}/side-${language}-dark.png`);
    await app.setTheme("light");
    await app.mouse("mouseMoved", x, y + 1);
    await app.sleep(800);
    await app.shot(`${OUT}/side-${language}-light.png`);
    await app.setTheme("dark");

    // jdtls (and the Gradle daemon it started) run under the app; they must end with it.
    const electron = await app.mainEval<number>("process.pid");
    const out = spawnSync("powershell", ["-NoProfile", "-Command", `$all = Get-CimInstance Win32_Process; $ids = @(${electron}); $i = 0; while ($i -lt $ids.Count) { $ids += @($all | ? { $_.ParentProcessId -eq $ids[$i] } | % { $_.ProcessId }); $i++ }; ($all | ? { ($ids -contains $_.ProcessId) -and $_.Name -eq 'java.exe' } | % { $_.ProcessId }) -join ','`], { encoding: "utf8" }).stdout.trim();
    ids = out.split(",").filter(Boolean).map(Number);
    assert(ids.length >= 1, `jdtls runs under the app (${ids.join(",")})`);
    console.log(`PASS ${language}`);
  } catch (error) {
    await app.shot("tools/ui-test/last-failure.png").catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
  await new Promise((r) => setTimeout(r, 1500));
  const alive = spawnSync("powershell", ["-NoProfile", "-Command", `@(Get-Process -Id ${ids.join(",") || 0} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" }).stdout.trim();
  assert(alive === "0", `java processes of the app gone after close (${alive} left)`);
}

await session("en");
await session("tr");
console.log("PASS java-completion");
