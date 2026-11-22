/**
 * Q201: Help > Connect an AI agent and the Agents panel's Connect button show the command that starts this app's MCP
 * server on the open project (the exe run as Node on out/cli/index.js) and the Claude Code, Codex and mcpServers JSON
 * setups built from it; Copy puts a setup on the clipboard. Dark, light and Turkish; screenshots go to design/201/.
 * MCEDGE_APP_EXE checks a packaged or installed build instead (its exe and app.asar paths).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert } from "../mcp-test/client.ts";
import { exampleProject, launchApp, REPO, evidence } from "./cdp.ts";

const project = exampleProject();
const OUT = evidence("design/201");
mkdirSync(join(REPO, OUT), { recursive: true });
const exe = process.env.MCEDGE_APP_EXE ?? join(REPO, "node_modules", "electron", "dist", "electron.exe");
const script = process.env.MCEDGE_APP_EXE ? join(exe, "..", "resources", "app.asar", "out", "cli", "index.js") : join(REPO, "out", "cli", "index.js");
const snippet = (id: string) => `document.querySelector('[data-snippet="${id}"] pre').textContent`;

for (const language of ["en", "tr"] as const) {
  const s = language === "en" ? en : tr;
  const app = await launchApp({ project, language });
  try {
    await app.waitFor(`document.querySelector(".menubar")`, 15000);
    await app.click(".menu", s["menu.help"]);
    await app.click(".menulist button", s["menu.connectAgent"]);
    await app.waitFor(`document.querySelector('[data-snippet="json"] pre')`, 10000);
    assert(await app.eval<string>(`document.querySelector(".connectdlg .ptitle").textContent`) === s["connect.title"], `${language}: Help > ${s["menu.connectAgent"]} opens the dialog`);

    const command = await app.eval<string>(snippet("command"));
    assert(command === `"${exe}" "${script}" "mcp" "${project}"`, `${language}: command ${command}`);
    const json = JSON.parse(await app.eval<string>(snippet("json")));
    assert(JSON.stringify(json) === JSON.stringify({ mcpServers: { mcedge: { command: exe, args: [script, "mcp", project], env: { ELECTRON_RUN_AS_NODE: "1" } } } }),
      `${language}: mcpServers JSON has the exe, the bundled CLI, the project and ELECTRON_RUN_AS_NODE`);
    const claude = await app.eval<string>(snippet("claude"));
    assert(claude === `claude mcp add --transport stdio --env ELECTRON_RUN_AS_NODE=1 mcedge -- ${command}`, `${language}: Claude Code command`);
    const codex = await app.eval<string>(snippet("codex"));
    assert(codex.startsWith("[mcp_servers.mcedge]\n") && codex.includes(`command = ${JSON.stringify(exe)}`) && codex.includes(`env = { ELECTRON_RUN_AS_NODE = "1" }`), `${language}: Codex config.toml`);
    assert(!(await app.eval<boolean>(`!!document.querySelector('[data-testid="connect-portable"]')`)), `${language}: no portable warning`);

    await app.click('[data-snippet="claude"] button');
    await app.waitFor(`document.querySelector('[data-snippet="claude"] button').textContent.includes(${JSON.stringify(s["dataLists.copied"])})`);
    const copied = await app.mainEval<string>(`(process.mainModule ? process.mainModule.require : require)("electron").clipboard.readText()`);
    assert(copied === claude, `${language}: Copy puts the Claude Code command on the clipboard`);

    await app.shot(`${OUT}/connect-${language}-dark.png`);
    await app.key("Escape");
    await app.waitFor(`!document.querySelector(".connectdlg")`);
    if (language === "en") {
      await app.setTheme("light");
      await app.click(".menu", s["menu.help"]);
      await app.click(".menulist button", s["menu.connectAgent"]);
      await app.waitFor(`document.querySelector('[data-snippet="json"] pre')`, 10000);
      await app.shot(`${OUT}/connect-${language}-light.png`);
      await app.key("Escape");
      await app.setTheme("dark");
    }

    // The Agents panel offers the same dialog.
    await app.click(".menu", s["menu.window"]);
    await app.click(".menulist button", s["panel.problems"]);
    await app.click(".ptab", s["panel.agents"]);
    await app.waitFor(`document.querySelector(".agconnect")`, 10000);
    assert(await app.eval<string>(`document.querySelector(".agconnect").textContent`) === s["agents.connect"], `${language}: Agents panel has ${s["agents.connect"]}`);
    if (language === "en") await app.shot(`${OUT}/agents-panel-${language}-dark.png`);
    await app.click(".agconnect");
    await app.waitFor(`document.querySelector('[data-snippet="command"] pre')`, 10000);
    assert(await app.eval<string>(snippet("command")) === command, `${language}: the Agents panel button opens the same setup`);
  } finally {
    await app.close();
  }
}
console.log("connect agent: all checks passed");
