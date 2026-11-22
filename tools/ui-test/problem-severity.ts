/**
 * KUYRUK 196: the Problems panel shows each problem's severity (error, warning, info), ignores a warning or info
 * problem (row button) or a whole check (right-click), lists the ignored ones behind "Show ignored (N)" with an undo,
 * and changes a check's severity. A copy of examples/hello gets one problem of each severity: ruby's durability past
 * its 128000 soft limit (info), a bad language code (warning), a duplicate variable (error). Screenshots go to
 * design/196/ (LIGHT=1 light theme, TR=1 Turkish).
 *   node tools/ui-test/problem-severity.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../config/ui-strings/en.json" with { type: "json" };
import tr from "../../config/ui-strings/tr.json" with { type: "json" };
import { assert, exampleProject, run, evidence } from "./cdp.ts";

const OUT = evidence("design/196");
const theme = process.env.LIGHT ? "light" : "dark";
const language = process.env.TR ? "tr" : "en";
const s = (language === "tr" ? tr : en) as Record<string, string>;
const text = (key: string, count?: number) => s[key].replace("{count}", String(count));
const suffix = `${language === "tr" ? "tr-" : ""}${theme}`;

const project = exampleProject();
const edit = (file: string, change: (value: any) => void) => {
  const value = JSON.parse(readFileSync(join(project, file), "utf8"));
  change(value);
  writeFileSync(join(project, file), JSON.stringify(value, null, 2) + "\n");
};
edit("elements/items/ruby.json", (ruby) => (ruby.damageCount = 187500));
writeFileSync(join(project, "localization", "english.json"), JSON.stringify({ "item.hellomcedge.ruby": "Ruby" }));
edit("variables.json", (vars) => vars.variables.push({ ...vars.variables[0] }));
const settings = () => (existsSync(join(project, "problems.json")) ? JSON.parse(readFileSync(join(project, "problems.json"), "utf8")) : {});

const rows = `[...document.querySelectorAll(".problems li[data-severity]")]`;
const severities = `${rows}.map((li) => (li.classList.contains("ignored") ? "ignored " : "") + li.dataset.severity + " " + li.querySelector("code").textContent)`;
const row = (path: string) => `${rows}.find((li) => li.querySelector("code").textContent === ${JSON.stringify(path)})`;

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`);
  if (theme === "light") await app.setTheme("light");
  await app.click(".sitem", text("status.problems", 3));
  await app.waitFor(`${rows}.length === 3`);
  const listed = await app.eval<string[]>(severities);
  assert(listed.join() === "info item/ruby.damageCount,error variables[2].name,warning localization.english", `severities: ${listed}`);
  // Icons: errors and warnings draw the warning sign in their colour, info its own glyph; only errors lack Ignore.
  const look = await app.eval<Record<string, { color: string; ignore: boolean }>>(`Object.fromEntries(${rows}.map((li) => [li.dataset.severity,
    { color: getComputedStyle(li.querySelector(".psev .ico")).color, ignore: !!li.querySelector(".pact") }]))`);
  assert(new Set(Object.values(look).map((l) => l.color)).size === 3, `three icon colours: ${JSON.stringify(look)}`);
  assert(!look.error.ignore && look.warning.ignore && look.info.ignore, `Ignore on warnings and info only: ${JSON.stringify(look)}`);
  await app.shot(`${OUT}/severities-${suffix}.png`);

  // Ignore one problem with its row button.
  await app.eval(`${row("item/ruby.damageCount")}.querySelector(".pact").click()`);
  await app.waitFor(`${rows}.length === 2`);
  assert(settings().ignore?.[0]?.path === "item/ruby.damageCount", `problems.json: ${JSON.stringify(settings())}`);
  assert(await app.eval(`document.querySelector(".ptoggle").textContent === ${JSON.stringify(text("problems.showIgnored", 1))}`), "Show ignored (1)");
  assert(await app.eval(`document.querySelector(".sitem.warn")?.textContent.includes(${JSON.stringify(text("status.problems", 2))})`), "status bar counts 2");

  // Ignore the whole language code check from the right-click menu; errors offer no Ignore there.
  await app.click(".problems li", "variables[2].name", { button: "right" });
  assert(!(await app.eval<boolean>(`[...document.querySelectorAll(".ctx button")].some((b) => b.textContent === ${JSON.stringify(s["problems.ignore"])})`)), "no Ignore on an error");
  await app.key("Escape");
  await app.click(".problems li", "localization.english", { button: "right" });
  await app.click(".ctx button", s["problems.ignoreCheck"]);
  await app.waitFor(`${rows}.length === 1 && document.querySelector(".ptoggle").textContent === ${JSON.stringify(text("problems.showIgnored", 2))}`);
  assert(settings().ignoreChecks?.join() === "languageCode", "ignored check saved");

  // Show the ignored problems; undo one with its row button.
  await app.click(".ptoggle button");
  await app.waitFor(`${rows}.length === 3`);
  assert((await app.eval<string[]>(severities)).filter((r) => r.startsWith("ignored")).length === 2, "ignored rows are marked");
  await app.shot(`${OUT}/ignored-shown-${suffix}.png`);
  await app.eval(`${row("item/ruby.damageCount")}.querySelector(".pact").click()`);
  await app.waitFor(`${row("item/ruby.damageCount")} && !${row("item/ruby.damageCount")}.classList.contains("ignored")`);
  assert(await app.eval(`document.querySelector(".ptoggle").textContent === ${JSON.stringify(text("problems.hideIgnored", 1))}`), "Hide ignored (1)");
  assert(!settings().ignore, "undo removed the ignored problem");

  // Severity: stop ignoring the check, raise it to error (no Ignore button), then back to warning.
  await app.click(".problems li", "localization.english", { button: "right" });
  await app.click(".ctx button", s["problems.unignoreCheck"]);
  await app.waitFor(`!document.querySelector(".ptoggle") && ${rows}.length === 3`);
  await app.click(".problems li", "localization.english", { button: "right" });
  await app.click(".ctx button", s["problems.asError"]);
  await app.waitFor(`${row("localization.english")}?.dataset.severity === "error"`);
  assert(!(await app.eval(`${row("localization.english")}.querySelector(".pact")`)), "an error has no Ignore button");
  assert(settings().severity?.languageCode === "error", "severity saved");
  await app.shot(`${OUT}/raised-${suffix}.png`);
  await app.click(".problems li", "localization.english", { button: "right" });
  await app.click(".ctx button", s["problems.asWarning"]);
  await app.waitFor(`${row("localization.english")}?.dataset.severity === "warning"`);
  assert(!existsSync(join(project, "problems.json")), "back to defaults removes problems.json");

  // An agent's ignore over MCP (a write to problems.json) reaches the open panel through the watcher.
  writeFileSync(join(project, "problems.json"), JSON.stringify({ ignore: [{ code: "unusualHigh", path: "item/ruby.damageCount" }] }));
  await app.waitFor(`${row("item/ruby.damageCount")}?.classList.contains("ignored")`);
}, { project, language });
