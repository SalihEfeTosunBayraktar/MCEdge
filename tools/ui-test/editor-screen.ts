/**
 * KUYRUK #153: editor_screenshot with `screen` makes the running app switch there before the capture: a section, a
 * resources tab, an element editor, a dialog and a bottom panel; an unknown screen and a missing element are refused.
 * The switch is checked over CDP and every capture is kept in design/153/ (PrintWindow also captures the hidden test
 * window). Should a system not give a hidden window a title, a "no window" answer after the switch is accepted unless
 * UI_TEST_VISIBLE=1.
 *   node tools/ui-test/editor-screen.ts
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";

const project = exampleProject();
const visible = process.env.UI_TEST_VISIBLE === "1";
const OUT = evidence("design/153");

await run(async (app: App) => {
  const mcp = await connect(project);
  try {
    // The app writes its presence when the project opens; the tool needs it.
    await app.sleep(1500);
    const shoot = async (screen: string, check: string, name: string) => {
      const result = await mcp.call("editor_screenshot", { screen }, true);
      await app.waitFor(check, 5000);
      if (typeof result === "string") {
        assert(!visible && result.includes("no MCEdge window"), `${screen}: switched; the hidden window cannot be captured: ${result}`);
        return;
      }
      assert(existsSync(result.file) && statSync(result.file).size > 5000, `${screen}: captured ${result.file}`);
      mkdirSync(OUT, { recursive: true });
      copyFileSync(result.file, `${OUT}/153-${name}.png`);
    };
    await shoot("tags", `document.querySelector(".rtab.on")?.textContent.toLowerCase().includes("tags")`, "tags");
    await shoot("resources/models", `document.querySelector(".rtab.on")?.textContent.includes("Resources") && [...document.querySelectorAll(".langtabs .ltab.on, [role=tab][aria-selected=true]")].some((t) => t.textContent.includes("Models"))`, "resources-models");
    await shoot("item/ruby", `document.querySelector(".edname")?.textContent === "Ruby"`, "element");
    await shoot("panel/activity", `document.querySelector(".ptab.on")?.textContent.includes("Agents") && document.querySelector(".agentsview .timeline")`, "panel-activity");
    await shoot("dialog/about", `document.querySelector(".dialog .ptitle")?.textContent.includes("About")`, "dialog-about");
    await app.key("Escape");
    const unknown = await mcp.call("editor_screenshot", { screen: "nowhere" }, true);
    assert(String(unknown).includes("unknown screen"), `an unknown screen is refused: ${unknown}`);
    const missing = await mcp.call("editor_screenshot", { screen: "item/nothing" }, true);
    assert(String(missing).includes("no element item/nothing"), `a missing element is refused by the app: ${missing}`);
  } finally {
    await mcp.close();
  }
}, { project });
