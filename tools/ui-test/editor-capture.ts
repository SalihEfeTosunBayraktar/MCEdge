/**
 * KUYRUK 158: editor_screenshot captures the window of the app that has the MCP server's project open, not the first
 * MCEdge window found. Two apps run at once, one per project: A in the dark theme, B in the light theme. Each project's
 * editor_screenshot returns its own app's window (told apart by brightness), whichever app started first; each app's
 * presence names its own process; a project no app has open is refused. Screenshots go to design/158/.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readPng } from "../../src/generator/png.ts";
import { readPresence } from "../../src/live/activity.ts";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, launchApp } from "./cdp.ts";

const OUT = "design/158";
mkdirSync(OUT, { recursive: true });
const a = exampleProject(), b = exampleProject(), none = exampleProject();

/** Mean brightness (0-255) of a PNG. */
function brightness(file: string): number {
  const png = readPng(readFileSync(file));
  let sum = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 4 * 97) (sum += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3, n++);
  return sum / n;
}

const appA = await launchApp({ project: a, theme: "dark" });
const appB = await launchApp({ project: b, theme: "light" });
let failed = false;
try {
  await appA.waitFor(`document.querySelector(".tile")`);
  await appB.waitFor(`document.querySelector(".tile")`);
  await appA.sleep(2500);
  const pidA = readPresence(a, "app")?.pid, pidB = readPresence(b, "app")?.pid;
  assert(pidA && pidB && pidA !== pidB, `each app names its own process: ${pidA}, ${pidB}`);
  for (const [name, dir, dark] of [["a-dark", a, true], ["b-light", b, false]] as const) {
    const mcp = await connect(dir);
    try {
      const shot = await mcp.call<{ file: string }>("editor_screenshot", {});
      const level = brightness(shot.file);
      copyFileSync(shot.file, join(OUT, `after-capture-${name}.png`));
      assert(dark ? level < 90 : level > 140, `${name}: captured its own window (brightness ${Math.round(level)})`);
    } finally {
      await mcp.close();
    }
  }
  const mcp = await connect(none);
  try {
    const refused = await mcp.call("editor_screenshot", {}, true);
    assert(String(refused).includes("does not have this project open"), `a project no app has open is refused: ${refused}`);
  } finally {
    await mcp.close();
  }
  console.log("PASS");
} catch (error) {
  failed = true;
  console.error("FAIL", error);
} finally {
  await appA.close();
  await appB.close();
}
process.exit(failed ? 1 : 0);
