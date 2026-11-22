/**
 * Q248: audit of keyboard use and screen reader support. Opens every main view, every element editor and the dialogs
 * of a copy of examples/hello (hidden window) and lists, per state:
 *   unnamed    interactive elements with no accessible name (Chromium's accessibility tree, Accessibility.getFullAXTree)
 *   clickable  clickable elements that are not buttons (a div or span with onClick, no role, not focusable)
 *   role       groups with no role or state (tabs, lists, menus, dialogs, a selection that is only a style)
 *   unreachable controls that real Tab presses never reach (roving-focus members count as reached)
 *   focus      focus stops that show no change (no outline, ring or colour change on the control or its wrappers)
 *   trap       focus that leaves an open modal dialog
 * Usage:
 *   npx tsx tools/ui-test/a11y-audit.ts before     writes design/248/audit-before.json (run on the code before the fixes)
 *   npx tsx tools/ui-test/a11y-audit.ts after      writes design/248/audit-after.json and docs/A11Y-AUDIT.md; fails on any finding
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { typeRegistry } from "../../src/elements/registry.ts";
import { PAGE_SCRIPT } from "./a11y-page.ts";
import { launchApp, REPO, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";
import { copyProject } from "./cdp.ts";

const tag = process.argv[2] === "before" ? "before" : "after";
/** `report` writes docs/A11Y-AUDIT.md from the two saved runs without opening the app. */
const reportOnly = process.argv[2] === "report";
const OUT = evidence("design/248");
const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", "en.json"), "utf8")) as Record<string, string>;
const L = (key: string) => strings[key] ?? key;

type Category = "unnamed" | "clickable" | "role" | "unreachable" | "focus" | "trap";
interface Finding { category: Category; state: string; sig: string; what: string }
const findings: Finding[] = [];
const stateStops: Record<string, number> = {};
const add = (category: Category, state: string, f: { tag: string; role: string; text: string; in: string; problem?: string }) =>
  findings.push({ category, state, sig: `${category}|${f.tag}|${f.role}|${f.in}|${f.problem ?? ""}`, what: `${f.problem ? `${f.problem}: ` : ""}<${f.tag}${f.role ? ` role=${f.role}` : ""}> "${f.text}" in ${f.in || "root"}` });

// Roles that need an accessible name to be usable with a screen reader.
const NAMED = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "tab", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "treeitem", "dialog", "alertdialog", "listbox", "grid", "tree", "tablist", "menu", "menubar"]);

async function axUnnamed(app: App, scope: string, state: string) {
  const { nodes } = (await app.cdp("Accessibility.getFullAXTree")) as { nodes: { ignored?: boolean; role?: { value: string }; name?: { value: string }; backendDOMNodeId?: number }[] };
  for (const n of nodes) {
    const role = n.role?.value ?? "";
    if (n.ignored || !NAMED.has(role) || (n.name?.value ?? "").trim() || !n.backendDOMNodeId) continue;
    let described: { tag: string; role: string; text: string; in: string } | null = null;
    try {
      const { object } = await app.cdp("DOM.resolveNode", { backendNodeId: n.backendDOMNodeId });
      const r = await app.cdp("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function () { return window.__a.describeNode(this, ${JSON.stringify(scope)}); }` });
      described = r.result.value;
    } catch {
      continue;
    }
    // The role Chromium computed is what a screen reader announces; show it when the element has no role attribute.
    if (described) add("unnamed", state, { ...described, role: described.role || role });
  }
}

type Kind = "view" | "dialog" | "menu" | "popup";
type Candidate = { id: number; tabi: number | null; composite: number; tag: string; role: string; text: string; in: string };

async function traverse(app: App, scope: string, kind: Kind, state: string, found: { candidates: Candidate[] }) {
  const press = async (key: string) => {
    const base = key === "Tab" ? { key, code: "Tab", windowsVirtualKeyCode: 9 } : { key, code: key, windowsVirtualKeyCode: 40 };
    await app.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await app.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await app.sleep(12);
  };
  // A view starts at the top of the page; a dialog or menu starts where its focus is; a menu is walked with the arrow keys.
  if (kind === "view" || kind === "popup") await app.eval(`__a.startAtTop()`);
  const reached = new Set<number>();
  let cycled = false;
  for (let i = 0; i < 300; i++) {
    await press(kind === "menu" ? "ArrowDown" : "Tab");
    const s = await app.eval<{ body?: boolean; id: number; inside: boolean; ring: boolean; blockly: boolean; outline: string; tag: string; role: string; text: string; in: string }>(`__a.stop(${JSON.stringify(scope)})`);
    if (s.body || reached.has(s.id)) { cycled = true; break; }
    reached.add(s.id);
    if (!s.inside) {
      if (kind === "dialog") { add("trap", state, { ...s, problem: "Tab leaves the dialog" }); break; }
      continue;
    }
    // Blockly draws the focus of its blocks itself (checked by keyboard.ts); the rest must show a change.
    if (!s.ring && !s.blockly) add("focus", state, { ...s, problem: `no visible focus (outline ${s.outline})` });
  }
  stateStops[state] = reached.size;
  if (kind === "menu") {
    // Tab closes a menu and gives the focus back to its opener.
    await press("Tab");
    await app.sleep(150);
    if (await app.eval<boolean>(`!!document.querySelector(${JSON.stringify(scope)})`)) add("trap", state, { tag: "div.menulist", role: "menu", text: "", in: "", problem: "Tab does not close the menu" });
  }
  // A cut-off walk cannot say what is unreachable.
  if (!cycled) return;
  const exempt = new Set<number>();
  for (const c of found.candidates) if (reached.has(c.id)) (exempt.add(c.id), c.composite && exempt.add(c.composite));
  for (const c of found.candidates) {
    if (reached.has(c.id)) continue;
    // Members of a composite widget (tabs, list, menu, radio group) are reached by arrow keys once the widget has its tab stop.
    if (c.composite && exempt.has(c.composite)) continue;
    add("unreachable", state, c);
  }
}

/** Audits one state: `scope` is a CSS selector for the area, `modal` when it is an open dialog or popup. */
async function audit(app: App, state: string, scope: string, kind: Kind = "view") {
  // A11Y_ONLY=regex audits only the matching states (a quick check while fixing); a full run is needed for the report.
  if (process.env.A11Y_ONLY && !new RegExp(process.env.A11Y_ONLY, "i").test(state)) return;
  await app.eval(PAGE_SCRIPT);
  // Nothing under the pointer (a hovered control looks like a focused one) and no transition half way.
  await app.mouse("mouseMoved", 2, 2, 0);
  await app.eval(`(() => { if (document.getElementById("a11y-still")) return; const s = document.createElement("style"); s.id = "a11y-still"; s.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }"; document.head.append(s); })()`);
  // The control that has the focus when the state opens would be measured as already focused: blur it for the scan, then give it back.
  const focused = await app.eval<number>(`__a.blurActive()`);
  const found = await app.eval<{ clickables: never[]; roles: never[]; dialogs: never[]; candidates: never[] }>(`__a.scan(${JSON.stringify(scope)})`);
  for (const f of found.clickables) add("clickable", state, f);
  for (const f of found.roles) add("role", state, f);
  for (const f of found.dialogs) add("role", state, { ...(f as { tag: string; role: string; text: string; in: string }), problem: "dialog has no role=dialog" });
  await axUnnamed(app, scope, state);
  await app.eval(`__a.refocus(${focused})`);
  await traverse(app, scope, kind, state, found as never);
  console.log(`${state}: ${findings.filter((f) => f.state === state).length} findings, ${stateStops[state] ?? 0} tab stops`);
}

const closeAll = async (app: App) => {
  for (let i = 0; i < 4; i++) {
    if (!(await app.eval<boolean>(`!!document.querySelector(".backdrop, .addpop, .menulist, .ctxwrap")`))) break;
    // Tab may have left an open dialog (that is a finding); Escape only reaches it while the focus is inside.
    await app.eval(`(() => { const box = document.querySelector(".backdrop .dialog, .backdrop form, .addpop, .menulist"); if (box && !box.contains(document.activeElement)) { box.tabIndex = -1; box.focus(); } })()`);
    await app.key("Escape");
    await app.sleep(150);
  }
  await app.eval(`[...document.querySelectorAll(".backdrop .abtn")].find((b) => /^(Cancel|Close)$/.test(b.textContent.trim()))?.click()`);
  await app.sleep(100);
};
const menuItem = async (app: App, menu: string, item: string) => {
  if (await app.eval<boolean>(`!!document.querySelector(".menulist")`)) (await app.key("Escape"), await app.sleep(150));
  await app.click(".menubar .menu", L(menu));
  await app.click(".menulist button", L(item));
  await app.sleep(250);
};
const home = async (app: App) => {
  await app.eval(`document.querySelector(".rail .rtab").click()`);
  await app.waitFor(`document.querySelector(".tiles")`);
};

/** A state that cannot be opened is reported and skipped; the audit goes on. */
const attempt = async (name: string, body: () => Promise<void>) => {
  try {
    await body();
  } catch (e) {
    console.log(`skipped ${name}: ${String(e).slice(0, 120)}`);
  }
};

async function projectAudit() {
  const project = copyProject(join(REPO, "examples", "hello"), "hello");
  for (const type of typeRegistry().types) {
    try {
      addElement(project, type.id, `a11y_${type.id}`);
    } catch {
      // A type the fixture cannot create stays out.
    }
  }
  const app = await launchApp({ project, width: 1440, height: 900 });
  try {
    await app.waitFor(`document.querySelector(".status .led")`, 30000);
    await app.waitFor(`document.querySelectorAll(".tile").length > 10`, 30000);

    // 1. The window around the views, then every rail section.
    await audit(app, "chrome: menu bar, rail and status bar", ".menubar, .rail, .status");
    const sections = await app.eval<string[]>(`[...document.querySelectorAll(".rail .rtab[data-section]")].map((b) => b.dataset.section)`);
    for (const s of sections) {
      await app.eval(`document.querySelector(".rail .rtab[data-section=${s}]").click()`);
      await app.sleep(500);
      await audit(app, `view: ${s}`, ".content");
      if (s === "elements") {
        await app.eval(`(() => { const s = [...document.querySelectorAll(".findbar select")].find((x) => [...x.options].some((o) => o.value === "details")); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "details"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await app.sleep(300);
        await audit(app, "view: elements as a table", ".content");
        await app.eval(`(() => { const s = [...document.querySelectorAll(".findbar select")].find((x) => [...x.options].some((o) => o.value === "tiles")); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "tiles"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      }
    }

    // 2. Menus, the element context menu and dialogs.
    await home(app);
    for (const m of ["menu.file", "menu.workspace", "menu.resources", "menu.buildRun", "menu.tools", "menu.window", "menu.help"]) {
      await app.click(".menubar .menu", L(m));
      await app.waitFor(`document.querySelector(".menulist")`);
      await audit(app, `menu: ${L(m)}`, ".menulist", "menu");
      await closeAll(app);
    }
    await app.click(".tile:not(.foldertile)", undefined, { button: "right" });
    await app.waitFor(`document.querySelector(".ctxwrap .menulist")`);
    await audit(app, "menu: element context menu", ".ctxwrap .menulist", "menu");
    await closeAll(app);
    const dialogs: [string, string, string, string?][] = [
      ["menu.file", "menu.newProject", "File > New project"],
      ["menu.file", "menu.importZip", "File > Import project from ZIP"],
      ["menu.window", "menu.preferences", "Preferences"],
      ["menu.help", "menu.docs", "User guide"],
      ["menu.help", "menu.shortcuts", "Keyboard shortcuts"],
      ["menu.help", "menu.connectAgent", "Connect an AI agent"],
      ["menu.help", "menu.reportBug", "Report a bug"],
      ["menu.help", "menu.about", "About"],
      ["menu.tools", "menu.dataLists", "Minecraft data lists"],
      ["menu.tools", "menu.createPack", "Create pack"],
      ["menu.resources", "menu.createTexture", "Create texture"],
      ["menu.buildRun", "menu.runGradleTask", "Run Gradle task"],
      ["menu.file", "menu.exportJar", "Export mod jar"],
    ];
    for (const [m, item, name] of dialogs) {
      await home(app);
      try {
        await menuItem(app, m, item);
        await app.waitFor(`document.querySelector(".backdrop")`, 8000);
      } catch (e) {
        console.log(`skipped ${name}: ${String(e).slice(0, 80)}`);
        await closeAll(app);
        continue;
      }
      await audit(app, `dialog: ${name}`, ".backdrop", "dialog");
      await closeAll(app);
    }
    await home(app);
    await menuItem(app, "menu.workspace", "menu.quickOpen");
    await app.waitFor(`document.querySelector(".quickopen")`);
    await audit(app, "dialog: Go to anything", ".backdrop", "dialog");
    await closeAll(app);
    await home(app);
    await menuItem(app, "menu.workspace", "menu.newElement");
    await app.waitFor(`document.querySelector(".addpop")`);
    await audit(app, "popup: New element", ".addpop", "popup");
    await closeAll(app);
    await attempt("Rename", async () => {
      await home(app);
      await app.click(".tile:not(.foldertile)", undefined, { button: "right" });
      await app.click(".ctxwrap .menulist button", "Rename");
      await app.waitFor(`document.querySelector(".backdrop")`, 5000);
      await audit(app, "dialog: Rename", ".backdrop", "dialog");
    });
    await closeAll(app);

    // 3. Panels.
    for (const [panel, name] of [["panel.build", "Build output"], ["panel.problems", "Problems"], ["menu.aiPanel", "AI assistant"]] as const) {
      await attempt(name, async () => {
        await menuItem(app, "menu.window", panel);
        await app.waitFor(`document.querySelector(".bottom-panel")`, 8000);
        await audit(app, `panel: ${name}`, ".bottom-panel");
      });
    }
    await attempt("Guided tour", async () => {
      await menuItem(app, "menu.help", "menu.tour");
      await app.waitFor(`document.querySelector(".tour")`, 5000);
      await audit(app, "panel: Guided tour", ".tour");
      // The tour outlines its target with a dashed ring that would hide the focus ring in the states after it.
      await app.eval(`document.querySelector("[data-testid=tour-close]")?.click()`);
      await app.sleep(300);
    });

    // 4. The texture editor.
    await attempt("texture editor", async () => {
      await home(app);
      await app.eval(`document.querySelector(".rail .rtab[data-section=resources]").click()`);
      await app.waitFor(`document.querySelector(".texcell")`);
      await app.click(".texcell", "ruby.png", { double: true });
      await app.waitFor(`document.querySelector(".paintcanvas")`);
      await audit(app, "editor: texture", ".content");
    });

    // 5. Every element editor (and every page of an editor that has pages).
    const tiles = await (async () => { await home(app); return app.eval<number>(`document.querySelectorAll(".tile:not(.foldertile)").length`); })();
    for (let i = 0; i < tiles; i++) {
      await home(app);
      const name = await app.eval<string>(`(() => { const t = document.querySelectorAll(".tile:not(.foldertile)")[${i}]; t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return t.querySelector(".ttype").textContent + " " + t.querySelector(".tname").textContent; })()`);
      try {
        await app.waitFor(`document.querySelector(".edhead")`, 15000);
      } catch {
        console.log(`skipped ${name}: no editor`);
        continue;
      }
      await app.sleep(400);
      const pages = await app.eval<number>(`document.querySelectorAll(".content .pagetabs .ltab").length`);
      await audit(app, `editor: ${name}`, ".content");
      // Editors with pages: audit the others too (the first is the one just done).
      for (let p = 1; p < Math.min(pages, 4); p++) {
        await app.eval(`document.querySelectorAll(".content .pagetabs .ltab")[${p}].click()`);
        await app.sleep(300);
        await audit(app, `editor: ${name}, page ${p + 1}`, ".content");
      }
    }
  } finally {
    await app.close();
  }
}

async function firstRunAudit() {
  const welcome = await launchApp({ level: "java" });
  try {
    await welcome.waitFor(`document.querySelector(".welcome")`, 20000);
    await audit(welcome, "view: welcome", ".welcome");
  } finally {
    await welcome.close();
  }
  const setup = await launchApp({ level: null });
  try {
    await setup.waitFor(`document.querySelector("[data-testid=setup]")`, 20000);
    await audit(setup, "dialog: first-run setup", ".backdrop", "dialog");
  } finally {
    await setup.close();
  }
}

if (!reportOnly) {
  await firstRunAudit();
  await projectAudit();
}

// ---- report ----
const categories: Category[] = ["unnamed", "clickable", "role", "unreachable", "focus", "trap"];
type Saved = { states: number; stops: Record<string, number>; counts: Record<Category, { raw: number; unique: number }>; findings: Finding[] };
const counts = (list: Finding[]) => Object.fromEntries(categories.map((c) => [c, { raw: list.filter((f) => f.category === c).length, unique: new Set(list.filter((f) => f.category === c).map((f) => f.sig)).size }]));
if (!reportOnly) {
  mkdirSync(join(REPO, OUT), { recursive: true });
  writeFileSync(join(REPO, OUT, `audit-${tag}.json`), JSON.stringify({ tag, states: Object.keys(stateStops).length, stops: stateStops, counts: counts(findings), findings }, null, 1) + "\n");
  console.log(JSON.stringify(counts(findings)));
}
const saved = (name: string) => {
  // The run that just wrote its result reads it from OUT; the committed run before the fixes stays in design/248.
  const file = [join(REPO, OUT, `audit-${name}.json`), join(REPO, "design/248", `audit-${name}.json`)].find((f) => existsSync(f))!;
  return JSON.parse(readFileSync(file, "utf8")) as Saved;
};
if (reportOnly || tag === "after") {
  const before = saved("before");
  const after = saved("after");
  writeReport(before, after);
  const total = after.findings.length;
  if (total) {
    for (const f of after.findings.slice(0, 40)) console.log(`${f.category} [${f.state}] ${f.what}`);
    console.error(`FAIL: ${total} findings`);
    process.exitCode = 1;
  } else console.log("PASS a11y-audit");
}

/** docs/A11Y-AUDIT.md: what the audit checks, before and after counts, what was found and what is not covered. */
function writeReport(before: Saved, after: Saved) {
  const findings = after.findings;
  const stateStops = after.stops;
  const label: Record<Category, string> = {
    unnamed: "Interactive elements with no accessible name",
    clickable: "Clickable elements that are not buttons (no role, no focus)",
    role: "Groups with no role or state (tabs, lists, menus, dialogs, a selection that is only a style)",
    unreachable: "Controls that real Tab presses never reach (arrow-key members of a tab strip, list, menu or radio group count as reached)",
    focus: "Focus stops that show no change",
    trap: "Focus that leaves an open modal dialog, or a menu that Tab does not close",
  };
  const row = (c: Category) => `| ${label[c]} | ${before.counts[c].raw} | ${before.counts[c].unique} | ${after.counts[c].raw} | ${after.counts[c].unique} |`;
  const groups = new Map<string, { n: number; f: Finding }>();
  for (const f of before.findings) groups.set(f.sig, { n: (groups.get(f.sig)?.n ?? 0) + 1, f: groups.get(f.sig)?.f ?? f });
  const top = [...groups.values()].sort((x, y) => y.n - x.n || x.f.category.localeCompare(y.f.category));
  const lines = [
    "# Accessibility audit (Q248)",
    "",
    "Generated by `npx tsx tools/ui-test/a11y-audit.ts after` (the numbers before the fixes come from the same script run on the code of Q247, saved in `design/248/audit-before.json`; the numbers after are in `design/248/audit-after.json`). Do not edit by hand.",
    "",
    "## Method",
    "",
    "The script opens a copy of `examples/hello` with one element of every type, in a hidden window, and visits every state below. For each state it reads Chromium's accessibility tree (`Accessibility.getFullAXTree`), inspects the DOM and its React props, and presses Tab for real (CDP key events) until the focus cycles.",
    "",
    "- **No accessible name**: a button, link, field, tab, menu item, option, dialog, list, grid, tab strip or menu that the accessibility tree exposes with an empty name.",
    "- **Clickable non-button**: an element with an `onClick` that is not a button, link or field, has no interactive role, is not focusable, and is not a row or cell of a grid, list or menu that handles the keys.",
    "- **Missing role or state**: a dialog without `role=dialog`, a menu opener without `aria-haspopup`, `aria-selected` outside a tablist, listbox or grid, a group whose selected item shows only as a style.",
    "- **Tab cannot reach**: a visible, enabled control that no Tab press reaches in a full cycle, unless it belongs to a composite widget (tablist, listbox, grid, menu, radio group) whose tab stop was reached.",
    "- **Focus not visible**: a Tab stop whose style (outline, shadow, background, border or colour, on the control or one of three ancestors) is the same focused and not focused. Blockly's own blocks are checked by `keyboard.ts` instead.",
    "- **Trap**: Tab leaves an open modal dialog, or Tab does not close an open menu.",
    "",
    `States audited: ${before.states} before, ${after.states} after. Raw counts are per state; unique counts merge the same control across states.`,
    "",
    "## Before and after",
    "",
    "| Check | Before (raw) | Before (unique) | After (raw) | After (unique) |",
    "| --- | --- | --- | --- | --- |",
    ...(["unnamed", "clickable", "role", "unreachable", "focus", "trap"] as Category[]).map(row),
    "",
    "## What was found before the fixes",
    "",
    "| Check | Count | Control | First seen in |",
    "| --- | --- | --- | --- |",
    ...top.map(({ n, f }) => `| ${f.category} | ${n} | ${f.what.replace(/\|/g, "/")} | ${f.state} |`),
    "",
    "## What is left after the fixes",
    "",
    ...(findings.length ? ["| Check | State | Control |", "| --- | --- | --- |", ...findings.map((f) => `| ${f.category} | ${f.state} | ${f.what.replace(/\|/g, "/")} |`)] : ["Nothing: every state above passes every check."]),
    "",
    "## States audited",
    "",
    Object.entries(stateStops).map(([state, stops]) => `- ${state} (${stops} Tab stops)`).join("\n"),
    "",
    "## Not covered by this audit",
    "",
    "- A real screen reader (NVDA, JAWS, Narrator): the audit reads what Chromium's accessibility tree offers, which is what a screen reader receives, but it cannot say how a reader speaks it.",
    "- The Blockly workspace and toolbox and the Monaco code editor draw their own widgets. Blockly's keyboard use and names are exercised in `tools/ui-test/keyboard.ts`; Monaco ships its own accessibility support and is not audited here.",
    "- Colour contrast and text size (Q247 covers them).",
    "",
  ];
  mkdirSync(join(REPO, dirname(evidence("docs/A11Y-AUDIT.md"))), { recursive: true });
  writeFileSync(join(REPO, evidence("docs/A11Y-AUDIT.md")), lines.join("\n"));
}
